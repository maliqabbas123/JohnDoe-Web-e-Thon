import type { NextRequest } from "next/server";
import { env } from "../env";
import { errors } from "../http/errors";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Cross-site request forgery defence. Browsers attach an Origin header to
// state-changing requests; it must be this application or an allowed origin.
// Requests without an Origin header do not come from a browser page and
// carry no ambient cookie risk.
export function assertTrustedOrigin(request: NextRequest): void {
  if (SAFE_METHODS.has(request.method)) return;

  const origin = request.headers.get("origin");
  if (!origin) return;

  if (isSameOrigin(request, origin) || env().ALLOWED_ORIGINS.includes(origin)) return;

  throw errors.forbidden("Requests from this origin are not allowed.");
}

function isSameOrigin(request: NextRequest, origin: string): boolean {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
