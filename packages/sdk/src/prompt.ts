// assistantPrompt: an AssistantContext as a compact block for a company assistant's own system prompt. Pure: no
// network, no clock, the same context always gives the same text (golden-tested).
import type { AssistantContext } from '@agent-cookie/contract';
import { FIELDS } from '@agent-cookie/contract';

/** Never asked for and never listed: the workspace hands these to the store at the stage that needs them. */
const HANDED_TO_STORE: readonly string[] = ['shipping_address', 'payment_method'];
const MAX_VALUE_CHARS = 200;

/** The contract's field order, then any field this SDK does not know yet, alphabetically. */
function ordered(names: Iterable<string>): string[] {
  const rank = (f: string) => { const i = (FIELDS as readonly string[]).indexOf(f); return i < 0 ? FIELDS.length : i; };
  return [...new Set(names)].sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0));
}

/** One line per value: control characters and line breaks become spaces, so a value cannot start a section of its own. */
function oneLine(value: string): string {
  const flat = value.replace(/[\x00-\x1f\x7f-\x9f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();
  const chars = Array.from(flat);
  return chars.length > MAX_VALUE_CHARS ? `${chars.slice(0, MAX_VALUE_CHARS - 1).join('')}…` : flat;
}

/**
 * Renders what a linked assistant may know: known fields with their values (use them, never ask again), unknown
 * fields by name (ask only when the task needs one), and one line saying the address and payment go from the
 * workspace to the store at checkout and payment, so the assistant never asks for them. A context marked
 * `sample: true` (demo workspace) says so first.
 */
export function assistantPrompt(ctx: AssistantContext & { sample?: boolean }): string {
  const values = new Map<string, string>();
  for (const [field, value] of Object.entries(ctx.fields)) {
    if (typeof value === 'string' && !HANDED_TO_STORE.includes(field) && oneLine(value)) values.set(field, oneLine(value));
  }
  const known = ordered(values.keys());
  const unknown = ordered(ctx.unknown.filter(f => !HANDED_TO_STORE.includes(f) && !values.has(f)));
  const lines = ['Agent Cookie: what this person has shared with you, under their own policy.'];
  if (ctx.sample === true) lines.push('Sample data from a demo workspace, not a real person.');
  if (known.length) {
    lines.push('Known (use these; do not ask for them again):');
    for (const field of known) lines.push(`- ${field}: ${values.get(field)}`);
  } else {
    lines.push('Known: nothing yet.');
  }
  if (unknown.length) lines.push(`Unknown (ask only when the task needs it): ${unknown.join(', ')}.`);
  lines.push('Never ask for a shipping address or payment details: the workspace hands them to the store at checkout and payment.');
  return `${lines.join('\n')}\n`;
}
