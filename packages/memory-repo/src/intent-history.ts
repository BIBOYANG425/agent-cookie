import { isField, WorkspaceError, type ContributionEvidence } from '@agent-cookie/contract';
import type { LearningContribution } from '@agent-cookie/rules';
import { escape, filename, ownerFromFilename, text, timestamp, unescape } from './codec.js';
import type { IntentSummary } from './learning-types.js';

interface StoredIntent {
  intent: { id: string; userId: string; kind?: string; expiresAt?: string };
  extracted: LearningContribution[];
  recordedAt: string;
  agentId?: string;
  createdAt?: string;
  chosenQuote?: { id: string; agentId?: string; price: number; currency: 'USD' };
}

// Rules remains a type-only dependency: runtime rendering/merging is injected.
function isLearningContributionMetadata(value: LearningContribution): boolean {
  for (const source of [value.intentId, value.conversationId]) {
    if (source !== undefined && (typeof source !== 'string' || !source.trim())) return false;
  }
  if (value.evidence === undefined) return true;
  if (typeof value.evidence === 'string') return [...value.evidence].length <= 200;
  if (typeof value.evidence !== 'object' || value.evidence === null || Array.isArray(value.evidence)) return false;
  if (Object.keys(value.evidence).some(key => !['intentId', 'conversationId', 'snippet'].includes(key))) return false;
  for (const key of ['intentId', 'conversationId'] as const) {
    const source = value.evidence[key];
    if (source !== undefined && (typeof source !== 'string' || !source.trim())) return false;
    if (source !== undefined && value[key] !== undefined && source !== value[key]) return false;
  }
  return value.evidence.snippet === undefined
    || (typeof value.evidence.snippet === 'string' && [...value.evidence.snippet].length <= 200);
}
function invalid(message = 'Invalid intent record'): never { throw new WorkspaceError('MISSING_FIELD', message); }
function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
function string(value: unknown, nonempty = true): string { text(value, nonempty); return value; }
function identifier(value: unknown): string {
  const result = string(value);
  if ([...result].length > 128 || /[\s\x00-\x1f\x7f]/u.test(result)) invalid('Invalid intent record identifier');
  return result;
}
function isoTimestamp(value: unknown): string {
  timestamp(value);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(value)) invalid('Expected an ISO timestamp');
  return value;
}
function projectEvidence(value: unknown): string | ContributionEvidence {
  if (typeof value === 'string') return value;
  const raw = object(value);
  if (Object.keys(raw).some(key => !['intentId', 'conversationId', 'snippet'].includes(key))) invalid('Invalid evidence properties');
  const evidence: ContributionEvidence = {};
  for (const key of ['intentId', 'conversationId'] as const) {
    if (raw[key] !== undefined) evidence[key] = identifier(raw[key]);
  }
  if (raw.snippet !== undefined) evidence.snippet = string(raw.snippet, false);
  return evidence;
}
export function validateLearningContribution(c: LearningContribution, userId: string): void {
  text(c.id); filename(c.agentId); text(c.value, false); timestamp(c.createdAt);
  if (c.revokedAt !== undefined) timestamp(c.revokedAt);
  if (!isField(c.field) || !isLearningContributionMetadata(c)
    || !['observed', 'stated', 'inferred'].includes(c.basis)) invalid('Invalid learning contribution');
  for (const source of [c.intentId, c.conversationId]) if (source !== undefined) text(source);
  if (typeof c.evidence === 'string') text(c.evidence, false);
  else if (c.evidence !== undefined) {
    for (const source of [c.evidence.intentId, c.evidence.conversationId]) if (source !== undefined) text(source);
    if (c.evidence.snippet !== undefined) text(c.evidence.snippet, false);
  }
  if (c.userId !== userId) throw new WorkspaceError('SCOPE_DENIED');
}
export function projectIntent(input: unknown, userId: string, at: string): StoredIntent {
  const raw = object(input);
  const flat = raw.intent === undefined;
  const intent = flat ? raw : object(raw.intent);
  if (intent.userId !== userId) throw new WorkspaceError('SCOPE_DENIED');
  const id = identifier(intent.id);
  const kind = intent.kind === undefined ? undefined : identifier(intent.kind);
  if (kind !== undefined && ([...kind].length > 64 || !/^[\p{L}\p{N}][\p{L}\p{N}._:-]*$/u.test(kind))) invalid('Invalid intent kind');
  const result: StoredIntent = { intent: { id, userId }, extracted: [], recordedAt: isoTimestamp(at) };
  if (kind !== undefined) result.intent.kind = kind;
  if (flat) {
    result.agentId = identifier(raw.agentId);
    result.createdAt = isoTimestamp(raw.createdAt);
    object(raw.public);
    // A's public, text, query, quote title/seller can contain arbitrary dialogue.
    // Deliberately omit them: only explicit structured facts enter this history.
  } else {
    result.intent.expiresAt = isoTimestamp(intent.expiresAt);
    if (!Array.isArray(raw.extracted)) invalid('Extracted contributions are required');
    result.extracted = raw.extracted.map((value): LearningContribution => {
      const source = object(value);
      if (source.userId !== userId) throw new WorkspaceError('SCOPE_DENIED');
      const field = source.field;
      const basis = source.basis;
      if (!isField(field) || (basis !== 'stated' && basis !== 'observed' && basis !== 'inferred')) invalid();
      const c: LearningContribution = {
        id: identifier(source.id), userId, agentId: identifier(source.agentId),
        field, value: string(source.value, false), basis, createdAt: isoTimestamp(source.createdAt),
      };
      if (source.revokedAt !== undefined) c.revokedAt = isoTimestamp(source.revokedAt);
      if (source.intentId !== undefined) c.intentId = identifier(source.intentId);
      if (source.conversationId !== undefined) c.conversationId = identifier(source.conversationId);
      if (source.evidence !== undefined) c.evidence = projectEvidence(source.evidence);
      const nestedIntentId = typeof c.evidence === 'object' ? c.evidence.intentId : undefined;
      if ([c.intentId, nestedIntentId].some(sourceId => sourceId !== undefined && sourceId !== id)) invalid('Contribution belongs to another intent');
      if ([...c.value].length > 200) invalid('Intent summary value exceeds 200 characters');
      validateLearningContribution(c, userId);
      return c;
    });
  }
  if (raw.chosenQuote !== undefined) {
    const quote = object(raw.chosenQuote);
    if (typeof quote.price !== 'number' || !Number.isSafeInteger(quote.price) || quote.price < 0 || quote.currency !== 'USD') invalid('Invalid chosen quote');
    result.chosenQuote = { id: identifier(quote.id), price: quote.price, currency: 'USD' };
    if (!flat) result.chosenQuote.agentId = identifier(quote.agentId);
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
const contributionKeys = ['id', 'userId', 'agentId', 'field', 'value', 'basis', 'createdAt', 'revokedAt', 'intentId', 'conversationId'] as const;
export function renderIntent(record: StoredIntent): string {
  const attributes: [string, string][] = [['userId', record.intent.userId], ['recordedAt', record.recordedAt]];
  if (record.agentId !== undefined) attributes.push(['format', 'workspace-v1'], ['agentId', record.agentId], ['createdAt', record.createdAt!]);
  else attributes.push(['expiresAt', record.intent.expiresAt!], ['extractedCount', String(record.extracted.length)]);
  if (record.intent.kind !== undefined) attributes.push(['kind', record.intent.kind]);
  record.extracted.forEach((c, index) => {
    const prefix = `extracted.${index}.`;
    for (const key of contributionKeys) if (c[key] !== undefined) attributes.push([`${prefix}${key}`, c[key]!]);
    if (typeof c.evidence === 'string') attributes.push([`${prefix}evidence`, c.evidence]);
    else if (c.evidence !== undefined) {
      attributes.push([`${prefix}evidenceFormat`, 'nested']);
      for (const key of ['intentId', 'conversationId', 'snippet'] as const) {
        if (c.evidence[key] !== undefined) attributes.push([`${prefix}evidence.${key}`, c.evidence[key]!]);
      }
    }
  });
  if (record.chosenQuote) {
    for (const key of ['id', 'agentId', 'price', 'currency'] as const) {
      if (record.chosenQuote[key] !== undefined) attributes.push([`chosenQuote.${key}`, String(record.chosenQuote[key])]);
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
    let input: Record<string, unknown>;
    if (attributes.has('format')) {
      if (attributes.get('format') !== 'workspace-v1') return undefined;
      input = { id: unescape(match[1]!), userId: attributes.get('userId'), kind: attributes.get('kind'),
        agentId: attributes.get('agentId'), createdAt: attributes.get('createdAt'), public: {} };
    } else {
      const count = Number(attributes.get('extractedCount'));
      if (!Number.isSafeInteger(count) || count < 0 || count > attributes.size) return undefined;
      const extracted = Array.from({ length: count }, (_, index) => {
        const c: Record<string, unknown> = {};
        for (const key of [...contributionKeys, 'evidence']) {
          const value = attributes.get(`extracted.${index}.${key}`);
          if (value !== undefined) c[key] = value;
        }
        if (attributes.has(`extracted.${index}.evidenceFormat`)) {
          if (attributes.get(`extracted.${index}.evidenceFormat`) !== 'nested' || c.evidence !== undefined) invalid();
          const evidence: Record<string, string> = {};
          for (const key of ['intentId', 'conversationId', 'snippet']) {
            const value = attributes.get(`extracted.${index}.evidence.${key}`);
            if (value !== undefined) evidence[key] = value;
          }
          c.evidence = evidence;
        }
        return c;
      });
      input = { intent: { id: unescape(match[1]!), userId: attributes.get('userId'), kind: attributes.get('kind'), expiresAt: attributes.get('expiresAt') }, extracted };
    }
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
    const snippet = typeof c.evidence === 'string' ? c.evidence : c.evidence?.snippet;
    parts.push(`${c.field}=${c.value}${snippet === undefined ? '' : ` (${snippet})`}`);
  }
  if (record.chosenQuote) parts.push(`${record.chosenQuote.agentId ?? record.chosenQuote.id}: ${record.chosenQuote.price} ${record.chosenQuote.currency}`);
  const summary = parts.join('; ').replace(/[\s\x00-\x1f\x7f]+/gu, ' ').trim();
  return { intentId: record.intent.id, date: new Date(record.recordedAt).toISOString().slice(0, 10), summary };
}
