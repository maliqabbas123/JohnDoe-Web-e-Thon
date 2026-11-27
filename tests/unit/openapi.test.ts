// Keeps docs/openapi.yaml honest: the document and the code must describe
// the same endpoints, and the document must be internally consistent.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { parse } from "yaml";

const root = path.resolve(__dirname, "..", "..");
const apiRoot = path.join(root, "src", "app", "api", "v1");
const METHODS = ["get", "post", "put", "patch", "delete"] as const;

type Operation = {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  security?: unknown[];
  responses?: Record<string, unknown>;
};
type Spec = {
  security?: unknown[];
  tags: { name: string }[];
  paths: Record<string, Record<string, Operation>>;
  components: Record<string, Record<string, unknown>>;
};

const spec = parse(readFileSync(path.join(root, "docs", "openapi.yaml"), "utf8")) as Spec;

function walk(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = path.join(directory, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

// "METHOD /path" for every exported handler under src/app/api/v1.
function implemented(): string[] {
  return walk(apiRoot)
    .filter((file) => path.basename(file) === "route.ts")
    .flatMap((file) => {
      const route =
        "/" +
        path
          .relative(apiRoot, path.dirname(file))
          .split(path.sep)
          .map((segment) => segment.replace(/^\[(.+)\]$/, "{$1}"))
          .join("/");
      const source = readFileSync(file, "utf8");
      return [...source.matchAll(/export const (GET|POST|PUT|PATCH|DELETE)\b/g)].map(
        (match) => `${match[1]} ${route}`,
      );
    })
    .sort();
}

function documented(): string[] {
  return Object.entries(spec.paths)
    .flatMap(([route, item]) =>
      METHODS.filter((method) => item[method]).map((method) => `${method.toUpperCase()} ${route}`),
    )
    .sort();
}

function operations(): [string, Operation][] {
  return Object.entries(spec.paths).flatMap(([route, item]) =>
    METHODS.filter((method) => item[method]).map(
      (method) => [`${method.toUpperCase()} ${route}`, item[method]] as [string, Operation],
    ),
  );
}

describe("OpenAPI document", () => {
  it("describes exactly the endpoints that exist", () => {
    assert.deepEqual(documented(), implemented());
  });

  it("gives every operation an id, summary, description, tag and responses", () => {
    const tagNames = new Set(spec.tags.map((tag) => tag.name));
    const ids = new Set<string>();
    for (const [name, operation] of operations()) {
      assert.ok(operation.operationId, `${name} has an operationId`);
      assert.ok(!ids.has(operation.operationId), `${name} has a unique operationId`);
      ids.add(operation.operationId);
      assert.ok(operation.summary, `${name} has a summary`);
      assert.ok(operation.description, `${name} has a description`);
      assert.ok(operation.tags?.length === 1 && tagNames.has(operation.tags[0]), `${name} has one declared tag`);
      assert.ok(Object.keys(operation.responses ?? {}).length > 0, `${name} lists responses`);
    }
  });

  it("documents 401 on every operation that needs a session", () => {
    for (const [name, operation] of operations()) {
      const isPublic = Array.isArray(operation.security) && operation.security.length === 0;
      if (!isPublic) assert.ok(operation.responses?.["401"], `${name} documents 401`);
    }
  });

  it("documents 403 on every state-changing operation, for the origin check", () => {
    for (const [name, operation] of operations()) {
      if (!name.startsWith("GET ")) assert.ok(operation.responses?.["403"], `${name} documents 403`);
    }
  });

  it("has no dangling references", () => {
    const missing: string[] = [];
    const visit = (node: unknown) => {
      if (Array.isArray(node)) return node.forEach(visit);
      if (node === null || typeof node !== "object") return;
      for (const [key, value] of Object.entries(node)) {
        if (key === "$ref" && typeof value === "string") {
          const [, , group, name] = value.split("/");
          if (!value.startsWith("#/components/") || !(name in (spec.components[group] ?? {}))) {
            missing.push(value);
          }
        } else {
          visit(value);
        }
      }
    };
    visit(spec);
    assert.deepEqual(missing, []);
  });

  it("lists every audit action the code writes", () => {
    const sources = walk(path.join(root, "src", "server")).filter((file) => file.endsWith(".ts"));
    const written = new Set<string>();
    for (const file of sources) {
      for (const match of readFileSync(file, "utf8").matchAll(/action: "([A-Z_]+)"/g)) written.add(match[1]);
    }
    const listed = (spec.components.schemas.AuditAction as { enum: string[] }).enum;
    assert.deepEqual([...listed].sort(), [...written].sort());
  });
});
