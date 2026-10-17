import { isField, WorkspaceError } from '@agent-cookie/contract';
import type { LearningContribution, LearningField } from '@agent-cookie/rules';
import { escape, filename, ownerFromFilename, text, timestamp, unescape } from './codec.js';
import type { AppendIntentInput, IntentSummary } from './learning-types.js';

interface StoredIntent extends AppendIntentInput { recordedAt: string }

// TODO(contract): mirror the agreed local learning guards until the contract owns them.
// Keep rules as a type-only dependency here; runtime rendering/merging is injected.
function isLearningField(value: unknown): value is LearningField {
  return isField(value) || (typeof value === 'string' && value.length <= 128
    && /^pref\.[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*$/u.test(value));
}

function isLearningContributionMetadata(value: LearningContribution): boolean {
  for (const source of [value.intentId, value.conversationId]) {
    if (source !== undefined && (typeof source !== 'string' || !source.trim())) return false;
  }
  return value.evidence === undefined || (typeof value.evidence === 'string' && [...value.evidence].length <= 200);
}

function invalid(message = 'Invalid intent record'): never {
  throw new WorkspaceError('MISSING_FIELD', message);
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}

function string(value: unknown, nonempty = true): string {
  text(value, nonempty);
  return value;
}

function identifier(value: unknown): string {
  const result = string(value);
  // TODO(contract): IDs in intent summaries must be short opaque identifiers, not prose.
  if ([...result].length > 128 || /[\s\x00-\x1f\x7f]/u.test(result)) invalid('Invalid intent record identifier');
  return result;
}

function isoTimestamp(value: unknown): string {
  timestamp(value);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(value)) invalid('Expected an ISO timestamp');
  return value;
}

export function validateLearningContribution(c: LearningContribution, userId: string): void {
  text(c.id); filename(c.agentId); text(c.value, false); timestamp(c.createdAt);
  if (c.revokedAt !== undefined) timestamp(c.revokedAt);
  if (!isLearningField(c.field) || !isLearningContributionMetadata(c)
    || !['observed', 'stated', 'inferred'].includes(c.basis)) invalid('Invalid learning contribution');
  if (c.intentId !== undefined) text(c.intentId);
  if (c.conversationId !== undefined) text(c.conversationId);
  if (c.evidence !== undefined) text(c.evidence, false);
  if (c.userId !== userId) throw new WorkspaceError('SCOPE_DENIED');
}

export function projectIntent(input: unknown, userId: string, at: string): StoredIntent {
  const raw = object(input);
  const intent = object(raw.intent);
  if (intent.userId !== userId) throw new WorkspaceError('SCOPE_DENIED');
  const id = identifier(intent.id);
  const kind = intent.kind === undefined ? undefined : identifier(intent.kind);
  if (kind !== undefined && ([...kind].length > 64 || !/^[\p{L}\p{N}][\p{L}\p{N}._:-]*$/u.test(kind))) invalid('Invalid intent kind');
  if (!Array.isArray(raw.extracted)) invalid('Extracted contributions are required');
  const extracted = raw.extracted.map((value): LearningContribution => {
    const source = object(value);
    if (source.userId !== userId) throw new WorkspaceError('SCOPE_DENIED');
    const field = source.field;
    const basis = source.basis;
    if (!isLearningField(field) || (basis !== 'stated' && basis !== 'observed' && basis !== 'inferred')) invalid();
    // Explicit projection only: never spread the input contribution or any raw conversation properties.
    const c: LearningContribution = {
      id: identifier(source.id), userId, agentId: identifier(source.agentId),
      field, value: string(source.value, false), basis, createdAt: isoTimestamp(source.createdAt),
    };
    if (source.revokedAt !== undefined) c.revokedAt = isoTimestamp(source.revokedAt);
    if (source.intentId !== undefined) {
      c.intentId = identifier(source.intentId);
      if (c.intentId !== id) invalid('Contribution belongs to another intent');
    }
    if (source.conversationId !== undefined) c.conversationId = identifier(source.conversationId);
    if (source.evidence !== undefined) c.evidence = string(source.evidence, false);
    // TODO(contract): this cap applies to history summaries, not ordinary contribution values.
    if ([...c.value].length > 200 || (c.evidence !== undefined && [...c.evidence].length > 200)) {
      invalid('Intent summary value or evidence exceeds 200 characters');
    }
    validateLearningContribution(c, userId);
    return c;
  });
  const result: StoredIntent = {
    intent: { id, userId, expiresAt: isoTimestamp(intent.expiresAt) },
    extracted, recordedAt: isoTimestamp(at),
  };
  if (kind !== undefined) result.intent.kind = kind;
  if (raw.chosenQuote !== undefined) {
    const quote = object(raw.chosenQuote);
    if (typeof quote.price !== 'number' || !Number.isSafeInteger(quote.price) || quote.price < 0 || quote.currency !== 'USD') invalid('Invalid chosen quote');
    result.chosenQuote = { id: identifier(quote.id), agentId: identifier(quote.agentId), price: quote.price, currency: 'USD' };
  }
  return result;
}

