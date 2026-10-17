/** Men's EU → US, the common Brooks/Saucony/Nike table. */
const EU_TO_US_MEN: Record<string, string> = {
  "38": "5.5", "38.5": "6", "39": "6.5", "40": "7", "40.5": "7.5", "41": "8", "42": "8.5", "42.5": "9", "43": "9.5",
  "44": "10", "44.5": "10.5", "45": "11", "45.5": "11.5", "46": "12", "47": "13", "48": "14",
};
const US_TO_EU_MEN: Record<string, string> = Object.fromEntries(
  Object.entries(EU_TO_US_MEN).map(([eu, us]) => [us, eu]),
);

export interface Size { system: "EU" | "US"; value: string }

function normalizedNumber(value: string): string | undefined {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? String(number) : undefined;
}

export function parseSize(raw: string): Size | undefined {
  const tokens = raw.trim().replace(/[’]/g, "'").toLowerCase().replace(/\s+/g, " ").split(" ");
  if (tokens.length === 0 || tokens[0] === "") return undefined;

  let system: "EU" | "US" | undefined;
  let value: string | undefined;
  let hasMensMarker = false;
  for (const token of tokens) {
    if (token === "uk" || token === "w" || token === "womens" || token === "women's") return undefined;
    if (token === "us" || token === "eu" || token === "eur") {
      const nextSystem = token === "us" ? "US" : "EU";
      if (system) return undefined;
      system = nextSystem;
      continue;
    }
    if (token === "m" || token === "mens" || token === "men's") {
      if (hasMensMarker) return undefined;
      hasMensMarker = true;
      continue;
    }
    if (/^\d+(?:\.\d+)?$/.test(token)) {
      if (value !== undefined) return undefined;
      value = normalizedNumber(token);
      if (!value) return undefined;
      continue;
    }
    return undefined;
  }

  if (!value) return undefined;
  return { system: system ?? (hasMensMarker || Number(value) < 30 ? "US" : "EU"), value };
}

export function toSystem(size: Size, system: "EU" | "US"): string | undefined {
  const value = normalizedNumber(size.value);
  if (!value) return undefined;
  if (size.system === system) return value;
  return system === "US" ? EU_TO_US_MEN[value] : US_TO_EU_MEN[value];
}

export function sizeMatches(options: readonly string[], cardSize: string): boolean {
  const requested = parseSize(cardSize);
  if (!requested) return false;
  return options.some((option) =>
    option.split(/[\/,]/).some((component) => {
      const available = parseSize(component);
      return available !== undefined
        && toSystem(requested, available.system) === available.value;
    })
  );
}
