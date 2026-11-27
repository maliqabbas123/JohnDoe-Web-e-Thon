import assert from "node:assert/strict";
import { it } from "node:test";
import { MAX_IMPORT_BYTES } from "../../src/server/modules/import/schemas";
import { readImportUpload } from "../../src/server/modules/import/upload";

it("enforces the byte cap for a streamed upload without Content-Length", async () => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(MAX_IMPORT_BYTES));
      controller.enqueue(Uint8Array.of(0x20));
    },
  });
  const request = new Request("http://localhost/import", {
    method: "POST",
    headers: { "Content-Type": "text/csv" },
    body,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  await assert.rejects(readImportUpload(request), { status: 413, code: "PAYLOAD_TOO_LARGE" });
});
