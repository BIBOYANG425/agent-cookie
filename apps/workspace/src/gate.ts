// Reset barrier. POST /demo/reset closes the gate (new requests wait), gives in-flight requests up to maxWaitMs
// to finish, then bumps the generation BEFORE wiping. Every request runs inside an AsyncLocalStorage context
// carrying the generation it started in; a request still running after the bump is stale, and the store and
// memory-repo writes refuse it (deps.ts installs the guard). So nothing from before a reset can be written
// after it, however long that request takes. Long polls see `closing()` and return early.
import { AsyncLocalStorage } from "node:async_hooks";

export class Gate {
  private active = 0;
  private idle: Array<() => void> = [];
  private closed: Promise<void> | null = null;
  private generation = 0;
  private readonly als = new AsyncLocalStorage<{ generation: number }>();

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

  /** True inside a request that started before the last reset. Outside any request (startup, reset itself): false. */
  stale(): boolean {
    const ctx = this.als.getStore();
    return ctx !== undefined && ctx.generation !== this.generation;
  }

  /** A reset is waiting or running. */
  closing(): boolean {
    return this.closed !== null;
  }

  async exclusive<T>(fn: () => Promise<T>, maxWaitMs = 10_000): Promise<T> {
    while (this.closed) await this.closed;
    let open!: () => void;
    this.closed = new Promise<void>((r) => { open = r; });
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
