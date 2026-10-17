// Reset barrier: POST /demo/reset waits (up to maxWaitMs) for in-flight requests to finish and holds new ones
// until it is done, so no request straddles the wipe and writes pre-reset state into the fresh database.
export class Gate {
  private active = 0;
  private idle: Array<() => void> = [];
  private closed: Promise<void> | null = null;

  async enter(): Promise<void> {
    while (this.closed) await this.closed;
    this.active++;
  }

  leave(): void {
    this.active--;
    if (this.active === 0) for (const w of this.idle.splice(0)) w();
  }

  async exclusive<T>(fn: () => Promise<T>, maxWaitMs = 10_000): Promise<T> {
    while (this.closed) await this.closed;
    let open!: () => void;
    this.closed = new Promise<void>((r) => { open = r; });
    try {
      if (this.active > 0) {
        await Promise.race([new Promise<void>((r) => this.idle.push(r)), new Promise<void>((r) => setTimeout(r, maxWaitMs))]);
      }
      return await fn();
    } finally {
      this.closed = null;
      open();
    }
  }
}
