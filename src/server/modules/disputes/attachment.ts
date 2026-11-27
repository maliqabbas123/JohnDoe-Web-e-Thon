import { createHash } from "node:crypto";
import { errors } from "@/server/http/errors";
import { ATTACHMENT_LIMIT, type RaiseDisputeInput } from "./schemas";

const formats = [
  { signature: Buffer.from("%PDF-"), extension: "pdf", mimeType: "application/pdf" },
  { signature: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), extension: "png", mimeType: "image/png" },
  { signature: Buffer.from([0xff, 0xd8, 0xff]), extension: "jpg", mimeType: "image/jpeg" },
];

export function prepareAttachment(input: NonNullable<RaiseDisputeInput["attachment"]>) {
  const data = Buffer.from(input.contentBase64, "base64");
  if (data.byteLength > ATTACHMENT_LIMIT) throw errors.payloadTooLarge("Attachments are limited to 4 MiB.");
  const format = formats.find(({ signature }) => data.subarray(0, signature.length).equals(signature));
  if (!format) {
    throw errors.validation([{ path: "attachment", message: "Use a PDF, PNG or JPEG document." }]);
  }

  // Keep the name safe for Content-Disposition and use the detected format.
  const base = input.fileName.split(/[\\/]/).at(-1)?.replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9._ -]/g, "_").replace(/^[. ]+|[. ]+$/g, "").slice(0, 100) || "attachment";
  return {
    data,
    fileName: base + "." + format.extension,
    mimeType: format.mimeType,
    sizeBytes: data.byteLength,
    sha256: createHash("sha256").update(data).digest("hex"),
  };
}
