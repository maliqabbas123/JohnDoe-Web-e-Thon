import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import type { Prisma } from "@/generated/prisma/client";
import type { Role } from "@/generated/prisma/enums";
import { db } from "../db";
import { env } from "../env";
import type { ClientInfo } from "../security/client";

export const SESSION_COOKIE = "exam_session";
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const LAST_SEEN_INTERVAL_MS = 60_000;

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  sessionId: string;
};

// Only the hash is stored, so a copy of the database does not contain
// tokens that could be replayed.
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// Creates a session and ends every other session of the same user: one
// person, one active session.
export async function createSession(
  userId: string,
  client: ClientInfo,
  tx: Prisma.TransactionClient,
): Promise<{ token: string; expiresAt: Date; replaced: number }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);

  const { count: replaced } = await tx.session.updateMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    data: { revokedAt: new Date() },
  });

  await tx.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt,
      ip: client.ip,
      userAgent: client.userAgent,
    },
  });

  return { token, expiresAt, replaced };
}

export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  const production = env().NODE_ENV === "production";
  // A frontend on another origin needs SameSite=None, which browsers only
  // accept together with Secure.
  const crossSite = production && env().ALLOWED_ORIGINS.length > 0;

  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: production,
    sameSite: crossSite ? "none" : "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

// Resolves the caller from the session cookie. Returns null for a missing,
// unknown, expired or revoked session, and for a deactivated account.
export async function getCurrentUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      id: true,
      expiresAt: true,
      revokedAt: true,
      lastSeenAt: true,
      user: { select: { id: true, email: true, name: true, role: true, isActive: true } },
    },
  });

  if (!session || session.revokedAt || session.expiresAt <= new Date() || !session.user.isActive) {
    return null;
  }

  if (Date.now() - session.lastSeenAt.getTime() > LAST_SEEN_INTERVAL_MS) {
    await db.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
  }

  const { id, email, name, role } = session.user;
  return { id, email, name, role, sessionId: session.id };
}

export async function revokeSession(sessionId: string): Promise<void> {
  await db.session.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

// Ends a user's sessions, optionally keeping one (the caller's own).
export async function revokeUserSessions(
  userId: string,
  tx: Prisma.TransactionClient,
  exceptSessionId?: string,
): Promise<void> {
  await tx.session.updateMany({
    where: {
      userId,
      revokedAt: null,
      ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
    },
    data: { revokedAt: new Date() },
  });
}
