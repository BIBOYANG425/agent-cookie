import { t, localizeUiText, subscribeLocale, type MessageKey } from './i18n';
import type { ConsoleAdapter, ConsoleSnapshot, GrantView } from './model';
import { parseCandidate, PolicyViolationError, type ShadowReport } from './policy';
/** The last policy-panel action's outcome. Kept apart from notice/error so the next poll does not clear it. */
export type PolicyResult = { kind: 'invalid'; message: string }
  | { kind: 'shadow'; report: ShadowReport }
  | { kind: 'violations'; action: 'shadow' | 'install'; violations: string[] }
  | { kind: 'installed'; policyId: string };
interface State { data: ConsoleSnapshot | null; loading: boolean; notice: string; error: string; pending: string; policyResult?: PolicyResult }
const STATUS_KEYS = ['notice', 'error', 'pending'] as const;
type StatusKey = typeof STATUS_KEYS[number];
type StateUpdate = Omit<Partial<State>, StatusKey> & Partial<Record<StatusKey, string | (() => string)>>;
const message = (error: unknown) => error instanceof Error ? localizeUiText(error.message) : t("requestFailed");
export function remainingSeconds(grant: GrantView, receivedAt: number, now: number): number {
  return grant.status !== 'live' ? 0 : Math.max(0, Math.ceil((grant.remainingMs - Math.max(0, now - receivedAt)) / 1000));
}
export class ConsoleController {
  private state: State = { data: null, loading: true, notice: '', error: '', pending: '' };
  private listeners = new Set<() => void>();
  private interval?: ReturnType<typeof setInterval>;
  private unsubscribeLocale?: () => void;
  private statusText: Partial<Record<StatusKey, () => string>> = {};
  private request?: AbortController;
  private generation = 0;
  constructor(readonly adapter: ConsoleAdapter) {}
  getState = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(next: StateUpdate) {
    const { notice, error, pending, ...rest } = next;
    const statuses = { notice, error, pending };
    const rendered: Partial<State> = rest;
    for (const key of STATUS_KEYS) {
      const value = statuses[key];
      if (value === undefined) continue;
      if (typeof value === 'function') { this.statusText[key] = value; rendered[key] = value(); }
      else { delete this.statusText[key]; rendered[key] = value; }
    }
    this.state = { ...this.state, ...rendered };
    this.listeners.forEach((listener) => listener());
  }
  private sorted(data: ConsoleSnapshot): ConsoleSnapshot {
    // Preserve the adapter's newest-first order when timestamps tie; IDs are opaque.
    const funnel = data.funnel?.availability === 'ready' ? { ...data.funnel, data: { ...data.funnel.data,
      rows: [...data.funnel.data.rows].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)) } } : data.funnel;
    // Receipts and intents stay as read; their panels order them newest first.
    return { ...data, events: [...data.events].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)),
      ...(funnel ? { funnel } : {}) };
  }
  start() {
    if (this.interval !== undefined) return;
    this.unsubscribeLocale = subscribeLocale(() => this.update(this.statusText));
    this.update(this.statusText);
    void this.refresh();
    this.interval = setInterval(() => { void this.refresh(); }, 2000);
  }
  stop() {
    this.unsubscribeLocale?.();
    this.unsubscribeLocale = undefined;
    clearInterval(this.interval);
    this.interval = undefined;
    this.generation++;
    this.request?.abort();
    this.request = undefined;
  }
  async refresh() {
    if (this.request || this.state.pending) return;
    const request = new AbortController();
    this.request = request;
    const generation = ++this.generation;
    try {
      const data = await this.adapter.load(request.signal);
      if (generation === this.generation) this.update({ data: this.sorted(data), error: '', loading: false });
    } catch (error) {
      if (generation === this.generation) this.update({ error: () => t("refreshFailed", message(error)), loading: false });
    } finally { if (generation === this.generation) this.request = undefined; }
  }
  /** `reload: false` for read-only operations (shadow evaluation) whose answer is shown, not a new snapshot. */
  private async perform(label: MessageKey, operation: (signal: AbortSignal) => Promise<void>, reload = true) {
    if (this.state.pending) return;
    this.request?.abort();
    const request = new AbortController();
    this.request = request;
    const generation = ++this.generation;
    this.update({ pending: () => t(label), notice: '', error: '' });
    let acknowledged = false;
    try {
      await operation(request.signal);
      acknowledged = true;
      const notice = () => t("completed", this.adapter.mode === 'sample' ? t("sampleThisPageOnly") : t("workspaceConfirmed"), t(label));
      if (!reload) { if (generation === this.generation) this.update({ notice }); return; }
      const data = await this.adapter.load(request.signal);
      if (generation === this.generation) this.update({ data: this.sorted(data), loading: false, notice });
    } catch (error) {
      if (generation === this.generation) this.update({ error: () => acknowledged
        ? t("confirmedButRefreshFailedTheDisplay", t(label), message(error))
        : t("wasNotConfirmedSuccessfulDisplayUnchanged", t(label), message(error)) });
    } finally {
      if (generation === this.generation) { this.request = undefined; this.update({ pending: '' }); }
    }
  }
  revokeContribution(id: string) { return this.perform("revokeSourceRecord", (signal) => this.adapter.revokeContribution(id, signal)); }
  revokeGrant(id: string) { return this.perform("revokeGrant", (signal) => this.adapter.revokeGrant(id, signal)); }
  setLearning(paused: boolean) { return this.perform(paused ? "pauseLearning" : "resumeLearning", (signal) => this.adapter.setLearning(paused, signal)); }
  selectLearningStage(id: string) { return this.perform("switchSampleLearningStage", async () => {
    if (!this.adapter.selectLearningStage) throw new Error(t("thisConnectionDoesNotSupportSample"));
    await this.adapter.selectLearningStage(id);
  }); }
  /** Candidate text → POST shadow. Invalid JSON never leaves the page. */
  async shadowPolicy(text: string) {
    if (this.state.pending) return;
    const candidate = parseCandidate(text);
    if (!candidate.ok) { this.update({ policyResult: { kind: 'invalid', message: candidate.message } }); return; }
    this.update({ policyResult: undefined });
    await this.perform("shadowEvaluation", async (signal) => {
      try { this.update({ policyResult: { kind: 'shadow', report: await this.adapter.shadowPolicy(candidate.value, signal) } }); }
      catch (error) { this.policyRejected('shadow', error); throw error; }
    }, false);
  }
  /** Candidate text → PUT. On 422 every violation is listed and the installed document stays as it was. */
  async installPolicy(text: string) {
    if (this.state.pending) return;
    const candidate = parseCandidate(text);
    if (!candidate.ok) { this.update({ policyResult: { kind: 'invalid', message: candidate.message } }); return; }
    this.update({ policyResult: undefined });
    await this.perform("installPolicy", async (signal) => {
      try { this.update({ policyResult: { kind: 'installed', policyId: (await this.adapter.installPolicy(candidate.value, signal)).policyId } }); }
      catch (error) { this.policyRejected('install', error); throw error; }
    });
  }
  private policyRejected(action: 'shadow' | 'install', error: unknown) {
    if (error instanceof PolicyViolationError) this.update({ policyResult: { kind: 'violations', action, violations: error.violations } });
  }
  reset() { return this.perform(this.adapter.mode === 'sample' ? "resetSample" : "resetDemo", (signal) => this.adapter.reset(signal)); }
}
