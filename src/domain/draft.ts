/**
 * Turning a spoken or typed job description into draft quote lines.
 *
 * This file is pure (no network): it builds the compact price list the AI
 * sees, parses and validates the AI's reply, removes known personal details
 * before anything leaves the app, and provides a keyword matcher used when
 * AI is switched off or fails. The person always reviews the draft.
 */
import { z } from "zod";
import type { Line } from "./money";

export interface DraftPriceItem {
  id: string;
  name: string;
  unit: string;
  priceCents: number;
  costCents: number;
  taxable: boolean;
}

export interface DraftResult {
  lines: Line[];
  source: "ai" | "keywords";
  notes: string[];
}

/** Lines the price list is shown to the model as: "3|Tiler labour|hour|$85.00". */
export function priceListForPrompt(items: DraftPriceItem[]): string {
  return items
    .map(
      (item, index) =>
        `${index + 1}|${item.name}|${item.unit}|$${(item.priceCents / 100).toFixed(2)}`,
    )
    .join("\n");
}

/**
 * Removes personal details before the description is sent to an AI service:
 * the customer's name and address we already know, plus emails and phone numbers.
 */
export function redactPersonalDetails(text: string, knownTerms: string[]): string {
  let result = text;
  for (const term of knownTerms) {
    const trimmed = term.trim();
    if (trimmed.length < 3) continue;
    const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(escaped, "gi"), "[customer detail]");
  }
  return result
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[email]")
    .replace(/(?:\+?61|0)[\s-]?\d(?:[\s-]?\d){7,9}/g, "[phone]");
}

export const DRAFT_SYSTEM_PROMPT = [
  "You turn an Australian tradie's job description into quote lines.",
  "The price list has one item per line: number|name|unit|price excluding GST.",
  'Reply with JSON only, no other text: {"lines":[{"i":2,"q":8},{"d":"Skip bin 4m3","q":1,"p":450}]}',
  '- Use "i" (the item number) when a price list item fits, with "q" the quantity in that unit.',
  '- Use "d" and "p" only for work not on the list, and only if the description gives a price.',
  "- At most 12 lines. Never invent prices for listed items.",
].join("\n");

const aiReplySchema = z.object({
  lines: z
    .array(
      z.object({
        i: z.number().int().positive().optional(),
        d: z.string().trim().min(1).max(300).optional(),
        q: z.number().positive().max(100_000),
        p: z.number().min(0).max(1_000_000).optional(),
      }),
    )
    .max(20),
});

/** Pulls the first JSON object out of a reply that may have extra text around it. */
function extractJson(reply: string): unknown {
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(reply.slice(start, end + 1));
  } catch {
    return null;
  }
}

const toMilli = (quantity: number) => Math.max(1, Math.round(quantity * 1000));

/** Validates the model's reply and maps it onto real price list items. */
export function parseAiReply(reply: string, items: DraftPriceItem[]): DraftResult | null {
  const parsed = aiReplySchema.safeParse(extractJson(reply));
  if (!parsed.success) return null;
  const notes: string[] = [];
  const lines: Line[] = [];
  const byName = new Map(items.map((item) => [item.name.trim().toLowerCase(), item]));
  for (const raw of parsed.data.lines) {
    // Models sometimes write a listed item as a custom line; link it back.
    const item =
      (raw.i !== undefined ? items[raw.i - 1] : undefined) ??
      (raw.d ? byName.get(raw.d.trim().toLowerCase()) : undefined);
    if (item) {
      lines.push({
        description: item.name,
        quantityMilli: toMilli(raw.q),
        unitPriceCents: item.priceCents,
        unitCostCents: item.costCents,
        taxable: item.taxable,
        priceItemId: item.id,
      });
    } else if (raw.d) {
      lines.push({
        description: raw.d,
        quantityMilli: toMilli(raw.q),
        unitPriceCents: Math.round((raw.p ?? 0) * 100),
        unitCostCents: 0,
        taxable: true,
        priceItemId: null,
      });
      if (!raw.p) notes.push(`"${raw.d}" has no price yet.`);
    }
  }
  if (lines.length === 0) return null;
  return { lines, source: "ai", notes };
}

// Words too generic to identify an item on their own.
const STOP_WORDS = new Set([
  "and",
  "the",
  "for",
  "with",
  "per",
  "each",
  "hour",
  "supply",
  "install",
  "labour",
  "unit",
  "item",
]);

/** Distinguishing words: lower case, plural "s" dropped, no sizes like "900mm". */
function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((word) => word.replace(/s$/, ""))
    .filter((word) => word.length >= 3 && !/\d/.test(word) && !STOP_WORDS.has(word));
}

/**
 * Offline fallback: finds price list items whose name words appear in the
 * description, and takes a number written just before them as the quantity
 * ("8 hours tiler labour", "2 x vanity"). Crude on purpose: it's a starting
 * point the person edits, not a guess at prices.
 */
export function keywordDraft(description: string, items: DraftPriceItem[]): DraftResult {
  const text = description.toLowerCase();
  const descriptionWords = new Set(words(description));
  const lines: Line[] = [];
  for (const item of items) {
    const itemWords = words(item.name);
    const hits = itemWords.filter((word) => descriptionWords.has(word));
    // Short names must match fully ("wall tiling" needs both words, so a
    // "laundry wall" doesn't match); longer names need at least two words.
    if (hits.length === 0 || hits.length < Math.min(itemWords.length, 2)) continue;
    // The quantity sits before whichever matched word comes first.
    const firstHit = Math.min(...hits.map((word) => text.search(new RegExp(`\\b${word}`))));
    const before = text.slice(Math.max(0, firstHit - 25), firstHit);
    // A number, an optional unit, then at most one word before the item name.
    const quantityMatch = before.match(
      /(\d+(?:\.\d+)?)\s*(?:x|hrs?|hours?|m2|m|lm|sqm|days?)?\s*(?:of\s+)?(?:[a-z]+\s+)?$/,
    );
    const quantity = quantityMatch ? Number(quantityMatch[1]) : 1;
    lines.push({
      description: item.name,
      quantityMilli: toMilli(quantity > 0 ? quantity : 1),
      unitPriceCents: item.priceCents,
      unitCostCents: item.costCents,
      taxable: item.taxable,
      priceItemId: item.id,
    });
  }
  return {
    lines,
    source: "keywords",
    notes: lines.length === 0 ? ["No price list items matched. Add lines by hand."] : [],
  };
}
