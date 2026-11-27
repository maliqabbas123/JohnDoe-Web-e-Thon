import { requireRole } from "@/server/auth/guards";
import { created, cursorPage } from "@/server/http/response";
import { readJson, readQuery, resourceId, route } from "@/server/http/route";
import { listAnnouncements, sendAnnouncement } from "@/server/modules/monitoring/announcements";
import { announcementListQuery, createAnnouncementSchema } from "@/server/modules/monitoring/schemas";

type Context = { params: Promise<{ id: string }> };

export const GET = route<Context>(async (request, { params }) => {
  const examiner = await requireRole("EXAMINER");
  const id = resourceId((await params).id);
  const { pageSize, cursor } = announcementListQuery.parse(readQuery(request));
  const page = await listAnnouncements(id, examiner.id, pageSize, cursor);
  return cursorPage(page.items, page.meta);
});

export const POST = route<Context>(async (request, { params }) => {
  const examiner = await requireRole("EXAMINER");
  const id = resourceId((await params).id);
  const { message } = createAnnouncementSchema.parse(await readJson(request));
  return created(await sendAnnouncement(id, examiner.id, message));
});
