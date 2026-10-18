// A59: openapi.json is generated from the contract and committed. These tests regenerate it in memory: a stale file
// fails here (run `pnpm --filter @agent-cookie/contract openapi`), and the document must validate as OpenAPI 3.1.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { compileErrors, validate } from "@readme/openapi-parser";
import { beforeAll, describe, expect, it } from "vitest";
import { buildOpenApi, OPENAPI_PATH, renderOpenApi } from "../scripts/openapi.ts";
import { ENDPOINTS, WORKSPACE_DEFAULT_URL } from "../src/endpoints.js";
import { ERROR_STATUS } from "../src/errors.js";
import { CATEGORIES } from "../src/policy-document.js";
import { FIELDS, PREF_FIELDS } from "../src/types.js";

type Json = Record<string, any>;

let doc: Json;
let text: string;

beforeAll(() => {
  doc = buildOpenApi();
  text = renderOpenApi(doc);
}, 120_000);

function firstDifference(a: string, b: string): string {
  const la = a.split("\n");
  const lb = b.split("\n");
  for (let i = 0; i < Math.max(la.length, lb.length); i++) {
    if (la[i] !== lb[i]) return `line ${i + 1}: committed ${JSON.stringify(la[i])}, generated ${JSON.stringify(lb[i])}`;
  }
  return "";
}

describe("openapi.json", () => {
  it("is the committed output of scripts/openapi.ts (regenerate with `pnpm --filter @agent-cookie/contract openapi`)", () => {
    const committed = readFileSync(OPENAPI_PATH, "utf8");
    expect(committed === text, `packages/contract/openapi.json is stale; ${firstDifference(committed, text)}`).toBe(true);
  });

  it("validates as OpenAPI 3.1", async () => {
    expect(doc.openapi).toMatch(/^3\.1\./);
    const result = await validate(structuredClone(doc) as never);
    expect(result.valid, result.valid ? "" : compileErrors(result)).toBe(true);
  }, 60_000);

  it("has one operation per ENDPOINTS route, with its key roles, body, query and statuses", () => {
    const operations = Object.values(doc.paths as Json).reduce((n, item) => n + Object.keys(item as Json).length, 0);
    expect(operations).toBe(ENDPOINTS.length);
    for (const ep of ENDPOINTS) {
      const path = ep.path.replace(/:(\w+)/g, "{$1}");
      const op = doc.paths[path]?.[ep.method.toLowerCase()];
      expect(op, `${ep.method} ${ep.path}`).toBeDefined();
      expect(op["x-agent-cookie-caller"]).toBe(ep.caller);
      expect(op["x-agent-cookie-also"]).toEqual(ep.also);
      expect(op.security).toEqual(ep.path === "/agents/register" ? [{}, { bearer: [] }]
        : ep.caller === "anyone" || ep.caller === "test" ? [] : [{ bearer: [] }]);
      for (const role of [ep.caller, ...(ep.also ?? [])]) {
        if (!["anyone", "keyed", "test"].includes(role)) expect(op.description).toContain(`\`${role}\``);
      }
      if (ep.request) expect(op.requestBody.content["application/json"].schema.$ref).toBe(`#/components/schemas/${ep.request}`);
      else expect(op.requestBody).toBeUndefined();
      for (const name of ep.path.match(/:(\w+)/g) ?? []) {
        expect(op.parameters.some((p: Json) => p.in === "path" && p.name === name.slice(1) && p.required)).toBe(true);
      }
      if (ep.query) expect(op.parameters.some((p: Json) => p.in === "query")).toBe(true);
      if (ep.idempotent) expect(op.parameters.some((p: Json) => p.in === "header" && p.name === "Idempotency-Key")).toBe(true);
      expect(Object.keys(op.responses).sort()).toEqual([...Object.keys(ep.responses!), "default"].sort());
      expect(op.responses.default.content["application/json"].schema.$ref).toBe("#/components/schemas/ErrorBody");
      for (const [status, value] of Object.entries(ep.responses!)) {
        const media = op.responses[status].content;
        if (Number(status) >= 400) {
          expect(media["application/json"].schema.$ref).toBe("#/components/schemas/ErrorBody");
          for (const code of op.responses[status]["x-agent-cookie-error-codes"]) expect(code in ERROR_STATUS).toBe(true);
        } else {
          const schema = (media["application/json"] ?? media["text/event-stream"]).schema;
          expect(schema.$ref).toBe(`#/components/schemas/${value}`);
        }
      }
    }
  });

  it("documents the events route as text/event-stream of IntentEvent, resumable with Last-Event-ID", () => {
    const op = doc.paths["/personal/intents/{id}/events"].get;
    expect(op.responses["200"].content["text/event-stream"].schema.$ref).toBe("#/components/schemas/IntentEvent");
    expect(op.parameters.some((p: Json) => p.in === "header" && p.name === "Last-Event-ID")).toBe(true);
    const variants = doc.components.schemas.IntentEvent.anyOf.map((v: Json) => v.properties.type.const);
    expect(variants).toEqual(["quote", "complete", "expired"]);
  });

  it("resolves every $ref and keeps only referenced schemas", () => {
    const schemas = doc.components.schemas as Json;
    const seen = new Set<string>();
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) node.forEach(walk);
      else if (node && typeof node === "object") {
        for (const [k, v] of Object.entries(node)) {
          if (k === "$ref") {
            expect(v).toMatch(/^#\/components\/schemas\//);
            const name = (v as string).slice("#/components/schemas/".length);
            expect(schemas[name], `unresolved ${v}`).toBeDefined();
            seen.add(name);
          } else walk(v);
        }
      }
    };
    walk(doc.paths);
    walk(schemas);
    expect([...seen].sort()).toEqual(Object.keys(schemas).sort());
    expect(JSON.stringify(doc)).not.toContain("#/definitions/");
  });

  it("derives the enums from the contract's own types", () => {
    const s = doc.components.schemas;
    expect(s.Field.enum).toEqual([...FIELDS]);
    expect(s.PrefField.enum).toEqual([...PREF_FIELDS]);
    expect(s.Category.enum).toEqual([...CATEGORIES]);
    expect(s.Role.enum).toEqual(["personal", "merchant", "owner", "assistant"]);
    expect([...s.ErrorCode.enum].sort()).toEqual(Object.keys(ERROR_STATUS).sort());
    expect(s.ErrorBody.properties.error.properties.code.$ref).toBe("#/components/schemas/ErrorCode");
  });

  it("names the bearer scheme, the loopback server and the SDK's version", () => {
    const sdk = JSON.parse(readFileSync(resolve(OPENAPI_PATH, "../../sdk/package.json"), "utf8")) as { version: string };
    expect(doc.info.version).toBe(sdk.version);
    expect(doc.servers[0].url).toBe(WORKSPACE_DEFAULT_URL);
    expect(doc.servers[0].description).toContain("https");
    expect(doc.components.securitySchemes.bearer).toMatchObject({ type: "http", scheme: "bearer" });
    expect(text.endsWith("}\n")).toBe(true);
  });
});
