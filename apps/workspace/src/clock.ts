// The workspace's only clock. Every expiry comparison goes through it; POST /test/clock shifts it (A06).
// Tests may inject one that does not read the system time at all (`Clock.at(iso)`): it stands still unless moved.
export class Clock {
  private offsetMs = 0;
  private readonly listeners = new Set<() => void>();
  constructor(private readonly base: () => number = Date.now) {}

  /** Called after every shift (setOffset, advance): an open events stream re-checks expiry at once. Returns the unsubscribe. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  private changed(): void {
    for (const l of [...this.listeners]) l();
  }

  /** A clock frozen at `iso`; move it with setOffset (POST /test/clock) or advance(). */
  static at(iso: string): Clock {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) throw new TypeError(`invalid clock start ${iso}`);
    return new Clock(() => t);
  }

  now(): number {
    return this.base() + this.offsetMs;
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
    this.changed();
  }
  /** Cumulative (tests). */
  advance(ms: number): void {
    this.offsetMs += ms;
    this.changed();
  }
  offset(): number {
    return this.offsetMs;
  }
}
