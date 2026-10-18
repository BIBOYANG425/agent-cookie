import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  DEFAULT_POLICY, NOTE_MAX_BYTES, WorkspaceError, canonicalPolicy, policyId, policyViolations,
  type Card, type CommitRef, type Contribution, type MemoryRepo, type MemoryRepoApi,
  type MergeOptions, type OpenMemoryRepoOptions, type RulesApi, type WriteMeta,
} from '@agent-cookie/contract';
// The POLICY.yaml codec is the one runtime import from rules: the seed generator and writePolicy share its writer.
import { parsePolicyDocument, policyYamlOrigin, renderInstalledPolicyYaml } from '@agent-cookie/rules';
import type { LearningCard, LearningContribution, LearningMergeOptions } from '@agent-cookie/rules';
import {
  filename, metadata, ownerFromFilename, parseNotes, renderNotes, renderReceipt,
  text, timestamp, validateNote,
} from './codec.js';
import {
  assertFileBoundary, assertRepository, canonicalRoot, commitFiles, exclusive, initialize,
  optionalFile, recordFiles, restoreSeed, seedFile, type Marker,
} from './storage.js';
import type { ContributionRevocationApi, ContributionRevocationTarget, IntentHistoryApi, LearningMemoryRepo, MemoryRepoWithIntents, OpenLearningMemoryRepoOptions, PolicyFileApi } from './learning-types.js';
import { intentFilename, parseIntent, projectIntent, renderIntent, summarizeIntent, validateLearningContribution } from './intent-history.js';
export type { AppendIntentInput, WorkspaceIntentRecord, IntentSummary, IntentHistoryApi, MemoryRepoWithIntents } from './learning-types.js';
export type { ContributionRevocationApi, ContributionRevocationTarget } from './learning-types.js';
export type { LearningMemoryRepo, OpenLearningMemoryRepoOptions, PolicyFileApi } from './learning-types.js';

export const openLearningMemoryRepo = (opts: OpenLearningMemoryRepoOptions): Promise<LearningMemoryRepo> =>
  openRepository<LearningContribution, LearningCard, LearningMergeOptions>(opts, validateLearningContribution);

export const openMemoryRepo = (opts: OpenMemoryRepoOptions): Promise<MemoryRepoWithIntents> =>
  openRepository<Contribution, Card, MergeOptions>(opts, validateLearningContribution);

type MergeInput = { readonly now: string; readonly personalAgentIds: readonly string[] };
const POLICY_FILE = 'POLICY.yaml';
interface StorageRules<C, K, M> {
  renderContribution(c: C): string;
  parseContributions(markdown: string, owner: Parameters<RulesApi['parseContributions']>[1]): C[];
  mergeCard(contributions: readonly C[], merge: M): K;
  renderCard(card: K, meta: Parameters<RulesApi['renderCard']>[1]): string;
}
type Repository<C, K, M> = Omit<MemoryRepo, 'appendIntent' | 'appendContribution' | 'listContributions' | 'regenerateCard' | 'revokeContribution' | 'forgetContributions' | 'revokeContributions' | 'readPolicy' | 'writePolicy'> & IntentHistoryApi & ContributionRevocationApi & PolicyFileApi & {
  forgetContributions(ids: string[], merge: M, meta: WriteMeta): Promise<CommitRef>;
  revokeContributions(ids: readonly string[], revokedAt: string, merge: M, meta: WriteMeta): Promise<{card: K; commit: CommitRef}>;
  appendContribution(c: C, meta: WriteMeta): Promise<CommitRef>;
  listContributions(): Promise<C[]>;
  regenerateCard(merge: M, meta: WriteMeta): Promise<{ card: K; commit: CommitRef }>;
};

function revocationMatches(target: ContributionRevocationTarget): (row: LearningContribution) => boolean {
  if (typeof target === 'string') { text(target); return row => row.id === target; }
  const invalid = () => { throw new WorkspaceError('MISSING_FIELD', 'Invalid contribution evidence selector'); };
  if (!target || typeof target !== 'object' || Array.isArray(target)
    || Object.keys(target).length !== 1 || !Object.hasOwn(target, 'evidence')) return invalid();
  const evidence = target.evidence;
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return invalid();
  const keys = Object.keys(evidence);
  if (!keys.length || keys.some(key => key !== 'intentId' && key !== 'conversationId')) return invalid();
  for (const key of keys) {
    const value = evidence[key as keyof typeof evidence];
    text(value);
    if (!value.trim()) return invalid();
  }
  return row => {
    const nested = typeof row.evidence === 'object' && row.evidence !== null ? row.evidence : {};
    for (const key of ['intentId', 'conversationId'] as const) {
      if (nested[key] !== undefined && row[key] !== undefined && nested[key] !== row[key]) return false;
      if (evidence[key] !== undefined && (nested[key] ?? row[key]) !== evidence[key]) return false;
    }
    return true;
  };
}

