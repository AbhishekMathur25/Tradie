/**
 * Money and GST arithmetic. Pure functions, no I/O.
 *
 * Rules:
 * - All amounts are integer cents. Never use floating point for money.
 * - Line prices are GST-exclusive. GST is 10% of the taxable subtotal,
 *   rounded to the nearest cent (half up), calculated once per document.
 * - Quantities are stored in thousandths (1.5 hours = 1500) so fractional
 *   quantities stay exact.
 */
import { z } from "zod";

export const GST_RATE_PERCENT = 10;

export const lineSchema = z.object({
  description: z.string().trim().min(1, "Each line needs a description").max(300),
  quantityMilli: z.number().int().positive("Quantity must be more than zero"),
  unitPriceCents: z.number().int().min(0),
  unitCostCents: z.number().int().min(0).default(0),
  taxable: z.boolean().default(true),
  priceItemId: z.string().uuid().nullable().default(null),
});

export type Line = z.infer<typeof lineSchema>;

export interface Totals {
  /** Sum of line amounts, GST-exclusive. */
  subtotalCents: number;
  gstCents: number;
  /** Subtotal plus GST. */
  totalCents: number;
  /** Sum of line costs, GST-exclusive; used for quoted margin. */
  costCents: number;
}

/** Rounds a non-negative rational a/b to the nearest integer, halves up. */
function divideRounded(numerator: number, denominator: number): number {
  return Math.floor((numerator * 2 + denominator) / (denominator * 2));
}

/** Amount for one line, GST-exclusive, in cents. */
export function lineAmountCents(line: Pick<Line, "quantityMilli" | "unitPriceCents">): number {
  return divideRounded(line.quantityMilli * line.unitPriceCents, 1000);
}

export function lineCostCents(line: Pick<Line, "quantityMilli" | "unitCostCents">): number {
  return divideRounded(line.quantityMilli * line.unitCostCents, 1000);
}

/** GST on a GST-exclusive amount. */
export function gstOn(exclusiveCents: number): number {
  return divideRounded(exclusiveCents * GST_RATE_PERCENT, 100);
}

/**
 * Totals for a document. When the business isn't registered for GST, no GST
 * is charged regardless of the lines' taxable flags.
 */
export function documentTotals(lines: readonly Line[], gstRegistered: boolean): Totals {
  let subtotalCents = 0;
  let taxableCents = 0;
  let costCents = 0;
  for (const line of lines) {
    const amount = lineAmountCents(line);
    subtotalCents += amount;
    if (line.taxable) taxableCents += amount;
    costCents += lineCostCents(line);
  }
  const gstCents = gstRegistered ? gstOn(taxableCents) : 0;
  return { subtotalCents, gstCents, totalCents: subtotalCents + gstCents, costCents };
}

/** Quoted margin as a whole percentage of the GST-exclusive price. */
export function marginPercent(subtotalCents: number, costCents: number): number | null {
  if (subtotalCents <= 0) return null;
  return Math.round(((subtotalCents - costCents) / subtotalCents) * 100);
}

/** Parses a dollar amount typed by a person ("1,250.5", "$90") into cents. */
export function parseDollars(input: string): number | null {
  const cleaned = input.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  const [whole, fraction = ""] = cleaned.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

/** Parses a quantity typed by a person ("2", "1.5") into thousandths. */
export function parseQuantity(input: string): number | null {
  const cleaned = input.trim();
  if (!/^\d+(\.\d{0,3})?$/.test(cleaned)) return null;
  const [whole, fraction = ""] = cleaned.split(".");
  const value = Number(whole) * 1000 + Number(fraction.padEnd(3, "0"));
  return value > 0 ? value : null;
}

const audFormatter = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
  minimumFractionDigits: 2,
});

/** "$1,234.50". Negative amounts keep their sign. */
export function formatCents(cents: number): string {
  return audFormatter.format(cents / 100);
}

/** Whole dollars for dashboards: "$18,460". */
export function formatWholeDollars(cents: number): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
  }).format(Math.round(cents / 100));
}

export function formatQuantity(quantityMilli: number): string {
  return (quantityMilli / 1000).toLocaleString("en-AU", { maximumFractionDigits: 3 });
}

/** Cents as a plain decimal string for form inputs ("1250.50"). */
export function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2);
}
