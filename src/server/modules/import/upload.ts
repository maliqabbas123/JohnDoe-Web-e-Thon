import { errors } from "@/server/http/errors";
import { MAX_IMPORT_BYTES } from "./schemas";

export async function readQuestionImport(request: Request): Promise<{ format: "csv" | "json"; text: string }> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  const format = contentType === "text/csv" ? "csv" : contentType === "application/json" ? "json" : null;
  if (!format) throw errors.badRequest("Use Content-Type text/csv or application/json.");

  if (Number(request.headers.get("content-length")) > MAX_IMPORT_BYTES) {
    throw errors.payloadTooLarge("The import file must be at most 512 KiB.");
  }
  const reader = request.body?.getReader();
  if (!reader) throw errors.badRequest("Send an import file in the request body.");

  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_IMPORT_BYTES) {
        void reader.cancel().catch(() => {});
        throw errors.payloadTooLarge("The import file must be at most 512 KiB.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  try {
    return { format, text: new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, size)) };
  } catch {
    throw errors.badRequest("The import file must be valid UTF-8.");
  }
}
