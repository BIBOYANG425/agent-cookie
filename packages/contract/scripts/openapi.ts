// OpenAPI 3.1 for teams that do not use TypeScript (A59): built from ENDPOINTS (src/endpoints.ts) and JSON Schemas that
// ts-json-schema-generator derives from the contract's own types, so the document cannot drift from what the SDK gets.
//
//   pnpm --filter @agent-cookie/contract openapi     regenerates packages/contract/openapi.json
//
// test/openapi.test.ts rebuilds the document in memory and fails when the committed file differs. Output is
// deterministic: paths sorted, methods in a fixed order, schemas sorted by name, properties in declaration order,
// 2-space JSON with a trailing newline. Run with Node ≥ 22.7 (--experimental-transform-types; see package.json).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createGenerator } from "ts-json-schema-generator";
import { ENDPOINTS, WORKSPACE_DEFAULT_URL, type Caller, type Endpoint } from "../src/endpoints.ts";
import { ERROR_STATUS } from "../src/errors.ts";
import type { ErrorCode } from "../src/types.ts";

type Json = Record<string, unknown>;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** Where the committed document lives. */
export const OPENAPI_PATH = resolve(ROOT, "openapi.json");
/** info.version follows the SDK: both are views of the same contract. */
const SDK_PACKAGE_JSON = resolve(ROOT, "../sdk/package.json");

const COMPONENT_REF = "#/components/schemas/";
const METHOD_ORDER = ["get", "put", "post"] as const;
/** Response types sent as server-sent events (one JSON object per `data:` line) instead of one JSON body. */
const SSE_TYPES: ReadonlySet<string> = new Set(["IntentEvent"]);
const STATUS_TEXT: Record<number, string> = { 200: "OK", 201: "Created", 202: "Accepted" };

const TAGS: Record<string, string> = {
  agents: "Registration: create an agent and receive its key (shown once).",
  me: "Who the presented key belongs to.",
  personal: "The user's own agents (personal key; most routes also take the owner key, the intent routes a linked assistant's key).",
  agent: "Merchants (a store's agent): handshake, fields by purpose, quotes, contributions, notes, stats.",
  assistant: "Company assistants: consent link, context, contributions, stats.",
  owner: "The user's owner key (console, CLI): consent links, activity, funnel, experiments, Dreaming.",
  demo: "Demo mode only (AGENT_COOKIE_DEMO=1).",
  test: "Test mode only (AGENT_COOKIE_TEST=1).",
  "well-known": "Public keys (lane D).",
};

// ---------------------------------------------------------------------------------------------------------------
// JSON Schemas from the TypeScript types
// ---------------------------------------------------------------------------------------------------------------

/** Every definition the named types need, keyed by type name, rewritten for OpenAPI 3.1 (JSON Schema 2020-12). */
function typeSchemas(names: readonly string[]): Record<string, Json> {
  const generator = createGenerator({
    path: resolve(ROOT, "src/index.ts"),
    tsconfig: resolve(ROOT, "tsconfig.json"),
    expose: "export",
    topRef: true,
    jsDoc: "extended",
    // Open objects: a later contract version may add optional properties (additive changes), and a client generated
    // from this document must not reject them. Maps (Record<string, string>) keep their value schema.
    additionalProperties: true,
    // `pnpm typecheck` checks the types; the generator only reads them.
    skipTypeCheck: true,
  });
  const out: Record<string, Json> = {};
  for (const name of names) {
    const definitions = (generator.createSchema(name).definitions ?? {}) as Record<string, Json>;
    for (const [key, schema] of Object.entries(definitions)) out[key] = toOas(schema) as Json;
  }
  return out;
}

/** draft-07 → 2020-12: refs point at components; tuple `items: [...]` becomes `prefixItems`; no `$schema`. */
function toOas(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toOas);
  if (!node || typeof node !== "object") return node;
  const out: Json = {};
  for (const [key, value] of Object.entries(node as Json)) {
    if (key === "$schema") continue;
    if (key === "$ref" && typeof value === "string") {
      out.$ref = COMPONENT_REF + decodeURIComponent(value.replace(/^#\/definitions\//, ""));
    } else if (key === "items" && Array.isArray(value)) {
      out.prefixItems = toOas(value);
    } else if (key === "additionalItems") {
      out.items = toOas(value);
    } else {
      out[key] = toOas(value);
    }
  }
  return out;
}

function refsIn(node: unknown, into: Set<string>): Set<string> {
  if (Array.isArray(node)) for (const x of node) refsIn(x, into);
  else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node as Json)) {
      if (key === "$ref" && typeof value === "string" && value.startsWith(COMPONENT_REF)) into.add(value.slice(COMPONENT_REF.length));
      else refsIn(value, into);
    }
  }
  return into;
}

