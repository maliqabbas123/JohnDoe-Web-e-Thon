// Response shapes shared by every endpoint. See docs/api.md.
export type PageMeta = { page: number; pageSize: number; total: number };

export function ok<T>(data: T, init?: ResponseInit): Response {
  return Response.json({ data }, init);
}

export function created<T>(data: T): Response {
  return Response.json({ data }, { status: 201 });
}

export function page<T>(data: T[], meta: PageMeta): Response {
  return Response.json({ data, meta });
}

// For lists that can grow without bound. A cursor points just past the last
// item returned, so reading page 5,000 costs the same as reading page 1.
export type CursorMeta = { pageSize: number; nextCursor: string | null; total?: number };

export function cursorPage<T>(data: T[], meta: CursorMeta): Response {
  return Response.json({ data, meta });
}

export function noContent(): Response {
  return new Response(null, { status: 204 });
}
