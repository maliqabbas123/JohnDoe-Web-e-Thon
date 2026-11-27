import { NextResponse, type NextRequest } from "next/server";

// Cross-origin access for a frontend served from another origin. Only
// origins listed in ALLOWED_ORIGINS receive CORS headers; everything else
// stays same-origin. Authentication and authorisation are not done here.
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim().replace(/\/$/, ""))
  .filter(Boolean);

export function proxy(request: NextRequest) {
  const origin = request.headers.get("origin");
  const allowed = origin !== null && allowedOrigins.includes(origin);

  if (request.method === "OPTIONS" && origin !== null) {
    const preflight = new NextResponse(null, { status: allowed ? 204 : 403 });
    if (allowed) applyCors(preflight, origin);
    return preflight;
  }

  const response = NextResponse.next();
  if (allowed) applyCors(response, origin);
  return response;
}

function applyCors(response: NextResponse, origin: string) {
  response.headers.set("Access-Control-Allow-Origin", origin);
  response.headers.set("Access-Control-Allow-Credentials", "true");
  response.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type");
  response.headers.set("Access-Control-Max-Age", "600");
  response.headers.append("Vary", "Origin");
}

export const config = {
  matcher: "/api/:path*",
};
