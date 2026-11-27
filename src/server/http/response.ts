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

export function noContent(): Response {
  return new Response(null, { status: 204 });
}
