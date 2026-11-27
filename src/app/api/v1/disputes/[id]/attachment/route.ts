import { requireRole } from "@/server/auth/guards";
import { resourceId, route } from "@/server/http/route";
import { disputeAttachment } from "@/server/modules/disputes/service";

type Context = { params: Promise<{ id: string }> };

export const GET = route<Context>(async (_request, { params }) => {
  const user = await requireRole("EXAMINER", "CANDIDATE");
  const attachment = await disputeAttachment(user, resourceId((await params).id));
  return new Response(new Uint8Array(attachment.data), {
    headers: {
      "Content-Type": attachment.mimeType,
      "Content-Length": String(attachment.sizeBytes),
      "Content-Disposition": `attachment; filename="${attachment.fileName}"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
});
