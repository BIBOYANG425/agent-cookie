const products: ReadonlyArray<readonly [RegExp, string]> = [
  [/防水外套|防水夹克/u, 'waterproof jacket'], [/雨衣/u, 'rain jacket'], [/外套|夹克/u, 'jacket'],
  [/围巾/u, 'scarf'], [/篮球鞋/u, 'basketball shoes'], [/越野跑鞋/u, 'trail running shoes'], [/跑鞋/u, 'running shoes'],
  [/帽子/u, 'hat'], [/手套/u, 'gloves'], [/背包/u, 'backpack'], [/T恤/iu, 't-shirt'], [/袜子/u, 'socks'], [/卫衣/u, 'hoodie'],
];
export const hasCjk = (text: string) => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(text);

/** Unknown Chinese categories deliberately fall back to the original text, not a guessed translation. */
export function catalogQuery(text: string): string | undefined {
  if (!hasCjk(text)) return text.trim() || undefined;
  const product = products.find(([pattern]) => pattern.test(text))?.[1];
  if (!product) return undefined;
  const recipient = /送妈妈/u.test(text) ? 'for mom' : /送爸爸/u.test(text) ? 'for dad' : '';
  return [product, recipient].filter(Boolean).join(' ');
}

export function isShoppingRequest(text: string): boolean {
  return /(?:^|[。！？!?，,；;])\s*(?:请|麻烦)?\s*(?:(?:帮我|给我)(?:找|挑|选|买|推荐)|(?:我)?(?:想要|想|要|需要)(?:找|买|选购)|推荐|找|买|选购)/u.test(text)
    || /(?:^|[.!?,;])\s*(?:please\s+)?(?:(?:can|could|would) you\s+)?(?:find|search|buy|shop|recommend)\b/iu.test(text)
    || /\bI(?:'m| am) looking for\b/iu.test(text)
    || (hasCjk(text) && products.some(([pattern]) => pattern.test(text))
      && !/(?:喜欢|不喜欢|通常|习惯|偏好|大多|已经|是|好看|舒服|prefer|usually)/iu.test(text));
}
