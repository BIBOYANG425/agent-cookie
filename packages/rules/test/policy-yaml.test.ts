import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_POLICY, POLICY_TABLE, policyId, policyViolations, type PolicyDocument } from '@agent-cookie/contract';
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
    ['a boolean', 'v: true\n'],
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
    expect(() => renderPolicyYaml({ v: true })).toThrow(TypeError);
    expect(() => renderPolicyYaml({ v: null })).toThrow(TypeError);
    expect(() => renderPolicyYaml({ v: 'one' })).toThrow(TypeError);
    expect(() => renderPolicyYaml({ auto: [1] })).toThrow(TypeError);
    expect(() => renderPolicyYaml({ auto: [] }, '# one\n# two')).toThrow(TypeError);
    expect(() => renderPolicyYaml({ auto: [] }, 'not a comment')).toThrow(TypeError);
    expect(() => renderInstalledPolicyYaml(DEFAULT_POLICY, `${AT}\nv: 2`)).toThrow(TypeError);
    // `undefined` is skipped, as JSON would, so an absent optional section renders like a missing one.
    expect(renderPolicyYaml({ v: 1, ranking: undefined }, '# x')).toBe('# x\nv: 1\n');
  });
});
