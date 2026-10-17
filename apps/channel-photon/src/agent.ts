import { createHash } from 'node:crypto';
import type { WorkspaceClient, FindInput, FindResult } from '@agent-cookie/sdk';

export type AgentWorkspace = Pick<WorkspaceClient, 'getMyCard' | 'find' | 'accept' | 'getReceipts'>;
export interface Conversation { offers?: FindResult }
export const operationKey = (kind: string, id: string) => `photon:${kind}:${createHash('sha256').update(id).digest('hex')}`;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const help = '我可以读取你的身份卡、找越野跑鞋、查看读取回执。试试「帮我找双越野跑鞋，120以内」，再回复「要第二双」。';

/** Deliberately bounded demo parser. It is not an LLM, and never invents identity or authority. */
export async function respond(text: string, messageId: string, conversation: Conversation, workspace: AgentWorkspace): Promise<string> {
  const input = text.trim();
  const selection = /^(?:要|选|选择|我要)?\s*(?:第)?\s*([12一二两])\s*(?:双|个|款)?[。！!]?$/u.exec(input)
    ?? /^(?:choose|select|take)\s+([12])$/i.exec(input);
  if (selection) {
    const index = ['1','一'].includes(selection[1]) ? 0 : 1;
    const quote = conversation.offers?.quotes[index];
    if (!quote) return '请先让我找鞋，看到报价后再选择。';
    const result = await workspace.accept(quote.id, operationKey('accept', quote.id));
    const prefix = result.sample ? '[Sample 演示] ' : '';
    if (result.status === 'handoff') return `${prefix}${result.continueUrl ? `已准备好所选商品的交接链接：\n${result.continueUrl}` : '商家需要继续处理，后台未提供交接链接。'}\n${result.message ?? ''}\n尚未付款，也未确认订单。${result.sample ? '此结果仅供演示。' : result.continueUrl ? '请打开链接核实库存、配送和最终金额。' : ''}`;
    if (result.status === 'ordered') return `${prefix}后台确认订单：${result.orderId}\n${result.message ?? ''}`;
    return `${prefix}${result.status === 'blocked' ? '暂时不能继续' : '本次操作失败'}：${result.message ?? result.code ?? '请检查后台状态。'}${result.continueUrl ? `\n后台提供的后续处理链接：${result.continueUrl}\n未确认订单或付款。${result.sample ? '此结果仅供演示。' : ''}` : ''}`;
  }
  if (/^(?:身份卡|我的资料|读卡|查看身份卡|card)$/i.test(input)) {
    const card = await workspace.getMyCard();
    if (!object(card) || !Array.isArray(card.card)) throw new Error('INVALID_CARD');
    const rows = card.card.filter(object).filter(c => ['shoe_size','budget'].includes(String(c.field)));
    return `${card.sample === true ? '[Sample 演示] ' : ''}身份卡\n${rows.map(c => `${c.field === 'shoe_size' ? '鞋码' : '预算'}：${String(c.value)}`).join('\n') || '还没有鞋码或预算。'}\n地址和支付资料不会显示在这条短信里。`;
  }
  if (/^(?:回执|查看回执|receipts)$/i.test(input)) {
    const result = await workspace.getReceipts();
    return `${result.sample ? '[Sample 演示] ' : ''}最近的字段读取：\n${result.receipts.slice(-5).map(r => `${r.agentId} · ${r.fields.join(', ')} · ${r.purpose}`).join('\n') || '暂无读取回执。'}`;
  }
  if (/(?:找|买|推荐|search|find|buy)/i.test(input) && /(?:越野|跑鞋|trail|running shoes)/i.test(input)) {
    const budget = /(?:预算\s*[：:]?\s*|\$|under\s+|budget\s+)(\d+(?:\.\d{1,2})?)/i.exec(input)?.[1]
      ?? /(\d+(?:\.\d{1,2})?)\s*(?:美元|美金|刀)?\s*(?:以内|以下)/.exec(input)?.[1];
    const deadline = input.match(/(?:周|星期)[一二三四五六日天]前(?:到)?/)?.[0];
    const intent: FindInput = { kind:'trail_shoes', public:{...(budget ? {budget} : {}), ...(deadline ? {deadline} : {})} };
    // Drop stale options before a new search so failure cannot select yesterday's offer.
    delete conversation.offers;
    const found = await workspace.find(intent, operationKey('find',messageId));
    conversation.offers = { ...found, quotes: found.quotes.slice(0,2) };
    const lines = conversation.offers.quotes.map((q,i) => `${i+1}. ${q.title ?? q.text} — $${(q.price/100).toFixed(2)} USD\n${q.etaDate ? `商家提供的到货日期：${q.etaDate}` : '到货时间未知'}${q.etaText ? `；${q.etaText}` : ''}`);
    return `${found.sample ? '[Sample 演示报价，非真实库存]\n' : ''}${lines.join('\n\n') || '没有找到符合条件的报价。'}${lines.length ? '\n\n回复「要第一双」或「要第二双」。' : ''}${deadline ? '\n目前不能保证你要求的到货时间。' : ''}`;
  }
  return help;
}

export function publicFailure(error: unknown): string {
  const code = object(error) && typeof error.code === 'string' ? error.code : '';
  if (['GRANT_EXPIRED','GRANT_REVOKED','NOT_FOUND'].includes(code)) return '这次报价已失效或权限已撤销，请重新找鞋。';
  if (code === 'MISSING_FIELD') return '缺少必要资料或输入不完整，暂时无法继续。';
  if (code === 'IDEMPOTENCY_CONFLICT') return '本次选择与之前的操作冲突，请重新找鞋后选择。';
  return '后台暂时无法完成请求；未确认新的订单或付款。请稍后查看回执再重试。';
}