// ---------------------------------------------------------------------------------------------------------------
// Endpoint metadata → operations
// ---------------------------------------------------------------------------------------------------------------

function errorCodes(value: string, known: ReadonlySet<string>): ErrorCode[] | undefined {
  const parts = value.split("|").map((p) => p.trim());
  if (parts.every((p) => known.has(p))) return parts as ErrorCode[];
  if (parts.length > 1) throw new Error(`responses value "${value}" mixes error codes and type names`);
  return undefined;
}

function operationId(ep: Endpoint): string {
  const words = ep.path.split("/").filter((s) => s && !s.startsWith(":")).flatMap((s) => s.split(/[^A-Za-z0-9]+/)).filter(Boolean);
  return ep.method.toLowerCase() + words.map((w) => w[0]!.toUpperCase() + w.slice(1)).join("");
}

function tagOf(ep: Endpoint): string {
  return ep.path.split("/")[1]!.replace(/^\./, "");
}

function roles(ep: Endpoint): Caller[] {
  return [ep.caller, ...(ep.also ?? [])];
}

/** Who may call: the bearer key's role (caller + also), as prose for the description. */
function keyNote(ep: Endpoint): string {
  if (ep.path === "/agents/register") return "**Key:** none, except `category: \"personal\"`, which needs the owner key.";
  if (ep.caller === "anyone" || ep.caller === "test") return "**Key:** none.";
  if (ep.caller === "keyed") return "**Key:** any valid key.";
  const list = roles(ep).map((r) => `\`${r}\``).join(", ");
  const assistant = ep.caller !== "assistant" && roles(ep).includes("assistant")
    ? " An assistant's key works only while its owner-approved link (live assist grant) holds." : "";
  return `**Key role:** ${list}.${assistant}`;
}

function description(ep: Endpoint): string {
  const lines = [ep.summary, "", keyNote(ep)];
  if (ep.gate) lines.push(`Mounted only when \`${ep.gate}=1\`; otherwise 404.`);
  if (ep.laneD) lines.push("Lane D (P1): active only when the workspace has both `AGENT_COOKIE_JAR_KEK` and `AGENT_COOKIE_UNLOCK_SECRET` set.");
  if (ep.idempotent) lines.push("Accepts `Idempotency-Key`: the same key with the same body replays the stored response; with a different body, 409 `IDEMPOTENCY_CONFLICT`.");
  return lines.join("\n");
}

function security(ep: Endpoint): Json[] {
  if (ep.path === "/agents/register") return [{}, { bearer: [] }];
  if (ep.caller === "anyone" || ep.caller === "test") return [];
  return [{ bearer: [] }];
}

function pathParameters(ep: Endpoint): Json[] {
  const segments = ep.path.split("/");
  return segments.flatMap((s, i) => {
    if (!s.startsWith(":")) return [];
    const name = s.slice(1);
    const owner = (segments[i - 1] ?? "resource").replace(/s$/, "");
    const schema: Json = name === "key" ? { type: "string", pattern: "^[A-Za-z0-9_.-]{1,64}$" } : { type: "string" };
    return [{ name, in: "path", required: true, description: name === "key" ? `The ${owner} key.` : `The ${owner} id.`, schema }];
  });
}

function queryParameters(ep: Endpoint, defs: Record<string, Json>): Json[] {
  if (!ep.query) return [];
  const type = defs[ep.query];
  if (!type || type.type !== "object" || !type.properties) throw new Error(`${ep.method} ${ep.path}: query type ${ep.query} is not an object type`);
  const required = new Set((type.required as string[] | undefined) ?? []);
  return Object.entries(type.properties as Record<string, Json>).map(([name, prop]) => {
    const { description: text, ...schema } = prop;
    return {
      name, in: "query", required: required.has(name),
      ...(text ? { description: text } : {}),
      schema,
      // Lists travel comma-separated: fields=shoe_size,budget
      ...(schema.type === "array" ? { style: "form", explode: false } : {}),
    };
  });
}

function headerParameters(ep: Endpoint): Json[] {
  const out: Json[] = [];
  if (ep.idempotent) {
    out.push({ name: "Idempotency-Key", in: "header", required: false,
      description: "Scoped to the caller, method and path. Same key + same body → the stored response (Idempotent-Replay: true); same key + different body → 409 IDEMPOTENCY_CONFLICT.",
      schema: { type: "string", maxLength: 200 } });
  }
  if (ep.response && SSE_TYPES.has(ep.response)) {
    out.push({ name: "Last-Event-ID", in: "header", required: false,
      description: "Resume after this quote seq (the `id` of a quote frame); only quotes inserted after it, then the live ones. Absent: from the first quote.",
      schema: { type: "string", pattern: "^\\d{1,15}$" } });
  }
  return out;
}

