import {
  isField, WorkspaceError,
  type Contribution, type Note, type Receipt, type WriteMeta,
} from '@agent-cookie/contract';

export function text(value: unknown, nonempty = true): asserts value is string {
  if (typeof value !== 'string' || (nonempty && value.length === 0)
    || Buffer.from(value, 'utf8').toString('utf8') !== value || value.includes('\0')) {
    throw new WorkspaceError('MISSING_FIELD', 'Invalid text');
  }
}

export function timestamp(value: unknown): asserts value is string {
  text(value);
  if (!Number.isFinite(Date.parse(value)) || /[\r\n]/u.test(value)) {
    throw new WorkspaceError('MISSING_FIELD', 'Invalid timestamp');
  }
}

export function metadata(meta: WriteMeta): void {
  text(meta.author);
  text(meta.sig);
  timestamp(meta.at);
  if (meta.author.trim() !== meta.author || /[<>\x00-\x1f\x7f]/u.test(meta.author)
    || /[\x00-\x1f\x7f]/u.test(meta.sig) || meta.sig.trim() !== meta.sig) {
    throw new WorkspaceError('MISSING_FIELD', 'Invalid commit metadata');
  }
}

// Lowercase ASCII stays readable. Encoding uppercase and '%' avoids aliases on
// case-insensitive filesystems; all other UTF-8 bytes are encoded independently.
export function filename(id: string): string {
  text(id);
  let encoded = '';
  for (const byte of Buffer.from(id, 'utf8')) {
    const character = String.fromCharCode(byte);
    encoded += /^[a-z0-9._-]$/u.test(character)
      ? character : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  if (encoded.length > 252) throw new WorkspaceError('MISSING_FIELD', 'Identifier is too long');
  return `${encoded}.md`;
}

export function ownerFromFilename(name: string): string {
  if (!name.endsWith('.md')) throw new Error('Unexpected memory record filename');
  let decoded: string;
  try { decoded = decodeURIComponent(name.slice(0, -3)); }
  catch { throw new Error('Invalid memory record filename'); }
  if (filename(decoded) !== name) throw new Error('Noncanonical memory record filename');
  return decoded;
}

function escape(value: string): string {
  return value.replace(/[%\r\n\[\];:]/gu,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`);
}

function unescape(value: string): string {
  return value.replace(/%(25|0D|0A|5B|5D|3B|3A)/giu,
    (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
}

export function validateContribution(c: Contribution, userId: string): void {
  text(c.id); filename(c.agentId); text(c.value, false); timestamp(c.createdAt);
  if (c.revokedAt !== undefined) timestamp(c.revokedAt);
  if (!isField(c.field) || !['observed', 'stated', 'inferred'].includes(c.basis)) {
    throw new WorkspaceError('MISSING_FIELD', 'Invalid contribution');
  }
  if (c.userId !== userId) throw new WorkspaceError('SCOPE_DENIED');
}

export function validateNote(note: Note, userId: string): void {
  text(note.agentId); text(note.key); text(note.value, false);
  timestamp(note.updatedAt); timestamp(note.expiresAt);
  if (note.userId !== userId) throw new WorkspaceError('SCOPE_DENIED');
}

export function renderNotes(notes: readonly Note[]): string {
  return notes.map((n) => `- ${escape(n.key)}: ${escape(n.value)} [agentId: ${escape(n.agentId)}; userId: ${escape(n.userId)}; updatedAt: ${escape(n.updatedAt)}; expiresAt: ${escape(n.expiresAt)}]\n`).join('');
}

export function parseNotes(markdown: string, userId: string): Note[] {
  const notes: Note[] = [];
  const keys = new Set<string>();
  for (const line of markdown.split('\n')) {
    if (line === '') continue;
    const match = /^- ([^:\r\n]+): (.*) \[([^\[\]\r\n]*)\]$/su.exec(line);
    if (!match) throw new Error('Malformed note record');
    const attributes = new Map<string, string>();
    for (const part of match[3]!.split('; ')) {
      const attribute = /^(agentId|userId|updatedAt|expiresAt): (.*)$/su.exec(part);
      if (!attribute || attributes.has(attribute[1]!)) throw new Error('Malformed note attributes');
      attributes.set(attribute[1]!, unescape(attribute[2]!));
    }
    if (attributes.size !== 4) throw new Error('Incomplete note attributes');
    const note: Note = {
      agentId: attributes.get('agentId')!, userId: attributes.get('userId')!,
      key: unescape(match[1]!), value: unescape(match[2]!),
      updatedAt: attributes.get('updatedAt')!, expiresAt: attributes.get('expiresAt')!,
    };
    validateNote(note, userId);
    if (keys.has(note.key) || (notes[0] && notes[0].agentId !== note.agentId)) {
      throw new Error('Conflicting note ownership or key');
    }
    keys.add(note.key);
    notes.push(note);
  }
  return notes;
}

export function renderReceipt(receipt: Receipt): string {
  text(receipt.id); text(receipt.sessionId); text(receipt.agentId);
  text(receipt.purpose, false); timestamp(receipt.createdAt);
  if (!Array.isArray(receipt.fields) || receipt.fields.some((field) => !isField(field))) {
    throw new WorkspaceError('MISSING_FIELD', 'Invalid receipt fields');
  }
  if (receipt.amount !== undefined && (!Number.isFinite(receipt.amount) || receipt.amount < 0)) {
    throw new WorkspaceError('MISSING_FIELD', 'Invalid receipt amount');
  }
  const amount = receipt.amount === undefined ? '' : `; amount: ${receipt.amount}`;
  return `- receipt: ${escape(receipt.purpose)} [id: ${escape(receipt.id)}; sessionId: ${escape(receipt.sessionId)}; agentId: ${escape(receipt.agentId)}; fields: ${receipt.fields.join(',')}; at: ${escape(receipt.createdAt)}${amount}]`;
}
