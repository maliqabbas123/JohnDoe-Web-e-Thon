import { requireRole } from "@/server/auth/guards";
import { resourceId, route } from "@/server/http/route";
import { reportPdf } from "@/server/modules/reports/service";

type Context = { params: Promise<{ id: string }> };

export const GET = route<Context>(async (_request, { params }) => {
  const user = await requireRole("EXAMINER", "CANDIDATE");
  const pdf = await reportPdf(user, resourceId((await params).id));
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="exam-result.pdf"',
      "Content-Length": String(pdf.byteLength),
      "X-Content-Type-Options": "nosniff",
    },
  });
});
