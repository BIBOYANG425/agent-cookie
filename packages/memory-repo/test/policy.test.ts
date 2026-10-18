import { readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_POLICY, policyId, type PolicyDocument } from '@agent-cookie/contract';
import { parsePolicyDocument, renderInstalledPolicyYaml, renderPolicyYaml } from '@agent-cookie/rules';
import { openMemoryRepo } from '../src/index.js';
import { AT, contribution, fixture, meta as writeMeta, repoGit } from './helpers.js';

const temps: string[] = [];
async function setup() {
  const f = await fixture();
  temps.push(f.temp);
  return f;
}
afterEach(async () => { await Promise.all(temps.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
const sampleSeed = resolve(dirname(fileURLToPath(import.meta.url)), '../../../fixtures/memory');
const INSTALL_AT = '2026-10-17T12:05:00.000Z';
const owner = () => ({ ...writeMeta('sample-owner'), at: INSTALL_AT });
const count = async (path: string) => Number((await repoGit(path).raw(['rev-list', '--count', 'HEAD'])).trim());

/**
 * A floor-valid document that differs from the default: ranking on, deadline off for retail, lists reordered, and the
 * company-assistant row narrowed (no pref.recipient on the handshake, shoe_size the only write).
 */
function installed(): PolicyDocument {
  const doc = structuredClone(DEFAULT_POLICY) as PolicyDocument;
  doc.auto.retail = [...doc.auto.retail].filter((f) => f !== 'deadline').reverse();
  doc.write.personal = [...doc.write.personal].reverse();
  doc.auto.assistant = [...doc.auto.assistant].filter((f) => f !== 'pref.recipient');
  doc.write.assistant = ['shoe_size'];
  doc.ranking = { winRate: 40, failure: 60 };
  return doc;
}

async function commitByHand(path: string, file: string, content: string | Buffer) {
  await writeFile(join(path, file), content);
  const git = repoGit(path);
  await git.add(['--', file]);
  await git.raw(['-c', 'user.name=skill', '-c', 'user.email=skill@invalid', '-c', 'core.hooksPath=/dev/null',
    '-c', 'commit.gpgsign=false', 'commit', '-m', 'Hand edit']);
}

describe('Phase 1 POLICY.yaml in the memory repository', () => {
  it('a seed repository has no installed policy: the Sample seed (generated header) and any other seed bytes', async () => {
    const f = await setup();
    const sample = await openMemoryRepo({ ...f.opts, seedDir: sampleSeed });
    const seeded = await readFile(join(f.path, 'POLICY.yaml'), 'utf8');
    expect(seeded).toBe(renderPolicyYaml());
    // The regenerated seed carries the assistant category and the history section, so it reads as the current
    // DEFAULT_POLICY id.
    expect(seeded.match(/^  assistant:/gmu)).toHaveLength(4);
    expect(seeded.endsWith('\nhistory:\n  personal: true\n  assistant: false\n')).toBe(true);
    expect(policyId(parsePolicyDocument(seeded))).toBe(policyId(DEFAULT_POLICY));
    expect(policyId(parsePolicyDocument(seeded))).toBe('1fcaae3c5185');
    expect(await sample.readPolicy()).toBeUndefined();

    const other = await setup();
    const repo = await other.open();
    expect(await readFile(join(other.path, 'POLICY.yaml'), 'utf8')).toBe('sample: true\n');
    expect(await repo.readPolicy()).toBeUndefined();
  });

  it('writePolicy commits once as the owner; readPolicy returns the same document, also from a fresh handle', async () => {
    const f = await setup();
    const repo = await openMemoryRepo({ ...f.opts, seedDir: sampleSeed });
    const doc = installed();
    const before = await count(f.path);
    const commit = await repo.writePolicy(doc, owner());
    const git = repoGit(f.path);
    expect(await count(f.path)).toBe(before + 1);
    expect(commit.sha).toBe(await git.revparse(['HEAD']));
    expect(await git.raw(['show', '-s', '--format=%an%n%aI%n%B', 'HEAD'])).toMatch(new RegExp(
      `^sample-owner\\n2026-10-17T12:05:00(?:Z|\\+00:00)\\nInstall policy ${policyId(doc)}\\n\\nAgent-Cookie-Sig: test-payload-signature\\n`, 'u'));
    expect((await git.raw(['show', '--name-only', '--format=', 'HEAD'])).trim()).toBe('POLICY.yaml');
    const file = await readFile(join(f.path, 'POLICY.yaml'), 'utf8');
    expect(file).toBe(renderInstalledPolicyYaml(doc, INSTALL_AT));
    expect(file.split('\n', 1)[0]).toBe(`# Installed field policy · policyId ${policyId(doc)} · ${INSTALL_AT}`);

    expect(file).toContain('\n  assistant: {}\nwrite:\n');
    expect(file.endsWith('\n  assistant:\n    - "shoe_size"\nhistory:\n  personal: true\n  assistant: false\nranking:\n  winRate: 40\n  failure: 60\n')).toBe(true);

    const read = await repo.readPolicy();
    expect(read).toEqual(doc);
    expect(JSON.stringify(read)).toBe(JSON.stringify(doc));
    expect(read!.ranking).toEqual({ winRate: 40, failure: 60 });
    expect(read!.auto.assistant).toEqual(DEFAULT_POLICY.auto.assistant.filter((f) => f !== 'pref.recipient'));
    expect(read!.purpose.assistant).toEqual({});
    expect(read!.write.assistant).toEqual(['shoe_size']);
    // A restart opens a new handle on the same working tree.
    const reopened = await openMemoryRepo({ ...f.opts, seedDir: sampleSeed });
    expect(await reopened.readPolicy()).toEqual(doc);
    expect((await git.raw(['status', '--porcelain'])).trim()).toBe('');
  });

  it('writePolicy → readPolicy carries history.assistant: true (and an older document without history stays without)', async () => {
    const f = await setup();
    const repo = await openMemoryRepo({ ...f.opts, seedDir: sampleSeed });
    const doc = structuredClone(DEFAULT_POLICY) as PolicyDocument;
    doc.history = { personal: true, assistant: true };
    await repo.writePolicy(doc, owner());
    const file = await readFile(join(f.path, 'POLICY.yaml'), 'utf8');
    expect(file).toContain('\nhistory:\n  personal: true\n  assistant: true\n');
    const read = await repo.readPolicy();
    expect(read!.history).toEqual({ personal: true, assistant: true });
    expect(JSON.stringify(read)).toBe(JSON.stringify(doc));
    expect(policyId(read!)).toBe(policyId(doc));
    expect(await (await openMemoryRepo({ ...f.opts, seedDir: sampleSeed })).readPolicy()).toEqual(doc);

    const { history: _history, ...older } = structuredClone(DEFAULT_POLICY) as PolicyDocument;
    await repo.writePolicy(older, owner());
    const olderRead = await repo.readPolicy();
    expect(Object.hasOwn(olderRead!, 'history')).toBe(false);
    expect(policyId(olderRead!)).toBe('3526a909e404');
  });

  it('refuses a merchant history switch without committing', async () => {
    const f = await setup();
    const repo = await openMemoryRepo({ ...f.opts, seedDir: sampleSeed });
    const doc = structuredClone(DEFAULT_POLICY) as PolicyDocument;
    doc.history = { personal: true, assistant: false, shoe: true };
    const before = await count(f.path);
    await expect(repo.writePolicy(doc, owner())).rejects.toThrow(/history\.shoe: merchants never read history/u);
    expect(await count(f.path)).toBe(before);
  });

  it('an explicitly installed DEFAULT_POLICY is the owner\'s policy, not the seed', async () => {
    const f = await setup();
    const repo = await openMemoryRepo({ ...f.opts, seedDir: sampleSeed });
    await repo.writePolicy(structuredClone(DEFAULT_POLICY) as PolicyDocument, owner());
    expect(await repo.readPolicy()).toEqual(DEFAULT_POLICY);
  });

  it('resetToSeed brings POLICY.yaml back to the seed bytes and readPolicy back to undefined', async () => {
    const f = await setup();
    const repo = await openMemoryRepo({ ...f.opts, seedDir: sampleSeed });
    const seed = await readFile(join(sampleSeed, 'POLICY.yaml'), 'utf8');
    await repo.writePolicy(installed(), owner());
    await repo.appendContribution(contribution(), writeMeta());
    await repo.resetToSeed();
    expect(await readFile(join(f.path, 'POLICY.yaml'), 'utf8')).toBe(seed);
    expect(await repo.readPolicy()).toBeUndefined();
    expect((await repoGit(f.path).raw(['status', '--porcelain', '--', 'POLICY.yaml'])).trim()).toBe('');
    expect(await repoGit(f.path).raw(['show', '-s', '--format=%s', 'HEAD'])).toBe('Reset managed memory paths to seed\n');
    // Writes resume after the reset.
    await repo.writePolicy(installed(), owner());
    expect(await repo.readPolicy()).toEqual(installed());
  });

  it('a malformed POLICY.yaml rejects with an Error rather than a partial document', async () => {
    const f = await setup();
    const repo = await f.open();
    const valid = renderInstalledPolicyYaml(installed(), INSTALL_AT);
    await commitByHand(f.path, 'POLICY.yaml', `${valid}ranking: {winRate: 1}\n`);
    await expect(repo.readPolicy()).rejects.toThrow(/^POLICY\.yaml line \d+: /u);
    await commitByHand(f.path, 'POLICY.yaml', 'auto:\n\t- "lang"\n');
    await expect(repo.readPolicy()).rejects.toThrow(Error);
    await commitByHand(f.path, 'POLICY.yaml', Buffer.concat([Buffer.from('# Installed field policy\nauto:\n  - "'), Buffer.from([0xff]), Buffer.from('"\n')]));
    await expect(repo.readPolicy()).rejects.toThrow('POLICY.yaml is not valid UTF-8');
  });

  it('returns a hand-written policy as written, invalid or not, and treats unmarked default content as the seed', async () => {
    const f = await setup();
    const repo = await f.open();
    const loose = { ...structuredClone(DEFAULT_POLICY), v: 2 };
    await commitByHand(f.path, 'POLICY.yaml', renderPolicyYaml(loose, '# my own policy'));
    expect(await repo.readPolicy()).toEqual(loose);
    await commitByHand(f.path, 'POLICY.yaml', renderPolicyYaml(DEFAULT_POLICY, '# copied from the docs'));
    expect(await repo.readPolicy()).toBeUndefined();
  });

  it('refuses an assistant row below the floor, or a document without the assistant category, without committing', async () => {
    const f = await setup();
    const repo = await f.open();
    const before = await count(f.path);
    const address = structuredClone(DEFAULT_POLICY) as PolicyDocument;
    address.auto.assistant = [...address.auto.assistant, 'shipping_address'];
    await expect(repo.writePolicy(address, owner())).rejects.toMatchObject({ code: 'MISSING_FIELD',
      message: 'auto.assistant: shipping_address may never be auto' });
    const token = structuredClone(DEFAULT_POLICY) as PolicyDocument;
    token.purpose.assistant = { payment_method: ['payment'] };
    await expect(repo.writePolicy(token, owner())).rejects.toMatchObject({ code: 'MISSING_FIELD',
      message: 'purpose.assistant.payment_method: an assistant never reads payment_method, whatever the purpose' });
    const older = structuredClone(DEFAULT_POLICY) as PolicyDocument;
    for (const section of ['auto', 'purpose', 'write'] as const) delete (older[section] as Partial<Record<string, unknown>>).assistant;
    await expect(repo.writePolicy(older, owner())).rejects.toMatchObject({ code: 'MISSING_FIELD',
      message: 'auto.assistant missing; purpose.assistant missing; write.assistant missing' });
    expect(await count(f.path)).toBe(before);
    expect(await readFile(join(f.path, 'POLICY.yaml'), 'utf8')).toBe('sample: true\n');
    expect(await repo.readPolicy()).toBeUndefined();
  });

  it('refuses a document below the floor without committing, and uncommitted POLICY.yaml edits block writes', async () => {
    const f = await setup();
    const repo = await f.open();
    const bad = structuredClone(DEFAULT_POLICY) as PolicyDocument;
    bad.auto.retail = [...bad.auto.retail, 'payment_method'];
    delete bad.purpose.retail.payment_method;
    const before = await count(f.path);
    await expect(repo.writePolicy(bad, owner())).rejects.toMatchObject({ code: 'MISSING_FIELD' });
    expect(await count(f.path)).toBe(before);
    expect(await readFile(join(f.path, 'POLICY.yaml'), 'utf8')).toBe('sample: true\n');
    // POLICY.yaml is a managed path now: like CARD.md, a stray edit must be resolved before the workspace writes.
    await writeFile(join(f.path, 'POLICY.yaml'), 'auto: []\n');
    await expect(repo.appendContribution(contribution(), writeMeta())).rejects.toThrow('Managed memory paths have unrelated uncommitted changes');
    await expect(repo.readPolicy()).rejects.toThrow('Managed memory paths have unrelated uncommitted changes');
    await repo.resetToSeed();
    expect(await readFile(join(f.path, 'POLICY.yaml'), 'utf8')).toBe('sample: true\n');
    await repo.appendContribution(contribution(), writeMeta());
  });

  it('serializes policy writes with every other write through the same queue', async () => {
    const f = await setup();
    const repo = await f.open();
    const second = await openMemoryRepo(f.opts);
    const before = await count(f.path);
    const results = await Promise.all([
      repo.writePolicy(installed(), owner()),
      second.appendContribution(contribution('c1'), writeMeta()),
      repo.writePolicy(structuredClone(DEFAULT_POLICY) as PolicyDocument, { ...owner(), at: AT }),
      second.appendContribution(contribution('c2'), writeMeta()),
    ]);
    expect(new Set(results.map((r) => r.sha)).size).toBe(4);
    expect(await count(f.path)).toBe(before + 4);
    expect(await repo.readPolicy()).toEqual(DEFAULT_POLICY);
    expect((await repo.listContributions()).map((c) => c.id)).toEqual(['c1', 'c2']);
  });
});
