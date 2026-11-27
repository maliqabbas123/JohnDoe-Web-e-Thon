import "server-only";
import type { NextRequest } from "next/server";
import { ZodError } from "zod";
import { assertTrustedOrigin } from "../security/origin";
import { ApiError, errors, type FieldError } from "./errors";

type Handler<Context> = (request: NextRequest, context: Context) => Promise<Response> | Response;

// Every route handler is wrapped with route(). It applies the origin check,
// marks the response as uncacheable, and turns any thrown error into the
// standard error shape without leaking internal details.
export function route<Context = unknown>(handler: Handler<Context>) {
  return async (request: NextRequest, context: Context): Promise<Response> => {
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

// Parses a JSON body, rejecting anything that is not valid JSON.
export async function readJson(request: NextRequest): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw errors.badRequest("The request body must be valid JSON.");
  }
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
