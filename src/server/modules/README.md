# Modules

One folder per module from `docs/architecture.md`. Each follows the same shape:

| File | Contains |
|---|---|
| `schemas.ts` | Zod schemas for every input the module accepts |
| `service.ts` | Business rules, ownership checks and data access. No request or response objects |
| `policy.ts` | Ownership and visibility rules, when they are shared by several functions |

The matching route handlers live in `src/app/api/v1/<resource>/route.ts`. A handler wraps itself in `route()`, checks the role, validates input with the module's schema, calls one service function and returns `ok()`, `created()` or `page()`.

```ts
// src/app/api/v1/widgets/route.ts
export const POST = route(async (request) => {
  const user = await requireRole("EXAMINER");
  const input = createWidgetSchema.parse(await readJson(request));
  return created(await createWidget(user, input));
});
```

Throw `errors.*` from `src/server/http/errors.ts` for expected failures. Anything else is logged and returned as a generic 500.
