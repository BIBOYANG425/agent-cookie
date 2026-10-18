import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_POLICY, POLICY_TABLE, policyId } from '@agent-cookie/contract';
import * as generator from '../scripts/generate-seed.js';
import { parseContributions, parsePolicyDocument } from '../src/index.js';

const fixtures = fileURLToPath(new URL('../../../fixtures/', import.meta.url));
const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

describe('C21 generated memory seed', () => {
  it('generates a short entry index whose root-relative wikilinks resolve to actual seed files', async () => {
    expect(typeof generator.generateSeed).toBe('function');
    const output = await mkdtemp(join(tmpdir(), 'agent-cookie-seed-format-')); temporary.push(output);
    await generator.generateSeed({ fixturesDir: fixtures, seedDir: output });
    const entry = await readFile(join(output, 'MEMORY.md'), 'utf8');
    expect(entry).toMatch(/^Sample memory: [^\n]+\n\n## Index\n/u);
    const links = [...entry.matchAll(/^- \[\[([^\]]+)\]\]$/gmu)].map((match) => match[1]);
    expect(links).toEqual(['CARD', 'contributions/sample-personal-photon', 'receipts', 'POLICY.yaml', 'archive/README']);
    for (const link of links) await access(join(output, link!.endsWith('.yaml') ? link! : `${link}.md`));
    expect(await readFile(join(output, 'archive/README.md'), 'utf8')).toContain('Sample');
    await expect(access(join(output, 'archive/.gitkeep'))).rejects.toThrow();
    expect(await readFile(join(output, 'POLICY.yaml'), 'utf8')).toBe(generator.renderPolicyYaml(POLICY_TABLE));
  });

  it('fails when the committed seed policy drifts from this runtime contract, including retail and assistant', async () => {
    const seed = await readFile(join(fixtures, 'memory/POLICY.yaml'), 'utf8');
    expect(typeof generator.renderPolicyYaml).toBe('function');
    expect(seed).toBe(generator.renderPolicyYaml(POLICY_TABLE));
    expect(seed).toMatch(/^  retail:/mu);
    // The company-assistant category (bring-your-own-agent plan) sits in all three sections, after retail.
    expect(seed.match(/^  assistant:/gmu)).toHaveLength(3);
    expect(seed).toMatch(/^  assistant: \{\}\nwrite:$/mu);
    expect(seed.indexOf('\n  retail:')).toBeLessThan(seed.indexOf('\n  assistant:'));
  });

  it('pins the policy id the regenerated seed reads as (DEFAULT_POLICY with the assistant category)', async () => {
    const seed = await readFile(join(fixtures, 'memory/POLICY.yaml'), 'utf8');
    // Golden: changes only when the contract's DEFAULT_POLICY (or its canonical form) changes; regenerate the seed then.
    expect(policyId(DEFAULT_POLICY)).toBe('3526a909e404');
    expect(policyId(parsePolicyDocument(seed))).toBe('3526a909e404');
  });

  it('includes the workspace-derived Sample address in the initial commit without changing the three explicit records', async () => {
    const output = await mkdtemp(join(tmpdir(), 'agent-cookie-address-seed-')); temporary.push(output);
    const explicitBefore = await readFile(join(fixtures, 'contributions.json'), 'utf8');
    await generator.generateSeed({ fixturesDir: fixtures, seedDir: output });
    const records = parseContributions(await readFile(join(output, 'contributions/sample-personal-photon.md'), 'utf8'),
      { userId: 'sample-user', agentId: 'sample-personal-photon' });
    const address = JSON.parse(await readFile(join(fixtures, 'address.json'), 'utf8')) as { value: string };
    expect(records).toHaveLength(4);
    expect(records.find((record) => record.id === 'seed-shipping-address-01')).toEqual({
      id: 'seed-shipping-address-01', userId: 'sample-user', agentId: 'sample-personal-photon',
      field: 'shipping_address', value: address.value, basis: 'stated', createdAt: '2026-10-17T16:00:03.000Z',
    });
    const card = await readFile(join(output, 'CARD.md'), 'utf8');
    expect(card).toContain('<!-- generatedAt: 2026-10-17T16:00:03.000Z -->');
    expect(card).toContain('- shipping_address: Sample Recipient, 123 Example Lane');
    expect(await readFile(join(fixtures, 'contributions.json'), 'utf8')).toBe(explicitBefore);
    expect(JSON.parse(explicitBefore)).toHaveLength(3);
  });

  it('emits block YAML with quoted scalar values and empty collections, rather than a JSON document', () => {
    expect(typeof generator.renderPolicyYaml).toBe('function');
    const body = generator.renderPolicyYaml({ auto: { retail: ['tone', 'pref.color', 'yes', 'a: b\nnext'] },
      purpose: { retail: { shipping_address: ['checkout'] }, personal: {} }, write: { retail: [] } });
    expect(body).toBe('# Generated from @agent-cookie/contract POLICY_TABLE. Sample seed.\n'
      + 'auto:\n  retail:\n    - "tone"\n    - "pref.color"\n    - "yes"\n    - "a: b\\nnext"\n'
      + 'purpose:\n  retail:\n    shipping_address:\n      - "checkout"\n  personal: {}\nwrite:\n  retail: []\n');
  });
});
