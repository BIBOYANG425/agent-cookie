import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  NOTE_MAX_BYTES, WorkspaceError,
  type Contribution, type MemoryRepo, type MemoryRepoApi,
} from '@agent-cookie/contract';
import {
  filename, metadata, ownerFromFilename, parseNotes, renderNotes, renderReceipt,
  text, timestamp, validateContribution, validateNote,
} from './codec.js';
import {
  assertRepository, canonicalRoot, commitFiles, exclusive, initialize,
  optionalFile, recordFiles,
} from './storage.js';

export const openMemoryRepo: MemoryRepoApi['openMemoryRepo'] = async (opts) => {
  text(opts.path); text(opts.seedDir); text(opts.userId);
  const root = await canonicalRoot(opts.path);
  const userId = opts.userId;
  const rules = opts.rules;
  await exclusive(root, () => initialize(root, opts.seedDir, userId));
  const perform = <T>(action: () => Promise<T>) => exclusive(root, async () => {
    await assertRepository(root, userId);
    return action();
  });
  const list = async (): Promise<Contribution[]> => {
    const contributions: Contribution[] = [];
    for (const name of await recordFiles(root, 'contributions')) {
      contributions.push(...rules.parseContributions(await readFile(join(root, 'contributions', name), 'utf8'), {
        userId, agentId: ownerFromFilename(name),
      }));
    }
    return contributions;
  };
  const noteFile = (sessionId: string) => `notes/${filename(sessionId)}`;
  const notes = async (path: string) => parseNotes((await optionalFile(join(root, path)))?.toString('utf8') ?? '', userId);
  const repo: MemoryRepo = {
    appendContribution(c, meta) {
      return perform(async () => {
        metadata(meta); validateContribution(c, userId);
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
    async regenerateCard() { throw new Error('C08 not implemented'); },
    appendReceipt(receipt, meta) {
      return perform(async () => {
        metadata(meta);
        const record = renderReceipt(receipt);
        const previous = await readFile(join(root, 'receipts.md'), 'utf8');
        const content = `${previous}${previous && !previous.endsWith('\n') ? '\n' : ''}${record}\n`;
        return commitFiles(root, new Map([['receipts.md', content]]), meta, 'Append receipt');
      });
    },
    async resetToSeed() { throw new Error('C08 not implemented'); },
  };
  return repo;
};

export const memoryRepo: MemoryRepoApi = { openMemoryRepo };
