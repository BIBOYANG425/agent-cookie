import { describe, expect, it } from 'vitest';
import { parseContributions, renderContribution, type LearningContribution } from '../src/index.js';

const owner = { userId: 'sample-user', agentId: 'sample-personal-photon' };
const at = '2026-10-17T23:45:00-07:00';
const row: LearningContribution = { ...owner, id: 'format-1', field: 'tone', value: '简短', basis: 'stated', createdAt: at };

describe('C21 open Markdown metadata', () => {
  it('adds the UTC date and a single consistent source without removing the original provenance', () => {
    expect(renderContribution(row)).toContain(`at: ${at}; added: 2026-10-18`);
    const nested: LearningContribution = { ...row, evidence: { conversationId: 'thread/one', intentId: 'request-2', snippet: 'prefers brief' } };
    const line = renderContribution(nested);
    expect(line).toContain('source: conversation/thread/one');
    expect(line).toContain('evidenceConversationId: thread/one');
    expect(line).toContain('evidenceIntentId: request-2');
    expect(line).not.toContain('source: intent/request-2');
    expect(renderContribution({ ...row, intentId: 'request-3' })).toContain('source: intent/request-3');
    expect(parseContributions(line, owner)).toEqual([nested]);
  });

  it('preserves open metadata and existing added/source without turning them into owner or evidence fields', () => {
    const line = '- tone: 简短 [id: external-1; basis: stated; at: 2026-10-17T12:00:00.000Z; added: 2026-10-01; source: https://example.invalid/note; custom_key: one; custom-key: two; archivedAt: 2026-10-16; from: inbox; vendor.note: keep%3B %5Bx%5D%250A; userId: untrusted; agentId: untrusted]';
    const parsed = parseContributions(line, owner);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toEqual({ ...row, id: 'external-1', createdAt: '2026-10-17T12:00:00.000Z' });
    expect(JSON.parse(JSON.stringify(parsed[0]))).toEqual({ ...row, id: 'external-1', createdAt: '2026-10-17T12:00:00.000Z' });
    expect(renderContribution(parsed[0]!)).toBe(line);
    const revoked = Object.create(Object.getPrototypeOf(parsed[0]), Object.getOwnPropertyDescriptors(parsed[0]!)) as LearningContribution;
    revoked.revokedAt = '2026-10-18T00:00:00.000Z';
    const rerendered = renderContribution(revoked);
    for (const metadata of ['added: 2026-10-01', 'source: https://example.invalid/note', 'custom_key: one', 'custom-key: two',
      'archivedAt: 2026-10-16', 'from: inbox', 'vendor.note: keep%3B %5Bx%5D%250A']) expect(rerendered).toContain(metadata);
    expect(parseContributions(rerendered, owner)[0]?.revokedAt).toBe(revoked.revokedAt);
  });

  it('reads legacy rows without added/source and rejects duplicate open metadata rather than losing it silently', () => {
    const line = '- tone: 简短 [id: legacy; basis: stated; at: 2026-10-17T12:00:00.000Z]';
    expect(parseContributions(line, owner)).toEqual([{ ...row, id: 'legacy', createdAt: '2026-10-17T12:00:00.000Z' }]);
    expect(parseContributions(line.replace(']', '; custom-key: first; custom-key: second]'), owner)).toEqual([]);
  });
});
