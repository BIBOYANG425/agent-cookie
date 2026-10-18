// A company assistant (Manus, Dots, Muse): it asks the owner for a consent link, then acts for the person through
// the pairwise session the owner approved. It reads values by policy (auto.assistant), never provenance, and never
// shipping_address or payment_method: the workspace hands those to the store at checkout and payment.
import type { AssistantContext, AssistantStats, Field, JarAccess, LinkView } from '@agent-cookie/contract';
import { LINK_TTL_MS } from '@agent-cookie/contract';
import {
  ActingClient, cancelled, count, fieldName, isObject, jarAccess, resourceId, validDate, validId, type ClientOptions, type RequestOptions,
} from './core.js';
import { contributionBody, contributionResult, type AssistantContributionInput, type ContributionResult } from './contributions.js';
import { linkView } from './links.js';

export type { AgentContribution, AssistantContributionInput, ContributionEvidenceInput, ContributionInput, ContributionResult } from './contributions.js';
export type AssistantContextResult = AssistantContext & { sample: boolean };
export type AssistantStatsResult = AssistantStats & { sample: boolean };
/** AssistantClient.forJar's options: a client's options without the URL and key, which come from the jar. */
export type JarClientOptions = Omit<ClientOptions, 'baseUrl' | 'key'>;

export interface WaitForLinkOptions {
  /** Time between polls of GET /assistant/link/:id: 100–60000 ms, default 2000. */
  intervalMs?: number;
  /** Give up after this long: 1 ms – 1 hour, default LINK_TTL_MS (the link's own life). */
  timeoutMs?: number;
  signal?: AbortSignal;
}

export type LinkNotApprovedReason = 'declined' | 'expired' | 'timeout';
const notApproved: Record<LinkNotApprovedReason, string> = {
  declined: 'The owner declined the link.',
  expired: 'The link expired before the owner decided.',
  timeout: 'The owner has not decided yet; waiting timed out.',
};

/** waitForLink's rejection when the owner did not approve: declined, expired, or not decided within `timeoutMs`. */
export class LinkNotApprovedError extends Error {
  constructor(readonly reason: LinkNotApprovedReason, readonly link: LinkView) {
    super(notApproved[reason]);
    this.name = 'LinkNotApprovedError';
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(cancelled()); return; }
    const onAbort = () => { clearTimeout(timer); reject(cancelled()); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

const fieldNames = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 64 && v.every(fieldName);

/**
 * A company assistant's client (assistant key from `registerAgent({ category: 'assistant' })`). Until the owner
 * approves a link, context() and the intent methods answer 403 SCOPE_DENIED; once the owner revokes the grant or it
 * lapses, GRANT_REVOKED / GRANT_EXPIRED. The intent, quote, accept and observe methods are WorkspaceClient's, scoped
 * by the workspace to intents this assistant created: anyone else's intent is the same 404 NOT_FOUND as none.
 *
 * With the hosted gateway there are two clients and two keys. The gateway-level client (`baseUrl` the gateway, the
 * global key from registering there) is used only for requestLink, link and waitForLink. The approved link's `jar`
 * gives the jar-bound client (`AssistantClient.forJar(link.jar)`: that person's instance and this assistant's key in
 * it), used for everything else. Neither key works in the other place.
 */
export class AssistantClient extends ActingClient {
  /**
   * The client for one person's jar under the hosted gateway, from the approved LinkView's `jar`: bound to `jar.url`
   * (their instance, e.g. `https://jar.example/u/usr_abc`) with `jar.key` (this assistant's key there). Use it for
   * context, find/accept, remember, stats and observe; keep the gateway-level client for requestLink, link and
   * waitForLink. `options` takes everything a client takes except the URL and key. A malformed jar is refused before
   * any request with "Invalid jar access.", which names neither the URL nor the key. Independent of WorkspaceClient.
   */
  static forJar(jar: JarAccess, options: JarClientOptions = {}): AssistantClient {
    const access = jarAccess(jar);
    if (!access) throw new Error('Invalid jar access.');
    return new AssistantClient({ ...options, baseUrl: access.url, key: access.key });
  }

  /** POST /assistant/link: ask the owner for a session. Show `url` to the person; a second call while one is pending returns it. */
  async requestLink(options?: RequestOptions): Promise<LinkView> {
    return linkView(await this.request('/assistant/link', { ...options, body: {} }));
  }

  /**
   * GET /assistant/link/:id: this assistant's own link (anyone else's is 404); `sessionId` once approved, and through
   * the hosted gateway `jar` (validated; until the link expires) for AssistantClient.forJar.
   */
  async link(linkId: string, options?: RequestOptions): Promise<LinkView> {
    const view = linkView(await this.request(`/assistant/link/${resourceId(linkId)}`, options));
    if (view.id !== linkId) throw new Error('Invalid link response.');
    return view;
  }

  /**
   * Polls link(id) until the owner approves (resolves the approved LinkView, with `jar` when a gateway issued one) or
   * rejects with LinkNotApprovedError (`declined`, `expired`, `timeout`). A failed poll rejects with that call's error
   * and is not retried; the link is unchanged, so calling waitForLink again resumes. Abort rejects with an AbortError.
   */
  async waitForLink(linkId: string, options: WaitForLinkOptions = {}): Promise<LinkView> {
    const intervalMs = options.intervalMs ?? 2_000;
    const timeoutMs = options.timeoutMs ?? LINK_TTL_MS;
    if (!Number.isSafeInteger(intervalMs) || intervalMs < 100 || intervalMs > 60_000) throw new Error('intervalMs must be between 100 and 60000.');
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 3_600_000) throw new Error('timeoutMs must be between 1 and 3600000.');
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const view = await this.link(linkId, { signal: options.signal });
      if (view.status === 'approved') return view;
      if (view.status === 'declined' || view.status === 'expired') throw new LinkNotApprovedError(view.status, view);
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new LinkNotApprovedError('timeout', view);
      await sleep(Math.min(intervalMs, remaining), options.signal);
    }
  }

