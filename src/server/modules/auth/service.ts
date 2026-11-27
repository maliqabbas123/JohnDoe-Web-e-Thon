import "server-only";
import { writeAudit } from "@/server/audit/audit";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { createSession, revokeSession, revokeUserSessions, type SessionUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { errors } from "@/server/http/errors";
import type { ClientInfo } from "@/server/security/client";
import { clearRateLimit, consumeRateLimit } from "@/server/security/rate-limit";
import type { ChangePasswordInput, LoginInput, SignupInput } from "./schemas";

const FIFTEEN_MINUTES = 15 * 60;
const LOGIN_LIMIT_PER_ACCOUNT = { limit: 5, windowSeconds: FIFTEEN_MINUTES };
const LOGIN_LIMIT_PER_ADDRESS = { limit: 30, windowSeconds: FIFTEEN_MINUTES };
const PASSWORD_CHANGE_LIMIT = { limit: 5, windowSeconds: FIFTEEN_MINUTES };
const SIGNUP_LIMIT_PER_ADDRESS = { limit: 10, windowSeconds: 60 * 60 };

// Verified when the email is unknown, so an unknown email takes as long to
// reject as a wrong password and cannot be told apart by timing.
let decoyHash: Promise<string> | undefined;
const getDecoyHash = () => (decoyHash ??= hashPassword("decoy-password-never-matches"));

// Open registration for candidates and examiners. A new account owns nothing
// and can see nothing that belongs to anyone else, so no approval is needed.
// There is no email service, so the address is not verified; the rate limit
// bounds both bulk registration and probing for existing addresses.
export async function signup(input: SignupInput, client: ClientInfo) {
  await consumeRateLimit(`signup:${client.ip ?? "unknown"}`, SIGNUP_LIMIT_PER_ADDRESS);

  const existing = await db.user.findUnique({ where: { email: input.email }, select: { id: true } });
  if (existing) throw errors.conflict("An account with this email already exists.");

  const passwordHash = await hashPassword(input.password);

  return db.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { email: input.email, name: input.name, role: input.role, passwordHash },
      select: { id: true, email: true, name: true, role: true },
    });
    const session = await createSession(user.id, client, tx);
    await writeAudit(
      {
        actorId: user.id,
        action: "USER_SIGNED_UP",
        entityType: "User",
        entityId: user.id,
        metadata: { role: user.role },
        ip: client.ip,
      },
      tx,
    );
    return { user, token: session.token, expiresAt: session.expiresAt };
  });
}

export async function login(input: LoginInput, client: ClientInfo) {
  const address = client.ip ?? "unknown";
  const accountKey = `login:${address}:${input.email}`;
  await consumeRateLimit(`login:${address}`, LOGIN_LIMIT_PER_ADDRESS);
  await consumeRateLimit(accountKey, LOGIN_LIMIT_PER_ACCOUNT);

  const user = await db.user.findUnique({
    where: { email: input.email },
    select: { id: true, email: true, name: true, role: true, isActive: true, passwordHash: true },
  });

  const passwordMatches = await verifyPassword(
    input.password,
    user?.passwordHash ?? (await getDecoyHash()),
  );

  if (!user || !user.isActive || !passwordMatches) {
    await writeAudit({
      actorId: user?.id ?? null,
      action: "LOGIN_FAILED",
      entityType: "User",
      entityId: user?.id ?? null,
      metadata: { email: input.email },
      ip: client.ip,
    });
    // One message for every failure, so the response does not reveal
    // whether the account exists or is deactivated.
    throw errors.unauthenticated("Invalid email or password.");
  }

  const session = await db.$transaction(async (tx) => {
    const created = await createSession(user.id, client, tx);
    await writeAudit(
      {
        actorId: user.id,
        action: "LOGIN_SUCCEEDED",
        entityType: "User",
        entityId: user.id,
        metadata: { replacedSessions: created.replaced },
        ip: client.ip,
      },
      tx,
    );
    return created;
  });

  await clearRateLimit(accountKey);

  return {
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
    token: session.token,
    expiresAt: session.expiresAt,
  };
}

export async function logout(user: SessionUser, client: ClientInfo): Promise<void> {
  await revokeSession(user.sessionId);
  await writeAudit({
    actorId: user.id,
    action: "LOGOUT",
    entityType: "User",
    entityId: user.id,
    ip: client.ip,
  });
}

export async function changePassword(
  user: SessionUser,
  input: ChangePasswordInput,
  client: ClientInfo,
): Promise<void> {
  await consumeRateLimit(`password-change:${user.id}`, PASSWORD_CHANGE_LIMIT);

  const account = await db.user.findUniqueOrThrow({
    where: { id: user.id },
    select: { passwordHash: true },
  });

  if (!(await verifyPassword(input.currentPassword, account.passwordHash))) {
    throw errors.validation([
      { path: "currentPassword", message: "The current password is incorrect." },
    ]);
  }

  const passwordHash = await hashPassword(input.newPassword);

  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
    // Every other device is signed out; this session stays.
    await revokeUserSessions(user.id, tx, user.sessionId);
    await writeAudit(
      {
        actorId: user.id,
        action: "PASSWORD_CHANGED",
        entityType: "User",
        entityId: user.id,
        ip: client.ip,
      },
      tx,
    );
  });
}
