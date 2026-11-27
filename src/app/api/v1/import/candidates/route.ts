import { requireRole } from "@/server/auth/guards";
import { created } from "@/server/http/response";
import { readQuery, route } from "@/server/http/route";
import { candidateImportQuery, parseCandidateImport } from "@/server/modules/import/candidate-rows";
import { importCandidates } from "@/server/modules/import/candidates";
import { readImportUpload } from "@/server/modules/import/upload";
import { consumeRateLimit } from "@/server/security/rate-limit";

export const POST = route(async (request) => {
  const examiner = await requireRole("EXAMINER");
  await consumeRateLimit("import:candidates:" + examiner.id, { limit: 3, windowSeconds: 60 });
  const { examId, fileName } = candidateImportQuery.parse(readQuery(request));
  const { format, text } = await readImportUpload(request);
  const rows = parseCandidateImport(format, text);
  return created(await importCandidates(examiner.id, examId, fileName ?? "candidates." + format, rows));
});