  /**
   * GET /assistant/context: the values policy lets this assistant know (`fields`), the ones it may ask for when the
   * task needs them (`unknown`), and what it may write (`writable`). No provenance. A read that serves values writes
   * a receipt the owner sees (purpose "assist", field names only; one per hour for an unchanged field set). Before
   * approval 403 SCOPE_DENIED; once the owner revokes it or it lapses, GRANT_REVOKED / GRANT_EXPIRED. Render it for
   * a model with assistantPrompt().
   */
  async context(options?: RequestOptions): Promise<AssistantContextResult> {
    const payload = await this.request('/assistant/context', options);
    const fields = isObject(payload) ? payload.fields : undefined;
    if (!isObject(payload) || payload.v !== 1 || !validId(payload.sessionId) || !validId(payload.policyId) || !isObject(fields)
      || Object.keys(fields).length > 64 || !Object.entries(fields).every(([k, v]) => fieldName(k) && typeof v === 'string')
      || !fieldNames(payload.unknown) || !fieldNames(payload.writable) || !validDate(payload.expiresAt)) {
      throw new Error('Invalid assistant context response.');
    }
    // Contract keys only: whatever else a response carried (provenance, sources) does not reach the assistant.
    return { v: 1, sessionId: payload.sessionId, policyId: payload.policyId,
      fields: Object.fromEntries(Object.entries(fields)) as Partial<Record<Field, string>>,
      unknown: [...payload.unknown] as Field[], writable: [...payload.writable] as Field[], expiresAt: payload.expiresAt,
      sample: payload.sample === true };
  }

  /**
   * POST /assistant/contributions (contract AssistantContributionInput): a fact about the person, filtered by the
   * policy's write.assistant. How it counts depends on `basis` (default "observed"), and the workspace decides:
   *  - "stated": the person said it to this assistant. Requires `evidence`: the conversation id and the person's OWN
   *    words (at most EVIDENCE_SNIPPET_MAX = 200 characters). While this assistant holds a live grant it counts like
   *    the person's own statement for the card (one source is enough), attributed to this assistant, with the evidence
   *    visible to the owner; once the grant is revoked or lapses it falls back to a candidate. Without evidence the
   *    workspace refuses it: 422 MISSING_FIELD.
   *  - "observed" (the default when `basis` is omitted): stays a candidate until a second independent source agrees.
   *  - "inferred": stored only; never on the card.
   * `stored` says how the workspace kept it. Never the address or the payment method (403 SCOPE_DENIED).
   */
  async remember(input: AssistantContributionInput, options?: RequestOptions): Promise<ContributionResult> {
    return contributionResult(await this.request('/assistant/contributions', { ...options, body: contributionBody(input, { assistant: true }) }));
  }

  /** GET /assistant/stats: counts over the intents this assistant created, including the questions it never had to ask. */
  async stats(options?: RequestOptions): Promise<AssistantStatsResult> {
    const payload = await this.request('/assistant/stats', options);
    if (!isObject(payload) || !(['intents', 'quoted', 'accepted', 'completed', 'questionsSkipped'] as const).every(k => count(payload[k]))
      || !validDate(payload.generatedAt)) throw new Error('Invalid assistant stats response.');
    return { intents: payload.intents as number, quoted: payload.quoted as number, accepted: payload.accepted as number,
      completed: payload.completed as number, questionsSkipped: payload.questionsSkipped as number, generatedAt: payload.generatedAt,
      sample: payload.sample === true };
  }
}
