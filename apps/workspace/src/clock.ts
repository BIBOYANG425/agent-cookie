// The workspace's only clock. Every expiry comparison goes through it; POST /test/clock shifts it (A06).
export class Clock {
  private offsetMs = 0;
  now(): number {
    return Date.now() + this.offsetMs;
  }
  nowIso(): string {
    return new Date(this.now()).toISOString();
  }
  isoIn(ms: number): string {
    return new Date(this.now() + ms).toISOString();
  }
  /** Absolute, not cumulative. */
  setOffset(ms: number): void {
    this.offsetMs = ms;
  }
  offset(): number {
    return this.offsetMs;
  }
}
