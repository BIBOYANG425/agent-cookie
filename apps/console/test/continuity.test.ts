import { describe, expect, it } from 'vitest';
import type { IntentHistoryEntry, Receipt } from '../../../packages/contract/src/types';
import { sharedSessions } from '../src/ContinuityPanel';
const intents = [{ id: 'one', agentId: 'phone' }, { id: 'two', agentId: 'desktop' }, { id: 'three', agentId: 'phone' }] as IntentHistoryEntry[];
const receipt = (intentId: string, sessionId = 'same', agentId = 'store') => ({ intentId, sessionId, agentId }) as Receipt;
describe('assistant continuity evidence', () => {
  it('requires two different requesting assistants and the same merchant/session', () => {
    const matches = sharedSessions(intents, [receipt('one'), receipt('two')]);
    expect(matches).toHaveLength(1);
    expect([...matches[0].assistants]).toEqual(['phone', 'desktop']);
    expect([...matches[0].requests]).toEqual(['one', 'two']);
  });
  it('does not confuse repeats, unrelated sessions, other merchants, or unknown requests with continuity', () => {
    for (const rows of [[receipt('one'), receipt('three')], [receipt('one'), receipt('two', 'other')], [receipt('one'), receipt('two', 'same', 'another-store')], [receipt('one'), receipt('unknown')]]) {
      expect(sharedSessions(intents, rows)).toEqual([]);
    }
  });
});
