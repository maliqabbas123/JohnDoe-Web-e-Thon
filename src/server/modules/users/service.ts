import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { writeAudit } from "@/server/audit/audit";
import { hashPassword } from "@/server/auth/password";
import { revokeUserSessions, type SessionUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { errors } from "@/server/http/errors";
import type { ClientInfo } from "@/server/security/client";
import { clearSignInLock, signInLockedUntil } from "@/server/security/rate-limit";
import type { CreateUserInput, ListUsersInput, UpdateUserInput } from "./schemas";

// The only user fields that ever leave the server. The password hash is
// never selected.
const publicUser = {
  id: true,
  email: true,
  name: true,
  role: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

// In a "contains" filter, % and _ are wildcards. A search term is literal
// text, so they are escaped; otherwise "%" would match every user.
const literal = (term: string) => term.replace(/[\\%_]/g, "\\$&");

export async function listUsers(filters: ListUsersInput) {
  const term = filters.q ? literal(filters.q) : undefined;
  const where: Prisma.UserWhereInput = {
    ...(filters.role ? { role: filters.role } : {}),
    ...(filters.isActive !== undefined ? { isActive: filters.isActive } : {}),
    ...(term
      ? {
          OR: [
            { name: { contains: term, mode: "insensitive" } },
            { email: { contains: term, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    db.user.findMany({
      where,
      select: publicUser,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
    }),
    db.user.count({ where }),
  ]);

  return { items, meta: { page: filters.page, pageSize: filters.pageSize, total } };
}

export async function getUser(id: string) {
  const user = await db.user.findUnique({ where: { id }, select: publicUser });
  if (!user) throw errors.notFound("User not found.");
  return user;
}

export async function createUser(actor: SessionUser, input: CreateUserInput, client: ClientInfo) {
  const existing = await db.user.findUnique({ where: { email: input.email }, select: { id: true } });
  if (existing) throw errors.conflict("An account with this email already exists.");

  const passwordHash = await hashPassword(input.password);

  return db.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { email: input.email, name: input.name, role: input.role, passwordHash },
      select: publicUser,
    });
    await writeAudit(
      {
        actorId: actor.id,
        action: "USER_CREATED",
        entityType: "User",
        entityId: user.id,
        metadata: { email: user.email, role: user.role },
        ip: client.ip,
      },
      tx,
    );
    return user;
  });
}

export async function updateUser(
  actor: SessionUser,
  id: string,
  input: UpdateUserInput,
  client: ClientInfo,
) {
  const passwordHash = input.password ? await hashPassword(input.password) : undefined;

  return db.$transaction(async (tx) => {
    const target = await tx.user.findUnique({
      where: { id },
      select: { id: true, name: true, role: true, isActive: true },
    });
    if (!target) throw errors.notFound("User not found.");

    const roleChanges = input.role !== undefined && input.role !== target.role;
    const deactivates = input.isActive === false && target.isActive;

    // An administrator cannot lock themselves out.
    if (target.id === actor.id && (roleChanges || deactivates)) {
      throw errors.conflict("You cannot change your own role or deactivate your own account.");
    }

    // The platform must always keep one active administrator.
    if (target.role === "ADMIN" && target.isActive && (roleChanges || deactivates)) {
      const otherAdmins = await tx.user.count({
        where: { role: "ADMIN", isActive: true, id: { not: target.id } },
      });
      if (otherAdmins === 0) {
        throw errors.conflict("At least one active administrator is required.");
      }
    }

    const user = await tx.user.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.role !== undefined ? { role: input.role } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(passwordHash ? { passwordHash } : {}),
      },
      select: publicUser,
    });

    // A change of privileges or credentials ends the user's sessions at once.
    if (roleChanges || deactivates || passwordHash) {
      await revokeUserSessions(id, tx);
    }

    await writeAudit(
      {
        actorId: actor.id,
        action: "USER_UPDATED",
        entityType: "User",
        entityId: id,
        // The password itself is never logged, only that it was reset.
        metadata: {
          ...(input.name !== undefined && input.name !== target.name
            ? { name: { from: target.name, to: input.name } }
            : {}),
          ...(roleChanges ? { role: { from: target.role, to: input.role } } : {}),
          ...(input.isActive !== undefined && input.isActive !== target.isActive
            ? { isActive: { from: target.isActive, to: input.isActive } }
            : {}),
          ...(passwordHash ? { passwordReset: true } : {}),
        },
        ip: client.ip,
      },
      tx,
    );

    return user;
  });
}

