import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  NOTE_MAX_BYTES, WorkspaceError,
  type Card, type CommitRef, type Contribution, type MemoryRepo, type MemoryRepoApi,
  type MergeOptions, type OpenMemoryRepoOptions, type RulesApi, type WriteMeta,
} from '@agent-cookie/contract';
import type { LearningCard, LearningContribution, LearningMergeOptions } from '@agent-cookie/rules';
import {
  filename, metadata, ownerFromFilename, parseNotes, renderNotes, renderReceipt,
  text, timestamp, validateContribution, validateNote,
} from './codec.js';
import {
  assertRepository, canonicalRoot, commitFiles, exclusive, initialize,
  optionalFile, recordFiles, restoreSeed,
} from './storage.js';
import type { IntentHistoryApi, LearningMemoryRepo, MemoryRepoWithIntents, OpenLearningMemoryRepoOptions } from './learning-types.js';
import { intentFilename, parseIntent, projectIntent, renderIntent, summarizeIntent, validateLearningContribution } from './intent-history.js';
export type { AppendIntentInput, IntentSummary, IntentHistoryApi, MemoryRepoWithIntents } from './learning-types.js';
export type { LearningMemoryRepo, OpenLearningMemoryRepoOptions } from './learning-types.js';

export const openLearningMemoryRepo = (opts: OpenLearningMemoryRepoOptions): Promise<LearningMemoryRepo> =>
  openRepository<LearningContribution, LearningCard, LearningMergeOptions>(opts, validateLearningContribution);

export const openMemoryRepo = (opts: OpenMemoryRepoOptions): Promise<MemoryRepoWithIntents> =>
  openRepository<Contribution, Card, MergeOptions>(opts, validateContribution);

type MergeInput = { readonly now: string; readonly personalAgentIds: readonly string[] };
interface StorageRules<C, K, M> {
  renderContribution(c: C): string;
  parseContributions(markdown: string, owner: Parameters<RulesApi['parseContributions']>[1]): C[];
  mergeCard(contributions: readonly C[], merge: M): K;
  renderCard(card: K, meta: Parameters<RulesApi['renderCard']>[1]): string;
}
type Repository<C, K, M> = Omit<MemoryRepo, 'appendContribution' | 'listContributions' | 'regenerateCard'> & IntentHistoryApi & {
  appendContribution(c: C, meta: WriteMeta): Promise<CommitRef>;
  listContributions(): Promise<C[]>;
  regenerateCard(merge: M, meta: WriteMeta): Promise<{ card: K; commit: CommitRef }>;
};

async function openRepository<C extends LearningContribution, K, M extends MergeInput>(
  opts: Omit<OpenMemoryRepoOptions, 'rules'> & { rules: StorageRules<C, K, M> },
  validate: (c: C, userId: string) => void,
): Promise<Repository<C, K, M>> {
  text(opts.path); text(opts.seedDir); text(opts.userId);
  const root = await canonicalRoot(opts.path);
  const userId = opts.userId;
  const rules = opts.rules;
  await exclusive(root, () => initialize(root, opts.seedDir, userId));
  const perform = <T>(action: () => Promise<T>) => exclusive(root, async () => {
    await assertRepository(root, userId);
    return action();
  });
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
        if (meta.author !== 'personal') throw new WorkspaceError('SCOPE_DENIED');
        const record = projectIntent(input, userId, meta.at);
        const path = `intents/${intentFilename(record.intent.id, meta.at)}`;
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
        const path = `contributions/${filename(c.agentId)}`;
        const previous = (await optionalFile(join(root, path)))?.toString('utf8') ?? '';
        const content = `${previous}${previous && !previous.endsWith('\n') ? '\n' : ''}${rules.renderContribution(c)}\n`;
        return commitFiles(root, new Map([[path, content]]), meta, 'Append contribution');
      });
    },
    revokeContribution(id, revokedAt, meta) {
      return perform(async () => {
        text(id); timestamp(revokedAt); metadata(meta);
        const updates = new Map<string, string>();
        for (const name of await recordFiles(root, 'contributions')) {
          const path = `contributions/${name}`;
          const content = await readFile(join(root, path), 'utf8');
          let changed = false;
          const updated = content.split('\n').map((line) => {
            const c = rules.parseContributions(line, { userId, agentId: ownerFromFilename(name) })[0];
            if (!c || c.id !== id) return line;
            changed = true;
            return rules.renderContribution({ ...c, revokedAt });
          }).join('\n');
          if (changed) updates.set(path, updated);
        }
        return updates.size ? commitFiles(root, updates, meta, 'Revoke contribution') : { sha: '' };
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
    resetToSeed() { return exclusive(root, () => restoreSeed(root, userId)); },
  };
  return repo;
}

export const memoryRepo: MemoryRepoApi = { openMemoryRepo };
