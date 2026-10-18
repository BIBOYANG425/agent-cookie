// A small text/event-stream reader for tests (unit harness and the black-box acceptance suite alike): frames by the
// SSE rules (blank line ends a frame; `data` lines join with "\n"; `id`, `event`; lines starting with ":" are
// comments), plus the full raw text for leak scans. Nothing here imports apps/workspace/src.

export interface SseFrame { event?: string; id?: string; data: string }

export interface SseReader {
  /** Frames parsed so far, in order. */
  frames: SseFrame[];
  /** Comment lines seen so far (heartbeats). */
  comments: string[];
  /** Everything received so far. */
  text(): string;
  /** True once the server ended the stream. */
  ended(): boolean;
  /** The next unread frame, or undefined when the stream ends first. Rejects after `ms`. */
  next(ms?: number): Promise<SseFrame | undefined>;
  /** Read until the server ends the stream; rejects after `ms`. Returns every frame not yet taken by next(). */
  rest(ms?: number): Promise<SseFrame[]>;
  /** Client disconnect. */
  cancel(): Promise<void>;
}

export function sseReader(body: ReadableStream<Uint8Array>): SseReader {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const frames: SseFrame[] = [];
  const comments: string[] = [];
  let raw = "";
  let buf = "";
  let done = false;
  let taken = 0;
  let reading: Promise<void> | undefined;

  const parse = () => {
    buf = buf.replace(/\r\n?/g, "\n");
    for (let end = buf.indexOf("\n\n"); end >= 0; end = buf.indexOf("\n\n")) {
      const block = buf.slice(0, end);
      buf = buf.slice(end + 2);
      const frame: SseFrame = { data: "" };
      const data: string[] = [];
      let fields = 0;
      for (const line of block.split("\n")) {
        if (line.startsWith(":")) { comments.push(line.slice(1).trim()); continue; }
        const i = line.indexOf(":");
        const name = i < 0 ? line : line.slice(0, i);
        const value = i < 0 ? "" : line.slice(i + 1).replace(/^ /, "");
        if (name === "data") { data.push(value); fields++; }
        else if (name === "event") { frame.event = value; fields++; }
        else if (name === "id") { frame.id = value; fields++; }
      }
      if (fields === 0) continue;
      frame.data = data.join("\n");
      frames.push(frame);
    }
  };
  /** One read; concurrent callers share it. */
  const pump = (): Promise<void> => {
    reading ??= reader.read().then(({ done: d, value }) => {
      reading = undefined;
      if (d) { done = true; return; }
      const chunk = decoder.decode(value, { stream: true });
      raw += chunk;
      buf += chunk;
      parse();
    }, () => { reading = undefined; done = true; });
    return reading;
  };
  const within = <T>(p: Promise<T>, ms: number, what: string): Promise<T> => {
    let t: NodeJS.Timeout | undefined;
    return Promise.race([p, new Promise<never>((_, reject) => { t = setTimeout(() => reject(new Error(`${what} not within ${ms} ms`)), ms); })])
      .finally(() => clearTimeout(t));
  };

  return {
    frames,
    comments,
    text: () => raw,
    ended: () => done,
    next(ms = 3000) {
      return within((async () => {
        while (taken >= frames.length && !done) await pump();
        return taken < frames.length ? frames[taken++] : undefined;
      })(), ms, "next SSE frame");
    },
    rest(ms = 3000) {
      return within((async () => {
        while (!done) await pump();
        const out = frames.slice(taken);
        taken = frames.length;
        return out;
      })(), ms, "end of SSE stream");
    },
    async cancel() {
      done = true;
      await reader.cancel().catch(() => undefined);
    },
  };
}