function successResponse(ep: Endpoint, status: number, type: string): Json {
  const ref = { $ref: COMPONENT_REF + type };
  if (SSE_TYPES.has(type)) {
    return {
      description: [
        `A \`text/event-stream\`: one frame per ${type}, \`event: <type>\` and \`data: <JSON of the ${type}>\`; quote frames carry`,
        "`id: <quote seq>`. Lines starting with `:` are heartbeats (ignore them). The stream closes after `complete` or",
        "`expired`, or after INTENT_STREAM_MAX_MS; a stream that ends without either is not an error: resume with Last-Event-ID.",
      ].join(" "),
      content: { "text/event-stream": { schema: ref } },
    };
  }
  return {
    description: `${STATUS_TEXT[status] ?? "Success"}: ${type}.`,
    ...(ep.idempotent ? { headers: { "Idempotent-Replay": {
      description: "Present (\"true\") when this response is the stored one for a repeated Idempotency-Key.",
      schema: { type: "string", enum: ["true"] },
    } } } : {}),
    content: { "application/json": { schema: ref } },
  };
}

function errorResponse(codes: readonly ErrorCode[]): Json {
  return {
    description: `Error: ${codes.join(", ")}.`,
    content: { "application/json": { schema: { $ref: `${COMPONENT_REF}ErrorBody` } } },
    "x-agent-cookie-error-codes": codes,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------------------------------------------

export function buildOpenApi(endpoints: readonly Endpoint[] = ENDPOINTS): Json {
  const typeNames = new Set<string>(["ErrorBody"]);
  for (const ep of endpoints) {
    if (!ep.response || !ep.responses) throw new Error(`${ep.method} ${ep.path}: response and responses are required for openapi.json`);
    for (const name of [ep.request, ep.query, ep.response, ...Object.values(ep.responses)]) {
      if (name && /^[A-Za-z_]\w*$/.test(name)) typeNames.add(name);
    }
  }
  const knownCodes = new Set(Object.keys(ERROR_STATUS));
  for (const code of knownCodes) typeNames.delete(code);
  const defs = typeSchemas([...typeNames].sort());
  const generatedCodes = (defs.ErrorCode?.enum as string[] | undefined) ?? [];
  if ([...knownCodes].sort().join() !== [...generatedCodes].sort().join()) throw new Error("ERROR_STATUS and the ErrorCode type disagree");

  const roots = new Set<string>(["ErrorBody"]);
  const byPath = new Map<string, Map<string, Json>>();
  const operationIds = new Set<string>();
  for (const ep of endpoints) {
    const responses: Json = {};
    let primary = false;
    for (const status of Object.keys(ep.responses!).map(Number).sort((a, b) => a - b)) {
      const value = ep.responses![status]!;
      const codes = errorCodes(value, knownCodes);
      if (codes) {
        // Lane D's unlock handler answers a non-JSON body with 400 MISSING_FIELD; everywhere else ERROR_STATUS holds.
        for (const code of codes) {
          if (!ep.laneD && ERROR_STATUS[code] !== status) throw new Error(`${ep.method} ${ep.path}: ${code} is ${ERROR_STATUS[code]}, listed under ${status}`);
        }
        responses[String(status)] = errorResponse(codes);
      } else {
        if (!defs[value]) throw new Error(`${ep.method} ${ep.path}: no exported contract type ${value}`);
        if (status >= 400) throw new Error(`${ep.method} ${ep.path}: ${status} must list error codes, not ${value}`);
        if (value === ep.response) primary = true;
        roots.add(value);
        responses[String(status)] = successResponse(ep, status, value);
      }
    }
    if (!primary) throw new Error(`${ep.method} ${ep.path}: response ${ep.response} is not among responses`);
    responses.default = {
      description: "Any other failure, including 500 (code UPSTREAM_ERROR, message \"internal error\"). Every error is an ErrorBody.",
      content: { "application/json": { schema: { $ref: `${COMPONENT_REF}ErrorBody` } } },
    };

    const parameters = [...pathParameters(ep), ...queryParameters(ep, defs), ...headerParameters(ep)];
    for (const p of parameters) refsIn(p, roots);
    if (ep.request) {
      if (!defs[ep.request]) throw new Error(`${ep.method} ${ep.path}: no exported contract type ${ep.request}`);
      roots.add(ep.request);
    }

    const id = operationId(ep);
    if (operationIds.has(id)) throw new Error(`duplicate operationId ${id}`);
    operationIds.add(id);
    const method = ep.method.toLowerCase();
    const oasPath = ep.path.replace(/:([A-Za-z_]\w*)/g, "{$1}");
    const operation: Json = {
      operationId: id,
      tags: [tagOf(ep)],
      description: description(ep),
      security: security(ep),
      ...(parameters.length ? { parameters } : {}),
      ...(ep.request ? { requestBody: { required: true, content: { "application/json": { schema: { $ref: COMPONENT_REF + ep.request } } } } } : {}),
      responses,
      "x-agent-cookie-caller": ep.caller,
      ...(ep.also ? { "x-agent-cookie-also": ep.also } : {}),
      ...(ep.gate ? { "x-agent-cookie-gate": ep.gate } : {}),
      ...(ep.laneD ? { "x-agent-cookie-lane-d": true } : {}),
      ...(ep.idempotent ? { "x-agent-cookie-idempotent": true } : {}),
    };
    if (!byPath.has(oasPath)) byPath.set(oasPath, new Map());
    if (byPath.get(oasPath)!.has(method)) throw new Error(`duplicate route ${ep.method} ${ep.path}`);
    byPath.get(oasPath)!.set(method, operation);
  }

  // Components: what the operations reference, closed over $ref; query types stay inline as parameters.
  const keep = new Set<string>();
  const queue = [...roots];
  while (queue.length) {
    const name = queue.pop()!;
    if (keep.has(name)) continue;
    if (!defs[name]) throw new Error(`unresolved schema ${name}`);
    keep.add(name);
    queue.push(...refsIn(defs[name], new Set()));
  }
  const schemas: Json = {};
  for (const name of [...keep].sort()) schemas[name] = defs[name];
  // The status of each code comes from ERROR_STATUS (src/errors.ts), the table the workspace answers with.
  schemas.ErrorCode = { ...(schemas.ErrorCode as Json),
    description: `Error codes and their HTTP status: ${(generatedCodes as ErrorCode[]).map((c) => `${c} ${ERROR_STATUS[c]}`).join(", ")}.` };

  const paths: Json = {};
  for (const oasPath of [...byPath.keys()].sort()) {
    const methods = byPath.get(oasPath)!;
    const item: Json = {};
    for (const m of METHOD_ORDER) if (methods.has(m)) item[m] = methods.get(m);
    paths[oasPath] = item;
  }
  const usedTags = [...new Set(endpoints.map(tagOf))].sort();
  const sdk = JSON.parse(readFileSync(SDK_PACKAGE_JSON, "utf8")) as { version: string };

  return {
    openapi: "3.1.0",
    info: {
      title: "Agent Cookie workspace",
      version: sdk.version,
      description: [
        "The workspace HTTP API that @agent-cookie/sdk wraps, for clients in any language. Generated from @agent-cookie/contract",
        "(src/endpoints.ts and the TypeScript types) by packages/contract/scripts/openapi.ts; do not edit by hand.",
        "",
        "Authenticate with `Authorization: Bearer <key>`: the key from POST /agents/register, or the owner key. Each operation",
        "names the key roles it accepts. Every error is an ErrorBody `{ error: { code, message } }`; messages never name a field",
        "the caller may not know, and every 404 is identical. Objects are open: a later contract version may add optional",
        "properties, so ignore the ones you do not know. Prices are integer cents of USD.",
      ].join("\n"),
    },
    servers: [{
      url: WORKSPACE_DEFAULT_URL,
      description: "The local workspace (loopback only). A hosted jar is an https origin: use its URL instead.",
    }],
    security: [{ bearer: [] }],
    tags: usedTags.map((name) => ({ name, ...(TAGS[name] ? { description: TAGS[name] } : {}) })),
    paths,
    components: {
      securitySchemes: {
        bearer: {
          type: "http",
          scheme: "bearer",
          description: "The agent's key (shown once by POST /agents/register; keep it in AGENT_COOKIE_KEY, never in chat, logs or commits) or the user's owner key. The key's role decides which operations it may call.",
        },
      },
      schemas,
    },
  };
}

/** The committed bytes: 2-space JSON and a trailing newline. */
export function renderOpenApi(doc: Json = buildOpenApi()): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const text = renderOpenApi();
  let before: string | undefined;
  try { before = readFileSync(OPENAPI_PATH, "utf8"); } catch { before = undefined; }
  if (before === text) {
    console.log(`openapi: ${OPENAPI_PATH} is up to date`);
  } else {
    writeFileSync(OPENAPI_PATH, text);
    console.log(`openapi: wrote ${OPENAPI_PATH}`);
  }
}
