import type { NextRequest } from "next/server";

export type ClientInfo = { ip: string | null; userAgent: string | null };

// The host terminates TLS and passes the caller's address in
// X-Forwarded-For; the first entry is the original client.
export function clientInfo(request: NextRequest): ClientInfo {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || null;
  const userAgent = request.headers.get("user-agent")?.slice(0, 300) ?? null;
  return { ip, userAgent };
}
