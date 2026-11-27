import "server-only";
import type { Role } from "@/generated/prisma/enums";
import { errors } from "../http/errors";
import { getCurrentUser, type SessionUser } from "./session";

// Every protected handler starts with one of these. Access is denied unless
// a guard explicitly allows it.
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw errors.unauthenticated();
  return user;
}

export async function requireRole(...roles: Role[]): Promise<SessionUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) throw errors.forbidden();
  return user;
}
