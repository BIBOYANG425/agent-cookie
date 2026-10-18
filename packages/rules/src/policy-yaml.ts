// POLICY.yaml codec — the one writer and the one reader of the memory repo's field-policy file.
// Used by scripts/generate-seed.ts (the Sample seed) and by @agent-cookie/memory-repo (readPolicy / writePolicy).
// The format is a restricted YAML subset, emitted and accepted exactly:
//   - full-line `#` comments and blank lines (ignored when reading; the first line carries the origin header)
//   - block mappings indented by exactly two spaces per level; keys bare ([A-Za-z_][A-Za-z0-9_.-]*) or JSON-quoted
//   - string lists, one `- "<JSON string>"` item per line, two spaces deeper than their key
//   - `key: []` and `key: {}` for empty collections, `key: <integer>` for `v` and the `ranking` weights
// Anything else (flow collections, plain or single-quoted strings, booleans, anchors, tabs, CR) is an Error.
// Order is kept both ways: list order is meaningful (handshake `available`, Tier 0 prefix) and keys keep theirs.
// Pure: no IO, no clock (the install time is a parameter), no model.
import { POLICY_TABLE, policyId, type PolicyDocument } from '@agent-cookie/contract';

/** First line of the generated Sample seed. A file starting with it is the seed, never an installed policy. */
export const POLICY_SEED_HEADER = '# Generated from @agent-cookie/contract POLICY_TABLE. Sample seed.';
/** Stable prefix of the seed header; matching on it keeps older or reworded generated seeds recognisable. */
const POLICY_SEED_PREFIX = '# Generated from @agent-cookie/contract POLICY_TABLE';
/** First line of every policy the owner installed: `# Installed field policy · policyId <id> · <ISO time>`. */
export const POLICY_INSTALLED_PREFIX = '# Installed field policy';

/** A parsed POLICY.yaml mapping. Shape only: field names, categories and limits are the contract's to check. */
export interface PolicyYamlMapping { [key: string]: PolicyYamlNode }
export type PolicyYamlNode = PolicyYamlMapping | string[] | number;

const BARE_KEY = /^[A-Za-z_][A-Za-z0-9_.-]*$/u;
const INTEGER = /^(?:0|-?[1-9][0-9]*)$/u;

/**
 * Render a policy mapping (POLICY_TABLE, a PolicyDocument, any nesting of maps, string lists and safe integers) as
 * POLICY.yaml. `header` is the single comment line on top. Keys are written in their own order; `undefined` values
 * are skipped, as JSON would. Round trip: parsePolicyYaml(renderPolicyYaml(x)) deep-equals x.
 */
export function renderPolicyYaml(table: PolicyDocument | Readonly<Record<string, unknown>> = POLICY_TABLE, header: string = POLICY_SEED_HEADER): string {
  if (!/^#[^\r\n]*$/u.test(header)) throw new TypeError('Policy header must be one comment line');
  // JSON string quoting is also valid YAML and keeps special scalar values ("yes", "a: b") literal.
  const mapping = (value: Readonly<Record<string, unknown>>, indent: number): string[] => Object.entries(value).flatMap(([key, item]) => {
    if (item === undefined) return [];
    const label = BARE_KEY.test(key) ? key : JSON.stringify(key);
    const prefix = `${' '.repeat(indent)}${label}:`;
    if (Array.isArray(item)) {
      if (!item.every((entry) => typeof entry === 'string')) throw new TypeError('Policy lists must contain strings');
      return item.length === 0 ? [`${prefix} []`] : [prefix, ...item.map((entry) => `${' '.repeat(indent + 2)}- ${JSON.stringify(entry)}`)];
    }
    if (typeof item === 'number') {
      if (!Number.isSafeInteger(item) || Object.is(item, -0)) throw new TypeError('Policy numbers must be safe integers');
      return [`${prefix} ${item}`];
    }
    if (item !== null && typeof item === 'object') {
      const entries = Object.keys(item);
      return entries.length === 0 ? [`${prefix} {}`] : [prefix, ...mapping(item as Record<string, unknown>, indent + 2)];
    }
    throw new TypeError('Policy values must be maps, string lists or integers');
  });
  if (table === null || typeof table !== 'object' || Array.isArray(table)) throw new TypeError('Policy must be a map');
  const body = mapping(table as Readonly<Record<string, unknown>>, 0);
  return `${header}\n${body.length ? `${body.join('\n')}\n` : ''}`;
}

/** The installed form: same renderer, header naming the document's policyId and the install time (`meta.at`). */
export function renderInstalledPolicyYaml(doc: PolicyDocument, installedAt: string): string {
  if (typeof installedAt !== 'string' || !installedAt || /[\r\n]/u.test(installedAt)) throw new TypeError('Install time must be one line');
  return renderPolicyYaml(doc, `${POLICY_INSTALLED_PREFIX} · policyId ${policyId(doc)} · ${installedAt}`);
}

/**
 * Where a POLICY.yaml came from, from its first line alone: the generated seed header, the installed header, or
 * neither ("unmarked": hand-written, or a seed without the generated header — memory-repo decides the rest).
 */
export function policyYamlOrigin(text: string): 'seed' | 'installed' | 'unmarked' {
  const first = text.split('\n', 1)[0]!;
  if (first.startsWith(POLICY_SEED_PREFIX)) return 'seed';
  if (first === POLICY_INSTALLED_PREFIX || first.startsWith(`${POLICY_INSTALLED_PREFIX} `)) return 'installed';
  return 'unmarked';
}

interface Line { no: number; indent: number; body: string }

function fail(no: number, reason: string): never {
  throw new Error(`POLICY.yaml line ${no}: ${reason}`);
}

function setKey(map: PolicyYamlMapping, key: string, value: PolicyYamlNode): void {
  // Own data property even for "__proto__": parsing never touches a prototype.
  Object.defineProperty(map, key, { value, enumerable: true, writable: true, configurable: true });
}

function parseString(text: string, no: number): string {
  let value: unknown;
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    try { value = JSON.parse(text); } catch { value = undefined; }
  }
  if (typeof value !== 'string') fail(no, 'expected a double-quoted JSON string');
  return value;
}

