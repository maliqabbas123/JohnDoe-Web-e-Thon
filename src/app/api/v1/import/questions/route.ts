import { requireRole } from "@/server/auth/guards";
import { created } from "@/server/http/response";
import { readQuery, route } from "@/server/http/route";
import { parseQuestionImport } from "@/server/modules/import/rows";
import { questionImportQuerySchema } from "@/server/modules/import/schemas";
import { importQuestions } from "@/server/modules/import/service";
import { readImportUpload } from "@/server/modules/import/upload";
import { consumeRateLimit } from "@/server/security/rate-limit";

export const POST = route(async (request) => {
  const examiner = await requireRole("EXAMINER");
  await consumeRateLimit("import:questions:" + examiner.id, { limit: 10, windowSeconds: 60 });
  const { fileName } = questionImportQuerySchema.parse(readQuery(request));
  const { format, text } = await readImportUpload(request);
  const rows = parseQuestionImport(format, text);
  return created(await importQuestions(examiner, fileName ?? "questions." + format, rows));
});