export function intentFilename(id: string, at: string): string {
  const date = new Date(isoTimestamp(at)).toISOString().slice(0, 10);
  return filename(`${date}-${identifier(id)}`);
}

export function parseIntentFilename(name: string): { date: string; id: string } {
  const decoded = ownerFromFilename(name);
  const match = /^(\d{4}-\d{2}-\d{2})-(.+)$/su.exec(decoded);
  if (!match || intentFilename(match[2]!, `${match[1]}T00:00:00.000Z`) !== name) invalid('Invalid intent filename');
  return { date: match[1]!, id: match[2]! };
}

export function renderIntent(record: StoredIntent): string {
  const attributes: [string, string][] = [
    ['userId', record.intent.userId],
    ['recordedAt', record.recordedAt], ['expiresAt', record.intent.expiresAt],
    ['extractedCount', String(record.extracted.length)],
  ];
  if (record.intent.kind !== undefined) attributes.push(['kind', record.intent.kind]);
  record.extracted.forEach((c, index) => {
    const prefix = `extracted.${index}.`;
    for (const key of ['id', 'userId', 'agentId', 'field', 'value', 'basis', 'createdAt', 'revokedAt', 'intentId', 'conversationId', 'evidence'] as const) {
      if (c[key] !== undefined) attributes.push([`${prefix}${key}`, c[key]!]);
    }
  });
  if (record.chosenQuote) {
    for (const key of ['id', 'agentId', 'price', 'currency'] as const) {
      attributes.push([`chosenQuote.${key}`, String(record.chosenQuote[key])]);
    }
  }
  return `- intent: ${escape(record.intent.id)} [${attributes.map(([key, value]) => `${key}: ${escape(value)}`).join('; ')}]`;
}

export function parseIntent(line: string, userId: string, name: string): StoredIntent | undefined {
  try {
    const match = /^- intent: (.*) \[([^\[\]\r\n]*)\]$/su.exec(line);
    if (!match) return undefined;
    const attributes = new Map<string, string>();
    for (const part of match[2]!.split('; ')) {
      const attribute = /^([A-Za-z][A-Za-z0-9.]*): (.*)$/su.exec(part);
      if (!attribute || attributes.has(attribute[1]!)) return undefined;
      attributes.set(attribute[1]!, unescape(attribute[2]!));
    }
    const count = Number(attributes.get('extractedCount'));
    if (!Number.isSafeInteger(count) || count < 0 || count > attributes.size) return undefined;
    const extracted = Array.from({ length: count }, (_, index) => {
      const c: Record<string, unknown> = {};
      for (const key of ['id', 'userId', 'agentId', 'field', 'value', 'basis', 'createdAt', 'revokedAt', 'intentId', 'conversationId', 'evidence']) {
        const value = attributes.get(`extracted.${index}.${key}`);
        if (value !== undefined) c[key] = value;
      }
      return c;
    });
    const input: Record<string, unknown> = {
      intent: { id: unescape(match[1]!), userId: attributes.get('userId'), kind: attributes.get('kind'), expiresAt: attributes.get('expiresAt') },
      extracted,
    };
    if (attributes.has('chosenQuote.id')) input.chosenQuote = {
      id: attributes.get('chosenQuote.id'), agentId: attributes.get('chosenQuote.agentId'),
      price: Number(attributes.get('chosenQuote.price')), currency: attributes.get('chosenQuote.currency'),
    };
    const record = projectIntent(input, userId, string(attributes.get('recordedAt')));
    if (intentFilename(record.intent.id, record.recordedAt) !== name) return undefined;
    return record;
  } catch { return undefined; }
}

export function summarizeIntent(record: StoredIntent): IntentSummary {
  const parts = record.intent.kind === undefined ? [] : [record.intent.kind];
  for (const c of record.extracted) {
    parts.push(`${c.field}=${c.value}${c.evidence === undefined ? '' : ` (${c.evidence})`}`);
  }
  if (record.chosenQuote) parts.push(`${record.chosenQuote.agentId}: ${record.chosenQuote.price} ${record.chosenQuote.currency}`);
  const summary = parts.join('; ').replace(/[\s\x00-\x1f\x7f]+/gu, ' ').trim();
  return { intentId: record.intent.id, date: new Date(record.recordedAt).toISOString().slice(0, 10), summary };
}