function parseKey(line: Line): { key: string; rest: string } {
  if (line.body.startsWith('"')) {
    const quoted = /^"(?:[^"\\]|\\.)*"/u.exec(line.body);
    if (!quoted) fail(line.no, 'unterminated quoted key');
    const rest = line.body.slice(quoted[0].length);
    if (!rest.startsWith(':')) fail(line.no, 'expected ":" after the key');
    return { key: parseString(quoted[0], line.no), rest: rest.slice(1) };
  }
  const colon = line.body.indexOf(':');
  const key = colon === -1 ? '' : line.body.slice(0, colon);
  if (!BARE_KEY.test(key)) fail(line.no, line.body.startsWith('-') ? 'list item where a key was expected' : 'expected "key:"');
  return { key, rest: line.body.slice(colon + 1) };
}

function parseList(lines: readonly Line[], start: number, indent: number): [string[], number] {
  const items: string[] = [];
  let i = start;
  for (; i < lines.length && lines[i]!.indent >= indent; i++) {
    const line = lines[i]!;
    if (line.indent > indent) fail(line.no, 'unexpected indentation');
    if (!line.body.startsWith('- ')) fail(line.no, 'expected a list item `- "…"`');
    items.push(parseString(line.body.slice(2), line.no));
  }
  return [items, i];
}

function parseMapping(lines: readonly Line[], start: number, indent: number): [PolicyYamlMapping, number] {
  const map: PolicyYamlMapping = {};
  const seen = new Set<string>();
  let i = start;
  while (i < lines.length && lines[i]!.indent >= indent) {
    const line = lines[i]!;
    if (line.indent > indent) fail(line.no, 'unexpected indentation');
    const { key, rest } = parseKey(line);
    if (seen.has(key)) fail(line.no, `duplicate key ${JSON.stringify(key)}`);
    seen.add(key);
    let value: PolicyYamlNode;
    if (rest === '') {
      const next = lines[i + 1];
      if (!next || next.indent <= indent) fail(line.no, `${JSON.stringify(key)} has no value (write [] or {} when empty)`);
      if (next.indent !== indent + 2) fail(next.no, 'indentation must grow by exactly two spaces');
      [value, i] = next.body.startsWith('-') ? parseList(lines, i + 1, indent + 2) : parseMapping(lines, i + 1, indent + 2);
    } else {
      if (!rest.startsWith(' ')) fail(line.no, 'expected a space after ":"');
      const scalar = rest.slice(1);
      if (scalar === '[]') value = [];
      else if (scalar === '{}') value = {};
      else if (INTEGER.test(scalar) && Number.isSafeInteger(Number(scalar))) value = Number(scalar);
      else fail(line.no, `${JSON.stringify(key)}: expected [], {}, an integer or an indented block`);
      i++;
    }
    setKey(map, key, value);
  }
  return [map, i];
}

/** Parse exactly the subset renderPolicyYaml writes. Throws an Error naming the line on anything else; never partial. */
export function parsePolicyYaml(text: string): PolicyYamlMapping {
  if (typeof text !== 'string') throw new TypeError('POLICY.yaml must be text');
  const lines: Line[] = [];
  text.split('\n').forEach((raw, index) => {
    const no = index + 1;
    if (raw.includes('\r')) fail(no, 'carriage return (use LF line endings)');
    const indent = /^ */u.exec(raw)![0].length;
    const body = raw.slice(indent);
    if (body === '' || body.startsWith('#')) return;
    if (/^\s/u.test(body)) fail(no, 'indentation must be spaces');
    if (body.includes('\t')) fail(no, 'tab characters are not allowed');
    if (indent % 2 !== 0) fail(no, 'indentation must be a multiple of two spaces');
    lines.push({ no, indent, body });
  });
  if (lines[0] && lines[0].indent !== 0) fail(lines[0].no, 'the top-level mapping must not be indented');
  const [map, next] = parseMapping(lines, 0, 0);
  if (next !== lines.length) fail(lines[next]!.no, 'unexpected content');
  return map;
}

/**
 * POLICY.yaml → PolicyDocument, unvalidated (the workspace checks it with policyViolations; nothing is repaired here).
 * `v` decision: a file without `v` reads as v 1. The contract defines v1 as "today's POLICY.yaml shape", and that shape
 * — the generated seed, byte-identical in every repo's `fixtures-seed` commit — has no `v` line, so an absent `v` is
 * the v1 encoding rather than a defect. The seed is therefore left as generated (no regeneration, no moved seed
 * commits), while every installed file carries `v: 1` because renderInstalledPolicyYaml writes the document as given.
 * A `v` that is present is returned unchanged, whatever it is.
 */
export function parsePolicyDocument(text: string): PolicyDocument {
  const map = parsePolicyYaml(text);
  return (Object.hasOwn(map, 'v') ? map : { v: 1, ...map }) as unknown as PolicyDocument;
}
