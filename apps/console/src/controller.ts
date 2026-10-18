import type { ConsoleAdapter, ConsoleSnapshot, GrantView } from './model';
import { parseCandidate, PolicyViolationError, type ShadowReport } from './policy';
/** The last policy-panel action's outcome. Kept apart from notice/error so the next poll does not clear it. */
export type PolicyResult = { kind: 'invalid'; message: string }
  | { kind: 'shadow'; report: ShadowReport }
  | { kind: 'violations'; action: '影子评估' | '安装'; violations: string[] }
  | { kind: 'installed'; policyId: string };
interface State { data: ConsoleSnapshot | null; loading: boolean; notice: string; error: string; pending: string; policyResult?: PolicyResult }
const message = (error: unknown) => error instanceof Error ? error.message : '请求失败';
export function remainingSeconds(grant: GrantView, receivedAt: number, now: number): number {
  return grant.status !== 'live' ? 0 : Math.max(0, Math.ceil((grant.remainingMs - Math.max(0, now - receivedAt)) / 1000));
}
export class ConsoleController {
  private state: State = { data: null, loading: true, notice: '', error: '', pending: '' };
  private listeners = new Set<() => void>();
  private interval?: ReturnType<typeof setInterval>;
  private request?: AbortController;
  private generation = 0;
  constructor(readonly adapter: ConsoleAdapter) {}
  getState = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(next: Partial<State>) {
    this.state = { ...this.state, ...next };
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
    void this.refresh();
    this.interval = setInterval(() => { void this.refresh(); }, 2000);
  }
  stop() {
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
      if (generation === this.generation) this.update({ error: `刷新失败：${message(error)}`, loading: false });
    } finally { if (generation === this.generation) this.request = undefined; }
  }
  /** `reload: false` for read-only operations (shadow evaluation) whose answer is shown, not a new snapshot. */
  private async perform(label: string, operation: (signal: AbortSignal) => Promise<void>, reload = true) {
    if (this.state.pending) return;
    this.request?.abort();
    const request = new AbortController();
    this.request = request;
    const generation = ++this.generation;
    this.update({ pending: label, notice: '', error: '' });
    let acknowledged = false;
    try {
      await operation(request.signal);
      acknowledged = true;
      const notice = `${this.adapter.mode === 'sample' ? 'Sample · 仅本页：' : '工作台已确认：'}${label}完成。`;
      if (!reload) { if (generation === this.generation) this.update({ notice }); return; }
      const data = await this.adapter.load(request.signal);
      if (generation === this.generation) this.update({ data: this.sorted(data), loading: false, notice });
    } catch (error) {
      if (generation === this.generation) this.update({ error: acknowledged
        ? `${label}已确认，但刷新失败。当前显示可能过期，请刷新核对。${message(error)}`
        : `${label}未确认成功，未更新显示。${message(error)}` });
    } finally {
      if (generation === this.generation) { this.request = undefined; this.update({ pending: '' }); }
    }
  }
  revokeContribution(id: string) { return this.perform('撤销来源记录', (signal) => this.adapter.revokeContribution(id, signal)); }
  revokeGrant(id: string) { return this.perform('撤销授权', (signal) => this.adapter.revokeGrant(id, signal)); }
  setLearning(paused: boolean) { return this.perform(paused ? '暂停学习' : '恢复学习', (signal) => this.adapter.setLearning(paused, signal)); }
  selectLearningStage(id: string) { return this.perform('切换 Sample 学习阶段', async () => {
    if (!this.adapter.selectLearningStage) throw new Error('当前连接不支持 Sample 阶段。');
    await this.adapter.selectLearningStage(id);
  }); }
  /** Candidate text → POST shadow. Invalid JSON never leaves the page. */
  async shadowPolicy(text: string) {
    if (this.state.pending) return;
    const candidate = parseCandidate(text);
    if (!candidate.ok) { this.update({ policyResult: { kind: 'invalid', message: candidate.message } }); return; }
    this.update({ policyResult: undefined });
    await this.perform('影子评估', async (signal) => {
      try { this.update({ policyResult: { kind: 'shadow', report: await this.adapter.shadowPolicy(candidate.value, signal) } }); }
      catch (error) { this.policyRejected('影子评估', error); throw error; }
    }, false);
  }
  /** Candidate text → PUT. On 422 every violation is listed and the installed document stays as it was. */
  async installPolicy(text: string) {
    if (this.state.pending) return;
    const candidate = parseCandidate(text);
    if (!candidate.ok) { this.update({ policyResult: { kind: 'invalid', message: candidate.message } }); return; }
    this.update({ policyResult: undefined });
    await this.perform('安装策略', async (signal) => {
      try { this.update({ policyResult: { kind: 'installed', policyId: (await this.adapter.installPolicy(candidate.value, signal)).policyId } }); }
      catch (error) { this.policyRejected('安装', error); throw error; }
    });
  }
  private policyRejected(action: '影子评估' | '安装', error: unknown) {
    if (error instanceof PolicyViolationError) this.update({ policyResult: { kind: 'violations', action, violations: error.violations } });
  }
  reset() { return this.perform(this.adapter.mode === 'sample' ? '重置 Sample' : '重置演示', (signal) => this.adapter.reset(signal)); }
}
