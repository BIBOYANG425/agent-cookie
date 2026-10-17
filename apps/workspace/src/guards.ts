// Deterministic content guards. "卡号不进任何地方": a card number never enters the card, a note or an intent.
// Intent public values are broadcast to every matched merchant, so they may not carry contact or payment data.

/** Luhn-valid run of 13–19 digits, allowing single spaces or dashes between digits. */
export function containsCardNumber(text: string): boolean {
  const runs = text.match(/\d(?:[ -]?\d){12,18}/g) ?? [];
  return runs.some((run) => {
    const digits = run.replace(/[ -]/g, "");
    if (digits.length < 13 || digits.length > 19) return false;
    let sum = 0;
    for (let i = 0; i < digits.length; i++) {
      let d = Number(digits[digits.length - 1 - i]);
      if (i % 2 === 1) {
        d *= 2;
        if (d > 9) d -= 9;
      }
      sum += d;
    }
    return sum % 10 === 0;
  });
}

/** payment_method holds a provider token reference ("pm_…", "tok_…"), never card data. */
export function isTokenReference(value: string): boolean {
  return /^[A-Za-z]{2,12}_[A-Za-z0-9_]{4,128}$/.test(value) && !containsCardNumber(value);
}

/** Whole-word tokens of a key ("shippingAddress", "ship_addr", "e-mail" → shipping/address, ship/addr, e/mail). */
const SENSITIVE_TOKENS = new Set(["address", "addr", "street", "zip", "zipcode", "postal", "postcode", "phone", "tel", "telephone", "mobile",
  "email", "mail", "card", "pan", "cvv", "cvc", "payment", "passport", "ssn", "birthday", "birth", "dob"]);
function keyTokens(key: string): string[] {
  return key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const PHONE = /(?:\+?\d[\s().-]?){10,}/;

/** Why an intent public entry is refused, or undefined when it may be broadcast. */
export function publicEntryProblem(key: string, value: string): string | undefined {
  if (keyTokens(key).some((t) => SENSITIVE_TOKENS.has(t))) return "intent public values may not carry contact, address or payment data";
  if (EMAIL.test(value) || PHONE.test(value) || containsCardNumber(value)) return "intent public values may not carry contact, address or payment data";
  return undefined;
}
