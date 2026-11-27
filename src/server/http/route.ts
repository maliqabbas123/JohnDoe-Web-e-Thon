import "server-only";
import { connection, type NextRequest } from "next/server";
import { ZodError } from "zod";
import { assertTrustedOrigin } from "../security/origin";
import { ApiError, errors, type FieldError } from "./errors";

type Handler<Context> = (request: NextRequest, context: Context) => Promise<Response> | Response;

// Every route handler is wrapped with route(). It applies the origin check,
// marks the response as uncacheable, and turns any thrown error into the
// standard error shape without leaking internal details.
export function route<Context = unknown>(handler: Handler<Context>) {
  return async (request: NextRequest, context: Context): Promise<Response> => {
    // Every API response depends on the request, so tell Next.js up front
    // that this handler runs at request time and must never be prerendered.
    await connection();

    let response: Response;
    try {
      assertTrustedOrigin(request);
      response = await handler(request, context);
    } catch (error) {
      response = toErrorResponse(error);
    }
    response.headers.set("Cache-Control", "no-store");
    return response;
  };
}

// Largest JSON body the API accepts. Every legitimate request is far smaller;
// the limit stops a client from tying up memory with an oversized payload.
const MAX_JSON_BYTES = 64 * 1024;

// Parses a JSON body, rejecting anything oversized or not valid JSON.
export async function readJson(request: NextRequest): Promise<unknown> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_JSON_BYTES) throw errors.payloadTooLarge();

  const text = await request.text();
  if (Buffer.byteLength(text) > MAX_JSON_BYTES) throw errors.payloadTooLarge();
  // PostgreSQL text cannot hold a NUL character; refuse it here, raw or as
  // a JSON escape, so it never reaches a query.
  if (text.includes("\u0000") || /\\u0000/i.test(text)) {
    throw errors.badRequest("The request contains an invalid character.");
  }

  try {
    return JSON.parse(text);
  } catch {
    throw errors.badRequest("The request body must be valid JSON.");
  }
}

// Query string as a plain object, ready for a schema.
export function readQuery(request: NextRequest): Record<string, string> {
  const query = Object.fromEntries(request.nextUrl.searchParams);
  if (Object.values(query).some((value) => value.includes("\u0000"))) {
    throw errors.badRequest("The request contains an invalid character.");
  }
  return query;
}

// Identifiers in the path. Anything that cannot be one of our ids is
// reported as not found without being sent to the database.
const RESOURCE_ID = /^[A-Za-z0-9_-]{1,64}$/;
export function resourceId(value: string): string {
  if (!RESOURCE_ID.test(value)) throw errors.notFound();
  return value;
}

function toErrorResponse(error: unknown): Response {
  const apiError = normalise(error);
  return Response.json(
    {
      error: {
        code: apiError.code,
        message: apiError.message,
        ...(apiError.details ? { details: apiError.details } : {}),
      },
    },
    { status: apiError.status, headers: apiError.headers },
  );
}

function normalise(error: unknown): ApiError {
  if (error instanceof ApiError) return error;

  if (error instanceof ZodError) {
    const details: FieldError[] = error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    }));
    return errors.validation(details);
  }

  // Constraint violations that slip past service checks, for example two
  // requests racing to create the same record.
  const prismaCode = prismaErrorCode(error);
  if (prismaCode === "P2002") return errors.conflict("This record already exists.");
  if (prismaCode === "P2025") return errors.notFound();

  console.error("Unhandled error in route handler", error);
  return new ApiError(500, "INTERNAL", "Something went wrong. Try again.");
}

function prismaErrorCode(error: unknown): string | undefined {
  if (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "PrismaClientKnownRequestError" &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return undefined;
}
