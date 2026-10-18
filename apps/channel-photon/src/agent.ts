import { createHash } from 'node:crypto';
import type { WorkspaceClient, FindResult } from '@agent-cookie/sdk';
import { shoppingInput } from './intent.js';
import { hasCjk } from './keywords.js';
import { localeFromMessage, translator, type Locale } from './i18n.js';

export type AgentWorkspace = Pick<WorkspaceClient, 'getMyCard' | 'find' | 'accept' | 'getReceipts'>;
export interface Conversation { offers?: FindResult; locale?: Locale; cardLang?: string }
export const operationKey = (kind: string, id: string) => `photon:${kind}:${createHash('sha256').update(id).digest('hex')}`;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Deliberately bounded demo parser. It is not an LLM, and never invents identity or authority. */
export async function respond(text: string, messageId: string, conversation: Conversation, workspace: AgentWorkspace): Promise<string> {
  if (!hasCjk(text) && !/[a-z]/i.test(text) && !conversation.cardLang) {
    try {
      const card = await workspace.getMyCard();
      if (object(card) && Array.isArray(card.card)) conversation.cardLang = card.card.filter(object).find(c => c.field === 'lang')?.value as string | undefined;
    } catch { /* Language lookup must not prevent selection. */ }
  }
  const locale = localeFromMessage(text, conversation.cardLang, conversation.locale);
  conversation.locale = locale;
  const t = translator(locale);
  const input = text.trim();
  const selection = /^(?:要|选|选择|我要)?\s*(?:第)?\s*([1-9一二两三四五])\s*(?:双|个|款|件)?[。！!]?$/u.exec(input)
    ?? /^(?:choose|select|take)\s+([1-9])$/i.exec(input);
  if (selection) {
    const number = ({一:1,二:2,两:2,三:3,四:4,五:5} as Record<string,number>)[selection[1]] ?? Number(selection[1]);
    const index = number - 1;
    const quote = conversation.offers?.quotes[index];
    if (!quote) return t('selectFirst');
    const result = await workspace.accept(quote.id, operationKey('accept', quote.id));
    // AcceptResult has no source field yet; retain the selected quote's provenance.
    const sample = result.sample || conversation.offers?.sample || quote.source === 'sample' || quote.source === 'fixture';
    const prefix = sample ? t('sample') : '';
    if (result.status === 'handoff') return `${prefix}${result.continueUrl ? t('handoffLink', result.continueUrl) : t('handoffMissing')}\n${result.message ?? ''}\n${t('unpaid')}${sample ? t('demoOnly') : result.continueUrl ? t('verify') : ''}`;
    if (result.status === 'ordered') return `${prefix}${t('ordered', result.orderId ?? '')}\n${result.message ?? ''}`;
    return `${prefix}${result.status === 'blocked' ? t('blocked') : t('failed')}：${result.message ?? result.code ?? t('check')}${result.continueUrl ? `${t('followUp', result.continueUrl)}${sample ? t('demoOnly') : ''}` : ''}`;
  }
  if (/^(?:身份卡|我的资料|读卡|查看身份卡|card)$/i.test(input)) {
    const card = await workspace.getMyCard();
    if (!object(card) || !Array.isArray(card.card)) throw new Error('INVALID_CARD');
    conversation.cardLang = card.card.filter(object).find(c => c.field === 'lang')?.value as string | undefined;
    const rows = card.card.filter(object).filter(c => ['shoe_size','budget'].includes(String(c.field)));
    return `${card.sample === true ? t('sample') : ''}${t('card')}\n${rows.map(c => `${c.field === 'shoe_size' ? t('size') : t('budget')}：${String(c.value)}`).join('\n') || t('noFields')}\n${t('private')}`;
  }
  if (/^(?:回执|查看回执|receipts)$/i.test(input)) {
    const result = await workspace.getReceipts();
    return `${result.sample ? t('sample') : ''}${t('receipts')}${result.receipts.slice(-5).map(r => `${r.agentId} · ${r.fields.join(', ')} · ${r.purpose}`).join('\n') || t('noReceipts')}`;
  }
  if (!input || /^(?:帮助|你好|谢谢|help|hello|hi|thanks|ping)[!！。.]?$/i.test(input)
    || /^(?:accept|checkout|pay)\s+(?:quoteId|userId|agentId|purpose)=/i.test(input)) return t('help');
  {
    const intent = shoppingInput(text);
    const deadline = intent.public?.deadline;
    // Drop stale options before a new search so failure cannot select yesterday's offer.
    delete conversation.offers;
    const found = await workspace.find(intent, operationKey('find',messageId));
    conversation.offers = { ...found, quotes: found.quotes.slice(0,Number(intent.public?.count ?? 2)) };
    const lines = conversation.offers.quotes.map((q,i) => `${i+1}. ${q.title ?? q.text} — $${(q.price/100).toFixed(2)} USD\n${q.etaDate ? t('eta', q.etaDate) : t('etaUnknown')}${q.etaText ? `；${q.etaText}` : ''}${q.sizeNote ? `\n${q.sizeNote}` : ''}`);
    const selectionHint = lines.length > 2 ? t('selectMany', lines.length) : lines.length > 1 ? t('selectTwo') : lines.length === 1 ? t('selectOne') : '';
    const sourceHint = found.quotes.some(q => q.source === 'fixture')
      ? t('fixture')
      : found.sample ? t('sampleQuotes') : '';
    return `${sourceHint}${lines.join('\n\n') || t('noQuotes')}${!intent.query && hasCjk(text) ? t('untranslated') : ''}${selectionHint}${deadline ? t('deadline') : ''}`;
  }
}

export function publicFailure(error: unknown, locale: Locale = 'zh'): string {
  const t = translator(locale);
  const code = object(error) && typeof error.code === 'string' ? error.code : '';
  if (['GRANT_EXPIRED','GRANT_REVOKED','NOT_FOUND'].includes(code)) return t('expired');
  if (code === 'MISSING_FIELD') return t('missing');
  if (code === 'IDEMPOTENCY_CONFLICT') return t('conflict');
  return t('failure');
}
