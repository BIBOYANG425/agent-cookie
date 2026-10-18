// Reset barrier. POST /demo/reset closes the gate (new requests wait), gives in-flight requests up to maxWaitMs
// to finish, then bumps the generation BEFORE wiping. Every request runs inside an AsyncLocalStorage context
// carrying the generation it started in; a request still running after the bump is stale, and the store and
// memory-repo writes refuse it (deps.ts installs the guard). So nothing from before a reset can be written
// after it, however long that request takes. Long polls see `closing()` and return early; open event streams are
// not counted as in flight (their handler has returned) and end through `onClosing`.
import { AsyncLocalStorage } from "node:async_hooks";

export class Gate {
  private active = 0;
  private idle: Array<() => void> = [];
  private closed: Promise<void> | null = null;
  private generation = 0;
  private readonly als = new AsyncLocalStorage<{ generation: number }>();
  private readonly closingListeners = new Set<() => void>();

  /** Run one request inside the current generation. */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    while (this.closed) await this.closed;
    this.active++;
    try {
      return await this.als.run({ generation: this.generation }, fn);
    } finally {
      this.active--;
      if (this.active === 0) for (const w of this.idle.splice(0)) w();
    }
  }

  /**
   * Background work a request starts and does not await (learning after an intent, a conversation batch): counted
   * like the request itself, so a reset waits for it (up to maxWaitMs), and it runs in the request's generation, so
   * once the reset has moved on its writes are refused like the request's own.
   */
  async hold<T>(fn: () => Promise<T>): Promise<T> {
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      if (this.active === 0) for (const w of this.idle.splice(0)) w();
    }
  }

  /** True inside a request that started before the last reset. Outside any request (startup, reset itself): false. */
  stale(): boolean {
    const ctx = this.als.getStore();
    return ctx !== undefined && ctx.generation !== this.generation;
  }

  /** A reset is waiting or running. */
  closing(): boolean {
    return this.closed !== null;
  }

  /**
   * Called synchronously the moment a reset starts closing the gate, before it waits for requests in flight: work that
   * outlives its request (an SSE stream) ends here instead of being cut off. Returns the unsubscribe function.
   */
  onClosing(listener: () => void): () => void {
    this.closingListeners.add(listener);
    return () => { this.closingListeners.delete(listener); };
  }

  async exclusive<T>(fn: () => Promise<T>, maxWaitMs = 10_000): Promise<T> {
    while (this.closed) await this.closed;
    let open!: () => void;
    this.closed = new Promise<void>((r) => { open = r; });
    for (const l of [...this.closingListeners]) {
      try { l(); } catch (err) { console.error("[workspace] closing listener failed:", err); }
    }
    try {
      if (this.active > 0) {
        let timer: NodeJS.Timeout | undefined;
        await Promise.race([
          new Promise<void>((r) => this.idle.push(r)),
          new Promise<void>((r) => { timer = setTimeout(r, maxWaitMs); }),
        ]);
        if (timer) clearTimeout(timer);
      }
      // From here on, anything still running belongs to the old generation and can no longer write.
      this.generation++;
      return await fn();
    } finally {
      this.closed = null;
      open();
    }
  }
}