const ACTIVITY_LIMIT = 20;
const SIGN_IN_ACTIONS = ["LOGIN_SUCCEEDED", "LOGIN_FAILED"];
const ACCOUNT_ACTIONS = [
  "USER_SIGNED_UP",
  "USER_CREATED",
  "USER_UPDATED",
  "PASSWORD_CHANGED",
  "USER_SESSIONS_REVOKED",
  "USER_SIGN_IN_UNLOCKED",
];

// Everything an administrator needs to answer "what is going on with this
// account?": who is signed in, recent sign-in attempts, and changes to the
// account. Session tokens and hashes are never selected.
export async function getUserActivity(id: string) {
  const user = await db.user.findUnique({ where: { id }, select: { email: true } });
  if (!user) throw errors.notFound("User not found.");

  const now = new Date();
  const history = (actions: string[]) =>
    db.auditLog.findMany({
      where: { entityType: "User", entityId: id, action: { in: actions } },
      select: {
        id: true,
        action: true,
        metadata: true,
        ip: true,
        createdAt: true,
        actor: { select: { id: true, name: true, email: true, role: true } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: ACTIVITY_LIMIT,
    });

  const [sessions, signIns, accountChanges, lockedUntil] = await Promise.all([
    db.session.findMany({
      where: { userId: id, revokedAt: null, expiresAt: { gt: now } },
      select: { id: true, createdAt: true, lastSeenAt: true, expiresAt: true, ip: true, userAgent: true },
      orderBy: { createdAt: "desc" },
    }),
    history(SIGN_IN_ACTIONS),
    history(ACCOUNT_ACTIONS),
    signInLockedUntil(user.email),
  ]);

  return {
    sessions,
    signInLock: { locked: lockedUntil !== null, until: lockedUntil },
    signIns: signIns.map(({ id: entryId, action, ip, createdAt }) => ({
      id: entryId,
      succeeded: action === "LOGIN_SUCCEEDED",
      ip,
      createdAt,
    })),
    accountChanges,
  };
}

// Signs the user out everywhere. Used when an account may be compromised or
// a candidate must be moved off a device.
export async function revokeSessions(actor: SessionUser, id: string, client: ClientInfo): Promise<void> {
  await db.$transaction(async (tx) => {
    const target = await tx.user.findUnique({ where: { id }, select: { id: true } });
    if (!target) throw errors.notFound("User not found.");

    const { count } = await tx.session.updateMany({
      where: { userId: id, revokedAt: null, expiresAt: { gt: new Date() } },
      data: { revokedAt: new Date() },
    });
    await writeAudit(
      {
        actorId: actor.id,
        action: "USER_SESSIONS_REVOKED",
        entityType: "User",
        entityId: id,
        metadata: { sessionsEnded: count },
        ip: client.ip,
      },
      tx,
    );
  });
}

// Lifts a sign-in lockout caused by repeated failed attempts, for example a
// candidate locked out minutes before an exam. The password is not changed.
export async function unlockSignIn(actor: SessionUser, id: string, client: ClientInfo): Promise<void> {
  const target = await db.user.findUnique({ where: { id }, select: { email: true } });
  if (!target) throw errors.notFound("User not found.");

  const cleared = await clearSignInLock(target.email);
  await writeAudit({
    actorId: actor.id,
    action: "USER_SIGN_IN_UNLOCKED",
    entityType: "User",
    entityId: id,
    metadata: { countersCleared: cleared },
    ip: client.ip,
  });
}
