import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CATEGORIES, DEFAULT_POLICY, POLICY_TABLE, policyHistory, policyId, policyViolations, type PolicyDocument } from '@agent-cookie/contract';
import * as generator from '../scripts/generate-seed.js';
import {
  POLICY_SEED_HEADER, parsePolicyDocument, parsePolicyYaml, policyYamlOrigin, renderInstalledPolicyYaml, renderPolicyYaml,
} from '../src/index.js';

const fixtures = fileURLToPath(new URL('../../../fixtures/', import.meta.url));
const AT = '2026-10-18T09:30:00.000Z';

/** DEFAULT_POLICY with ranking weights and every list in a different (still floor-valid) order. */
function rankedDocument(): PolicyDocument {
  const doc = structuredClone(DEFAULT_POLICY) as PolicyDocument;
  doc.auto.retail = [...doc.auto.retail].reverse();
  doc.auto.shoe = ['deadline', 'budget', 'shoe_size', 'length', 'tone', 'lang'];
  doc.write.personal = [...doc.write.personal].reverse();
  doc.purpose.retail = { payment_method: ['payment'], shipping_address: ['checkout'] };
  doc.ranking = { winRate: 30, failure: 70 };
  return doc;
}

describe('POLICY.yaml codec: one writer, one reader', () => {
  it('the seed script re-exports the shared renderer, so the seed and writePolicy cannot drift apart', () => {
    expect(generator.renderPolicyYaml).toBe(renderPolicyYaml);
  });

  it('round-trips DEFAULT_POLICY with v: 1 and the installed header naming its policyId', () => {
    const text = renderInstalledPolicyYaml(DEFAULT_POLICY, AT);
    expect(text.split('\n', 1)[0]).toBe(`# Installed field policy · policyId ${policyId(DEFAULT_POLICY)} · ${AT}`);
    expect(text).toMatch(/^v: 1$/mu);
    expect(policyYamlOrigin(text)).toBe('installed');
    const parsed = parsePolicyDocument(text);
    expect(parsed).toEqual(DEFAULT_POLICY);
    // Key order and list order survive exactly, not just structurally.
    expect(JSON.stringify(parsed)).toBe(JSON.stringify(DEFAULT_POLICY));
    expect(policyViolations(parsed)).toEqual([]);
    expect(policyId(parsed)).toBe(policyId(DEFAULT_POLICY));
  });

  it('renders and parses the assistant category in all three sections, in CATEGORIES order', () => {
    expect(CATEGORIES).toEqual(['personal', 'shoe', 'retail', 'assistant']);
    const text = renderInstalledPolicyYaml(DEFAULT_POLICY, AT);
    const block = (fields: readonly string[]) => fields.map((field) => `    - ${JSON.stringify(field)}\n`).join('');
    expect(text).toContain(`\n  assistant:\n${block(DEFAULT_POLICY.auto.assistant)}purpose:\n`);
    expect(text).toContain('\n  assistant: {}\nwrite:\n');
    expect(text.endsWith(`\n  assistant:\n${block(DEFAULT_POLICY.write.assistant)}history:\n  personal: true\n  assistant: false\n`)).toBe(true);
    const parsed = parsePolicyDocument(text);
    for (const section of ['auto', 'purpose', 'write'] as const) expect(Object.keys(parsed[section])).toEqual([...CATEGORIES]);
    expect(parsed.auto.assistant).toEqual(DEFAULT_POLICY.auto.assistant);
    expect(parsed.purpose.assistant).toEqual({});
    expect(parsed.write.assistant).toEqual(DEFAULT_POLICY.write.assistant);
    // A changed assistant row survives as written, order included.
    const doc = structuredClone(DEFAULT_POLICY) as PolicyDocument;
    doc.auto.assistant = ['length', 'tone', 'lang', 'pref.color'];
    doc.write.assistant = ['pref.color', 'shoe_size'];
    expect(policyViolations(doc)).toEqual([]);
    const reparsed = parsePolicyDocument(renderInstalledPolicyYaml(doc, AT));
    expect(JSON.stringify(reparsed)).toBe(JSON.stringify(doc));
    expect(policyId(reparsed)).toBe(policyId(doc));
    expect(policyId(reparsed)).not.toBe(policyId(DEFAULT_POLICY));
  });

  it('reads assistant floor breaks back unchanged, so the workspace refuses them by name', () => {
    // The codec never repairs: what the file says is what policyViolations sees.
    const autoAddress = structuredClone(DEFAULT_POLICY) as PolicyDocument;
    autoAddress.auto.assistant = [...autoAddress.auto.assistant, 'shipping_address'];
    const parsed = parsePolicyDocument(renderInstalledPolicyYaml(autoAddress, AT));
    expect(parsed.auto.assistant.at(-1)).toBe('shipping_address');
    expect(policyViolations(parsed)).toEqual(['auto.assistant: shipping_address may never be auto']);

    const purposeToken = structuredClone(DEFAULT_POLICY) as PolicyDocument;
    purposeToken.purpose.assistant = { payment_method: ['payment'] };
    purposeToken.write.assistant = [...purposeToken.write.assistant, 'shipping_address'];
    expect(policyViolations(parsePolicyDocument(renderInstalledPolicyYaml(purposeToken, AT)))).toEqual([
      'write.assistant: an assistant never writes shipping_address',
      'purpose.assistant.payment_method: an assistant never reads payment_method, whatever the purpose',
    ]);

    // A three-category file written before the assistant category parses, and is refused rather than filled in.
    const older = Object.fromEntries((['auto', 'purpose', 'write'] as const).map((section) => [section,
      Object.fromEntries(Object.entries(DEFAULT_POLICY[section]).filter(([category]) => category !== 'assistant'))]));
    const olderParsed = parsePolicyDocument(renderPolicyYaml({ v: 1, ...older }, '# Installed field policy · policyId ee12444c81c5 · 2026-10-17T12:05:00.000Z'));
    expect(Object.keys(olderParsed.auto)).toEqual(['personal', 'shoe', 'retail']);
    expect(policyViolations(olderParsed)).toEqual(['auto.assistant missing', 'purpose.assistant missing', 'write.assistant missing']);
  });

  it('round-trips a document with ranking integers and reordered field lists', () => {
    const doc = rankedDocument();
    expect(policyViolations(doc)).toEqual([]);
    const text = renderInstalledPolicyYaml(doc, AT);
    expect(text).toContain('\nranking:\n  winRate: 30\n  failure: 70\n');
    expect(text).toContain('\n  retail:\n    payment_method:\n      - "payment"\n    shipping_address:\n      - "checkout"\n');
    const parsed = parsePolicyDocument(text);
    expect(parsed).toEqual(doc);
    expect(JSON.stringify(parsed)).toBe(JSON.stringify(doc));
    expect(parsed.auto.retail).toEqual([...DEFAULT_POLICY.auto.retail].reverse());
    expect(renderInstalledPolicyYaml(parsed, AT)).toBe(text);
  });

  it('reads the committed seed: generated header, no v line, v defaults to 1 and the content is DEFAULT_POLICY', async () => {
    const seed = await readFile(join(fixtures, 'memory/POLICY.yaml'), 'utf8');
    expect(seed.startsWith(`${POLICY_SEED_HEADER}\n`)).toBe(true);
    expect(policyYamlOrigin(seed)).toBe('seed');
    expect(seed).not.toMatch(/^v:/mu);
    expect(parsePolicyYaml(seed)).toEqual(POLICY_TABLE);
    expect(parsePolicyDocument(seed)).toEqual(DEFAULT_POLICY);
    expect(JSON.stringify(parsePolicyDocument(seed))).toBe(JSON.stringify(DEFAULT_POLICY));
    expect(parsePolicyDocument(seed).auto.assistant).toEqual(DEFAULT_POLICY.auto.assistant);
    expect(renderPolicyYaml(parsePolicyYaml(seed))).toBe(seed);
  });

  it('returns a present v unchanged (the workspace, not the reader, refuses it)', () => {
    const text = renderPolicyYaml({ ...DEFAULT_POLICY, v: 2 }, '# hand-written');
    expect(policyYamlOrigin(text)).toBe('unmarked');
    const parsed = parsePolicyDocument(text) as unknown as { v: number };
    expect(parsed.v).toBe(2);
    expect(policyViolations(parsed)).toContain('v must be 1');
  });

  it('ignores blank lines and full-line comments anywhere', () => {
    const text = '# first\n\nauto:\n  # a comment inside\n  retail:\n\n    - "lang"\n    # between items\n    - "tone"\nv: 1\n# trailing\n';
    expect(parsePolicyYaml(text)).toEqual({ auto: { retail: ['lang', 'tone'] }, v: 1 });
  });

  it('keeps an odd key as an own property and never touches a prototype', () => {
    const parsed = parsePolicyYaml('"__proto__":\n  - "lang"\n"a b": {}\n');
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
    expect(Object.keys(parsed)).toEqual(['__proto__', 'a b']);
    expect(Object.getOwnPropertyDescriptor(parsed, '__proto__')?.value).toEqual(['lang']);
    expect(({} as Record<string, unknown>).lang).toBeUndefined();
  });

  it.each([
    ['a tab in the indentation', 'auto:\n\t- "lang"\n'],
    ['CRLF line endings', 'auto: []\r\nv: 1\r\n'],
    ['odd indentation', 'auto:\n - "lang"\n'],
    ['an indentation jump of four', 'auto:\n    - "lang"\n'],
    ['an indented top level', '  auto: []\n'],
    ['a flow list', 'auto: ["lang"]\n'],
    ['a flow mapping with content', 'purpose: { shoe: [] }\n'],
    ['a plain list scalar', 'auto:\n  - lang\n'],
    ['a single-quoted list scalar', "auto:\n  - 'lang'\n"],
    ['an invalid JSON escape', 'auto:\n  - "\\x41"\n'],
    ['text after a quoted item', 'auto:\n  - "lang" "tone"\n'],
    ['a trailing comment', 'auto: [] # nothing yet\n'],
    ['a YAML 1.1 boolean (yes)', 'history:\n  assistant: yes\n'],
    ['a capitalised boolean (True)', 'history:\n  assistant: True\n'],
    ['an upper-case boolean (FALSE)', 'history:\n  assistant: FALSE\n'],
    ['a quoted boolean', 'history:\n  assistant: "true"\n'],
    ['a boolean with trailing text', 'history:\n  assistant: true!\n'],
    ['a boolean list item', 'auto:\n  - true\n'],
    ['a boolean with two spaces', 'history:\n  assistant:  true\n'],
    ['a string scalar', 'v: one\n'],
    ['a quoted scalar value', 'v: "1"\n'],
    ['a float', 'ranking:\n  winRate: 1.5\n'],
    ['a leading zero', 'v: 01\n'],
    ['an unsafe integer', 'v: 9007199254740993\n'],
    ['negative zero', 'v: -0\n'],
    ['an anchor', 'auto: &a []\n'],
    ['a duplicate key', 'auto: []\nauto: []\n'],
    ['a key with no value at the end', 'write: []\nauto:\n'],
    ['a key with no value before a sibling', 'auto:\nwrite: []\n'],
    ['a list item where a key belongs', '- "lang"\n'],
    ['a key inside a list', 'auto:\n  - "lang"\n  shoe: []\n'],
    ['an item inside a mapping', 'auto:\n  shoe: []\n  - "lang"\n'],
    ['no space after the colon', 'auto:[]\n'],
    ['an unterminated quoted key', '"auto: []\n'],
    ['a bare word', 'auto\n'],
  ])('rejects %s with an Error naming the line', (_, text) => {
    expect(() => parsePolicyYaml(text)).toThrow(/^POLICY\.yaml line \d+: /u);
    expect(() => parsePolicyDocument(text)).toThrow(Error);
  });

  it('rejects a malformed tail instead of returning the part it could read', () => {
    const valid = renderInstalledPolicyYaml(DEFAULT_POLICY, AT);
    expect(() => parsePolicyDocument(`${valid}ranking: {winRate: 1}\n`)).toThrow(/line \d+/u);
  });

  it('the renderer refuses values outside the subset and multi-line headers', () => {
    expect(() => renderPolicyYaml({ v: 1.5 })).toThrow(TypeError);
    expect(() => renderPolicyYaml({ v: -0 })).toThrow(TypeError);
    expect(() => renderPolicyYaml({ auto: [true] })).toThrow(TypeError);
    expect(() => renderPolicyYaml({ v: 1n })).toThrow(TypeError);
    expect(() => renderPolicyYaml({ v: null })).toThrow(TypeError);
    expect(() => renderPolicyYaml({ v: 'one' })).toThrow(TypeError);
    expect(() => renderPolicyYaml({ auto: [1] })).toThrow(TypeError);
    expect(() => renderPolicyYaml({ auto: [] }, '# one\n# two')).toThrow(TypeError);
    expect(() => renderPolicyYaml({ auto: [] }, 'not a comment')).toThrow(TypeError);
    expect(() => renderInstalledPolicyYaml(DEFAULT_POLICY, `${AT}\nv: 2`)).toThrow(TypeError);
    // `undefined` is skipped, as JSON would, so an absent optional section renders like a missing one.
    expect(renderPolicyYaml({ v: 1, ranking: undefined }, '# x')).toBe('# x\nv: 1\n');
  });

  it('emits and accepts exactly `true` and `false` as scalars, in key order', () => {
    const text = renderPolicyYaml({ history: { personal: true, assistant: false }, v: 1 }, '# x');
    expect(text).toBe('# x\nhistory:\n  personal: true\n  assistant: false\nv: 1\n');
    const parsed = parsePolicyYaml(text);
    expect(parsed).toEqual({ history: { personal: true, assistant: false }, v: 1 });
    expect(JSON.stringify(parsed)).toBe('{"history":{"personal":true,"assistant":false},"v":1}');
    expect(renderPolicyYaml(parsed, '# x')).toBe(text);
    expect(parsePolicyYaml('a: true\nb: false\n')).toEqual({ a: true, b: false });
  });

  it('round-trips the default history section: personal true, assistant false', () => {
    const text = renderInstalledPolicyYaml(DEFAULT_POLICY, AT);
    expect(text.endsWith('\nhistory:\n  personal: true\n  assistant: false\n')).toBe(true);
    const parsed = parsePolicyDocument(text);
    expect(parsed.history).toEqual({ personal: true, assistant: false });
    expect(policyHistory(parsed, 'personal')).toBe(true);
    expect(policyHistory(parsed, 'assistant')).toBe(false);
    expect(policyId(parsed)).toBe('1fcaae3c5185');
  });

  it('round-trips an installed document with history.assistant true under its own id', () => {
    const doc = structuredClone(DEFAULT_POLICY) as PolicyDocument;
    doc.history = { personal: true, assistant: true };
    expect(policyViolations(doc)).toEqual([]);
    const text = renderInstalledPolicyYaml(doc, AT);
    expect(text.split('\n', 1)[0]).toBe(`# Installed field policy · policyId ${policyId(doc)} · ${AT}`);
    expect(text).toContain('\nhistory:\n  personal: true\n  assistant: true\n');
    const parsed = parsePolicyDocument(text);
    expect(parsed).toEqual(doc);
    expect(JSON.stringify(parsed)).toBe(JSON.stringify(doc));
    expect(policyId(parsed)).toBe(policyId(doc));
    expect(policyId(parsed)).not.toBe(policyId(DEFAULT_POLICY));
    expect(policyHistory(parsed, 'assistant')).toBe(true);
    expect(renderInstalledPolicyYaml(parsed, AT)).toBe(text);
  });

  it('reads a merchant history switch back unchanged, so the workspace refuses it by name', () => {
    const doc = structuredClone(DEFAULT_POLICY) as PolicyDocument;
    doc.history = { personal: true, assistant: false, retail: true };
    const parsed = parsePolicyDocument(renderInstalledPolicyYaml(doc, AT));
    expect(parsed.history).toEqual({ personal: true, assistant: false, retail: true });
    expect(policyViolations(parsed)).toEqual(['history.retail: merchants never read history']);
    expect(policyHistory(parsed, 'retail')).toBe(false);
  });

  it('parses an older installed document without history: no history key, and it keeps its old id', () => {
    const { history: _history, ...older } = structuredClone(DEFAULT_POLICY) as PolicyDocument;
    const text = renderPolicyYaml(older, `# Installed field policy · policyId ${policyId(older)} · 2026-10-17T12:05:00.000Z`);
    expect(text).not.toMatch(/^history:/mu);
    const parsed = parsePolicyDocument(text);
    expect(Object.hasOwn(parsed, 'history')).toBe(false);
    expect(policyViolations(parsed)).toEqual([]);
    expect(policyId(parsed)).toBe('3526a909e404');
    expect(policyHistory(parsed, 'personal')).toBe(true);
    expect(policyHistory(parsed, 'assistant')).toBe(false);
  });

  it.each([
    ['yes', 'history:\n  personal: true\n  assistant: yes\n', 3],
    ['True', 'v: 1\nhistory:\n  assistant: True\n', 3],
    ['quoted "false"', 'history:\n  assistant: "false"\n', 2],
    ['on', 'history:\n  assistant: on\n', 2],
  ])('names the line of a malformed boolean (%s)', (_, text, line) => {
    expect(() => parsePolicyYaml(text)).toThrow(new RegExp(`^POLICY\\.yaml line ${line}: "assistant": expected \\[\\], \\{\\}, an integer, true, false`, 'u'));
  });
});