async function openRepository<C extends LearningContribution, K, M extends MergeInput>(
  opts: Omit<OpenMemoryRepoOptions, 'rules'> & { rules: StorageRules<C, K, M> },
  validate: (c: C, userId: string) => void,
): Promise<Repository<C, K, M>> {
  text(opts.path); text(opts.seedDir); text(opts.userId);
  const root = await canonicalRoot(opts.path);
  const userId = opts.userId;
  const rules = opts.rules;
  await exclusive(root, () => initialize(root, opts.seedDir, userId));
  const perform = <T>(action: (marker: Marker) => Promise<T>) => exclusive(root, async () => action(await assertRepository(root, userId)));
  const list = async (): Promise<C[]> => {
    const contributions: C[] = [];
    for (const name of await recordFiles(root, 'contributions')) {
      contributions.push(...rules.parseContributions(await readFile(join(root, 'contributions', name), 'utf8'), {
        userId, agentId: ownerFromFilename(name),
      }));
    }
    return contributions;
  };
  const noteFile = (sessionId: string) => `notes/${filename(sessionId)}`;
  const notes = async (path: string) => parseNotes((await optionalFile(join(root, path)))?.toString('utf8') ?? '', userId);
  const repo: Repository<C, K, M> = {
    appendIntent(input, meta) {
      return perform(async () => {
        metadata(meta);
        const record = projectIntent(input, userId, meta.at);
        if (meta.author !== (record.agentId ?? 'personal')) throw new WorkspaceError('SCOPE_DENIED');
        const path = `intents/${intentFilename(record.intent.id, meta.at)}`;
        await assertFileBoundary(root, path);
        const previous = (await optionalFile(join(root, path)))?.toString('utf8') ?? '';
        const content = `${previous}${previous && !previous.endsWith('\n') ? '\n' : ''}${renderIntent(record)}\n`;
        return commitFiles(root, new Map([[path, content]]), meta, 'Append sanitized intent');
      });
    },
    searchIntents(q) {
      return perform(async () => {
        text(q, false);
        const terms = q.trim().toLowerCase().split(/\s+/u).filter(Boolean);
        if (terms.length === 0) return [];
        const found = [];
        for (const name of await recordFiles(root, 'intents')) {
          const content = await readFile(join(root, 'intents', name), 'utf8');
          for (const line of content.split('\n')) {
            const record = parseIntent(line, userId, name);
            if (!record) continue;
            const summary = summarizeIntent(record);
            if (terms.every((term) => summary.summary.toLowerCase().includes(term))) found.push(summary);
          }
        }
        return found;
      });
    },
    appendContribution(c, meta) {
      return perform(async () => {
        metadata(meta); validate(c, userId);
        if (meta.author !== c.agentId) throw new WorkspaceError('SCOPE_DENIED');
        const path = `contributions/${filename(c.agentId)}`;
        const previous = (await optionalFile(join(root, path)))?.toString('utf8') ?? '';
        const content = `${previous}${previous && !previous.endsWith('\n') ? '\n' : ''}${rules.renderContribution(c)}\n`;
        return commitFiles(root, new Map([[path, content]]), meta, 'Append contribution');
      });
    },
    revokeContribution(target, revokedAt, meta) {
      return perform(async () => {
        const matches = revocationMatches(target);
        timestamp(revokedAt); metadata(meta);
        const updates = new Map<string, string>();
        for (const name of await recordFiles(root, 'contributions')) {
          const path = `contributions/${name}`;
          const content = await readFile(join(root, path), 'utf8');
          let changed = false;
          const updated = content.split('\n').map((line) => {
            const c = rules.parseContributions(line, { userId, agentId: ownerFromFilename(name) })[0];
            if (!c || !matches(c)) return line;
            changed = true;
            const revoked = Object.create(Object.getPrototypeOf(c), Object.getOwnPropertyDescriptors(c)) as C;
            Object.assign(revoked, { revokedAt });
            return rules.renderContribution(revoked);
          }).join('\n');
          if (changed) updates.set(path, updated);
        }
        return updates.size ? commitFiles(root, updates, meta, 'Revoke contribution') : { sha: '' };
      });
    },
    revokeContributions(ids, revokedAt, merge, meta) {
      return perform(async () => {
        metadata(meta); timestamp(revokedAt); timestamp(merge.now);
        if (!Array.isArray(ids) || ids.length > 10000) throw new WorkspaceError('MISSING_FIELD');
        ids.forEach(id => text(id));
        const selected = new Set(ids);
        const all = await list();
        const next = all.map(row => {
          if (!selected.has(row.id) || row.revokedAt) return row;
          const copy = { ...row, revokedAt };
          if (typeof copy.evidence === 'object' && copy.evidence) {
            copy.evidence = { ...copy.evidence }; delete copy.evidence.snippet;
          } else if (typeof copy.evidence === 'string') delete copy.evidence;
          return copy;
        });
        const card = rules.mergeCard(next, merge);
        if (!all.some(row => selected.has(row.id) && !row.revokedAt)) return { card, commit: { sha: '' } };
        const byId = new Map(next.map(row => [row.id, row]));
        const updates = new Map<string, string>();
        for (const name of await recordFiles(root, 'contributions')) {
          const path = `contributions/${name}`;
          const content = await readFile(join(root, path), 'utf8');
          const updated = content.split('\n').map(line => {
            const row = rules.parseContributions(line, { userId, agentId: ownerFromFilename(name) })[0];
            return row && selected.has(row.id) && !row.revokedAt ? rules.renderContribution(byId.get(row.id)!) : line;
          }).join('\n');
          if (updated !== content) updates.set(path, updated);
        }
        updates.set('CARD.md', rules.renderCard(card, { userId, generatedAt: meta.at }));
        return { card, commit: await commitFiles(root, updates, meta, 'Revoke source contributions') };
      });
    },
    forgetContributions(ids, merge, meta) {
      return perform(async () => {
        metadata(meta); timestamp(merge.now);
        if (!Array.isArray(ids) || ids.length > 10000 || !Array.isArray(merge.personalAgentIds)) throw new WorkspaceError('MISSING_FIELD');
        ids.forEach(id => text(id));
        const selected = new Set(ids);
        const remaining = (await list()).filter(row => !selected.has(row.id));
        const updates = new Map<string, string>();
        for (const name of await recordFiles(root, 'contributions')) {
          const path = `contributions/${name}`;
          const content = await readFile(join(root, path), 'utf8');
          const cleaned = content.split('\n').filter(line => {
            const row = rules.parseContributions(line, { userId, agentId: ownerFromFilename(name) })[0];
            return !row || !selected.has(row.id);
          }).join('\n');
          if (cleaned !== content) updates.set(path, cleaned);
        }
        // Older preview histories could embed extracted preferences. Remove their current copies too.
        for (const name of await recordFiles(root, 'intents')) {
          const path = `intents/${name}`;
          const content = await readFile(join(root, path), 'utf8');
          const cleaned = content.split('\n').map(line => {
            const record = parseIntent(line, userId, name);
            if (!record || !record.extracted.some(row => selected.has(row.id))) return line;
            record.extracted = record.extracted.filter(row => !selected.has(row.id));
            return renderIntent(record);
          }).join('\n');
          if (cleaned !== content) updates.set(path, cleaned);
        }
        const card = rules.renderCard(rules.mergeCard(remaining, merge), { userId, generatedAt: meta.at });
        if (card !== await readFile(join(root, 'CARD.md'), 'utf8')) updates.set('CARD.md', card);
        return updates.size ? commitFiles(root, updates, meta, 'Forget current preference') : { sha: '' };
      });
    },
    listContributions() { return perform(list); },
    writeNote(sessionId, note, meta) {
      return perform(async () => {
        metadata(meta); validateNote(note, userId);
        const path = noteFile(sessionId);
        const previous = await notes(path);
        if (previous[0] && previous[0].agentId !== note.agentId) throw new WorkspaceError('SCOPE_DENIED');
        const index = previous.findIndex((entry) => entry.key === note.key);
        if (index === -1) previous.push(note); else previous[index] = note;
        const content = renderNotes(previous);
        if (Buffer.byteLength(content, 'utf8') > NOTE_MAX_BYTES) {
          throw new WorkspaceError('MISSING_FIELD', 'Note file exceeds the allowed size');
        }
        return commitFiles(root, new Map([[path, content]]), meta, 'Write note');
      });
    },
    readNote(sessionId, agentId, key, now) {
      return perform(async () => {
        text(agentId); text(key); timestamp(now);
        return (await notes(noteFile(sessionId))).find((entry) => entry.agentId === agentId
          && entry.key === key && Date.parse(entry.expiresAt) > Date.parse(now));
      });
    },
    deleteNote(sessionId, agentId, key, meta) {
      return perform(async () => {
        text(agentId); text(key); metadata(meta);
        const path = noteFile(sessionId);
        const previous = await notes(path);
        const remaining = previous.filter((entry) => entry.agentId !== agentId || entry.key !== key);
        if (remaining.length === previous.length) return { sha: '' };
        return commitFiles(root, new Map([[path, remaining.length ? renderNotes(remaining) : null]]), meta, 'Delete note');
      });
    },
    regenerateCard(merge, meta) {
      return perform(async () => {
        metadata(meta); timestamp(merge.now);
        if (!Array.isArray(merge.personalAgentIds)) throw new WorkspaceError('MISSING_FIELD', 'Personal agent IDs are required');
        for (const agentId of merge.personalAgentIds) text(agentId);
        const card = rules.mergeCard(await list(), merge);
        const content = rules.renderCard(card, { userId, generatedAt: meta.at });
        const commit = await commitFiles(root, new Map([['CARD.md', content]]), meta, 'Regenerate card');
        return { card, commit };
      });
    },
    appendReceipt(receipt, meta) {
      return perform(async () => {
        metadata(meta);
        const record = renderReceipt(receipt);
        const previous = await readFile(join(root, 'receipts.md'), 'utf8');
        const content = `${previous}${previous && !previous.endsWith('\n') ? '\n' : ''}${record}\n`;
        return commitFiles(root, new Map([['receipts.md', content]]), meta, 'Append receipt');
      });
    },
    readPolicy() {
      return perform(async (marker) => {
        // Layout validation requires POLICY.yaml, so "absent" only guards a repo that changed under us.
        const bytes = await optionalFile(join(root, POLICY_FILE));
        if (bytes === undefined) return undefined;
        const content = bytes.toString('utf8');
        if (!Buffer.from(content, 'utf8').equals(bytes)) throw new Error('POLICY.yaml is not valid UTF-8');
        // Seed or installed, decided by deterministic checks only:
        //  - installed header (`# Installed field policy · …`, written by writePolicy) → installed, whatever it says;
        //  - generated seed header (`# Generated from @agent-cookie/contract POLICY_TABLE…`) → seed;
        //  - unmarked: byte-identical to this repo's fixtures-seed POLICY.yaml, or canonically DEFAULT_POLICY → seed;
        //    anything else unmarked is a hand-written policy and is returned like an installed one.
        // A returned document is exactly what the file says; the workspace validates it (policyViolations).
        const origin = policyYamlOrigin(content);
        if (origin === 'seed') return undefined;
        if (origin === 'unmarked' && bytes.equals(await seedFile(root, marker, POLICY_FILE))) return undefined;
        const doc = parsePolicyDocument(content);
        if (origin === 'unmarked' && canonicalPolicy(doc) === canonicalPolicy(DEFAULT_POLICY)) return undefined;
        return doc;
      });
    },
    writePolicy(doc, meta) {
      return perform(async () => {
        metadata(meta);
        // The workspace validates first; this keeps the repo from ever holding a document it would refuse on load.
        const violations = policyViolations(doc);
        if (violations.length) throw new WorkspaceError('MISSING_FIELD', violations.join('; '));
        const content = renderInstalledPolicyYaml(doc, meta.at);
        return commitFiles(root, new Map([[POLICY_FILE, content]]), meta, `Install policy ${policyId(doc)}`);
      });
    },
    resetToSeed() { return exclusive(root, () => restoreSeed(root, userId)); },
  };
  return repo;
}

export const memoryRepo: MemoryRepoApi = { openMemoryRepo };
