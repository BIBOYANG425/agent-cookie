import { PREF_VALUE_MAX } from "@agent-cookie/contract";

// Deterministic content guards. "卡号不进任何地方": a card number never enters the card, a note or an intent.
// Intent public values are broadcast to every matched merchant, so they may not carry contact or payment data.

/**
 * Luhn-valid run of 13–19 digits, allowing up to two spaces, dashes or dots between digits. Full-width and other
 * compatibility digits are folded first (NFKC), so "４１１１ １１１１ …" is caught too.
 */
export function containsCardNumber(text: string): boolean {
  const runs = text.normalize("NFKC").match(/\d(?:[ .-]{0,2}\d){12,18}/g) ?? [];
  return runs.some((run) => {
    const digits = run.replace(/[ .-]/g, "");
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

/** Contact or payment data in free text (email, phone number, card number): never stored as a learned value or snippet. */
export function containsContactOrPayment(text: string): boolean {
  const t = text.normalize("NFKC");
  return EMAIL.test(t) || PHONE.test(t) || containsCardNumber(t);
}

/** A street address ("12 Oak St", "1234 Sample Street", "5 rue …"): not something a preference may hold. */
const STREET = /\b\d{1,6}\s+(?:[\p{L}.'-]+\s+){0,3}(?:st|street|ave|avenue|rd|road|blvd|boulevard|ln|lane|dr|drive|way|ct|court|pl|place|hwy|highway|apt|suite|rue|straße|strasse)\b/iu;
export function looksLikeStreetAddress(text: string): boolean {
  return STREET.test(text.normalize("NFKC"));
}

/** Why an intent public entry is refused, or undefined when it may be broadcast. */
export function publicEntryProblem(key: string, value: string): string | undefined {
  if (keyTokens(key).some((t) => SENSITIVE_TOKENS.has(t))) return "intent public values may not carry contact, address or payment data";
  if (EMAIL.test(value) || PHONE.test(value) || containsCardNumber(value)) return "intent public values may not carry contact, address or payment data";
  return undefined;
}

/** Why a pref.* value is refused (whoever writes it), or undefined. Retail merchants read these with the handshake. */
export function prefValueProblem(value: string): string | undefined {
  const v = value.normalize("NFKC").trim();
  if (!v) return "empty value";
  if ([...v].length > PREF_VALUE_MAX) return `a preference is at most ${PREF_VALUE_MAX} characters`;
  if (containsContactOrPayment(v) || looksLikeStreetAddress(v)) return "a preference may not carry contact, address or payment data";
  return undefined;
}
