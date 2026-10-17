// Opt-in HTTP-only integration recorder. Use an isolated workspace, never the user's normal data.
// This distinguishes manually stated contributions from automatic conversation learning.
// It does not claim C20 passed when the production learner is absent or returns no evidence.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const runId = randomUUID();
const report = { at: new Date().toISOString(), runId, mode: 'real-workspace-http',
  automaticLearningVerified: false, rankingEffectVerified: false, checks: {}, quotes: [] };
let base, owner, personal;
let stage = 'configuration';
class ProbeFailure extends Error {
  constructor(code) { super(code); this.code = code; }
}
const manualField = 'pref.color';
const manualValue = `Sample integration ${runId}`;

async function request(path, key, method = 'GET', body, expected = 200) {
  const response = await fetch(new URL(path, base), { method, redirect: 'error',
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(path === '/personal/intents' ? { 'Idempotency-Key': `c20-${runId}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(90_000) });
  const value = await response.json();
  if (response.status !== expected) throw new ProbeFailure('UNEXPECTED_HTTP_STATUS');
  return value;
}

async function matchingManualEntries() {
  const body = await request('/personal/learned', owner);
  if (!Array.isArray(body.learned)) throw new ProbeFailure('INVALID_LEARNED_RESPONSE');
  return body.learned.filter(row => row?.field === manualField && row?.value === manualValue);
}

/** A failed response is not proof that the server did not write. Recover only this run's unique value. */
async function cleanupManual(contributionId) {
  const ids = new Set();
  if (typeof contributionId === 'string' && contributionId) ids.add(contributionId);
  if (ids.size === 0) {
    try {
      for (const entry of await matchingManualEntries()) {
        if (!Array.isArray(entry.evidence) || entry.evidence.length === 0) throw new ProbeFailure('INVALID_LEARNED_RESPONSE');
        for (const evidence of entry.evidence) {
          if (typeof evidence?.contributionId !== 'string' || !evidence.contributionId) throw new ProbeFailure('INVALID_LEARNED_RESPONSE');
          ids.add(evidence.contributionId);
        }
      }
    } catch {
      return { status: 'unconfirmed', reason: 'LOOKUP_UNAVAILABLE' };
    }
    // A timed-out write might still be running; an immediate empty lookup cannot confirm its outcome.
    if (ids.size === 0) return { status: 'unconfirmed', reason: 'WRITE_OUTCOME_UNKNOWN' };
  }
  let revoked = 0;
  for (const id of ids) {
    try {
      await request(`/personal/contributions/${encodeURIComponent(id)}/revoke`, owner, 'POST', {});
      revoked++;
    } catch {
      return { status: 'unconfirmed', reason: 'REVOKE_FAILED', revoked };
    }
  }
  try {
    if ((await matchingManualEntries()).length > 0) return { status: 'unconfirmed', reason: 'RECORD_STILL_VISIBLE', revoked };
  } catch {
    return { status: 'unconfirmed', reason: 'VERIFICATION_UNAVAILABLE', revoked };
  }
  return { status: 'confirmed', revoked };
}

try {
  if (process.env.AGENT_COOKIE_ISOLATED_PROBE !== '1') throw new ProbeFailure('ISOLATED_OPT_IN_REQUIRED');
  try { base = new URL(process.env.AGENT_COOKIE_URL ?? ''); }
  catch { throw new ProbeFailure('INVALID_WORKSPACE_ORIGIN'); }
  if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)
    || base.username || base.password || base.search || base.hash || base.pathname !== '/') {
    throw new ProbeFailure('INVALID_WORKSPACE_ORIGIN');
  }
  owner = process.env.AGENT_COOKIE_KEY;
  personal = process.env.AGENT_COOKIE_PERSONAL_KEY;
  if (!owner || !personal) throw new ProbeFailure('CREDENTIALS_REQUIRED');
  stage = 'identity';
  assert.equal((await request('/me', owner)).role, 'owner');
  assert.equal((await request('/me', personal)).role, 'personal');
  stage = 'learning-state';
  const before = await request('/personal/learning', owner);
  assert.equal(typeof before.paused, 'boolean');
  const originalLearned = await request('/personal/learned', owner);
  assert(Array.isArray(originalLearned.learned));
  report.checks.read = { paused: before.paused, learnedCount: originalLearned.learned.length };
  try {
    assert.equal((await request('/personal/learning', owner, 'PUT', { paused: true })).paused, true);
    assert.equal((await request('/personal/learned', owner)).paused, true);
    report.checks.pause = 'confirmed by state and learned endpoints';
  } finally {
    await request('/personal/learning', owner, 'PUT', { paused: before.paused });
  }

  // A manual statement exercises C's real persistence, merge, grouped response and revoke contract.
  // It is deliberately not a model extraction and is removed before the dialogue probe.
  stage = 'manual-statement';
  let contribution, manualFailure;
  try {
    contribution = await request('/personal/contributions', personal, 'POST',
      { field: manualField, value: manualValue }, 201);
    assert.equal(contribution.field, manualField);
    assert.equal(contribution.value, manualValue);
    assert.equal(contribution.basis, 'stated');
    const learned = await request('/personal/learned', owner);
    const entries = learned.learned.filter(row => row.field === contribution.field && row.value === contribution.value);
    assert.equal(entries.length, 1, 'one field/value must not be duplicated by expanded FIELDS');
    assert.equal(entries[0].status, 'card');
    assert(entries[0].evidence.some(row => row.contributionId === contribution.id && row.basis === 'stated'));
    report.checks.manualStatement = { source: 'manual Sample statement, not automatic learning', entry: entries[0] };
  } catch (error) {
    manualFailure = error;
  } finally {
    report.checks.manualCleanup = await cleanupManual(contribution?.id);
  }
  if (manualFailure) throw manualFailure;
  if (report.checks.manualCleanup.status !== 'confirmed') throw new ProbeFailure('MANUAL_CLEANUP_UNCONFIRMED');
  report.checks.revoke = 'contribution absent from learned response';

  stage = 'dialogue';
  if (before.paused) {
    report.checks.dialogue = { attempted: false, reason: 'learning was already paused; preserved its state' };
  } else {
    const at = new Date().toISOString();
    const queued = await request('/personal/observations', personal, 'POST', {
      channel: 'c20-http-rehearsal', conversationId: `c20-${runId}`,
      turns: [{ role: 'user', text: '周末又去徒步，上次脚湿透了', at },
        { role: 'user', text: '帮我找双鞋', at }],
    }, 202);
    report.checks.dialogue = { attempted: true, transport: 'HTTP, not B personal-agent channel',
      turnCount: 2, queued, learnedImmediately: (await request('/personal/learned', owner)).learned.length };
  }

  // Optional explicit query is for a live catalog baseline; it does not prove learning affected ordering.
  if (process.env.AGENT_COOKIE_C20_QUERY) {
    stage = 'catalog-baseline';
    const created = await request('/personal/intents', personal, 'POST', {
      text: '帮我找双鞋', query: process.env.AGENT_COOKIE_C20_QUERY, public: { count: '2' },
    }, 201);
    const result = await request(`/personal/intents/${encodeURIComponent(created.intentId)}/quotes`, personal);
    assert(Array.isArray(result.quotes));
    assert(result.quotes.length <= 2);
    assert.equal(new Set(result.quotes.map(row => row.seller ?? row.agentId)).size, result.quotes.length);
    report.intentId = created.intentId;
    report.quotes = result.quotes.map(row => ({ id: row.id, seller: row.seller, title: row.title,
      price: row.price, currency: row.currency, source: row.source, sizeNote: row.sizeNote }));
    report.checks.quotes = { count: result.quotes.length, requestBudget: null,
      reason: 'No budget was stated in this request; no fixed price assertion',
      ranking: 'baseline only; no automatically learned preference has been verified' };
  }
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  // Fixed codes only: parser/assertion/fetch errors may embed configuration or upstream text.
  report.failure = { code: error instanceof ProbeFailure ? error.code : 'PROBE_CHECK_FAILED', stage };
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = 1;
}
