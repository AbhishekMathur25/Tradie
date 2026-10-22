import { describe, expect, it } from "vitest";
import {
  documentTotals,
  formatCents,
  gstOn,
  lineAmountCents,
  marginPercent,
  parseDollars,
  parseQuantity,
  type Line,
} from "@/domain/money";

const line = (overrides: Partial<Line> = {}): Line => ({
  description: "Labour",
  quantityMilli: 1000,
  unitPriceCents: 9500,
  unitCostCents: 5000,
  taxable: true,
  priceItemId: null,
  ...overrides,
});

describe("money", () => {
  it("multiplies fractional quantities exactly", () => {
    expect(lineAmountCents({ quantityMilli: 1500, unitPriceCents: 9500 })).toBe(14250);
    // 0.333 x $10.00 = $3.33 (rounded half up from 333.0)
    expect(lineAmountCents({ quantityMilli: 333, unitPriceCents: 1000 })).toBe(333);
    // 0.005 x $1.00 = 0.5c, rounds up to 1c
    expect(lineAmountCents({ quantityMilli: 5, unitPriceCents: 100 })).toBe(1);
  });

  it("charges 10% GST rounded to the nearest cent", () => {
    expect(gstOn(10000)).toBe(1000);
    expect(gstOn(105)).toBe(11); // 10.5c rounds up
    expect(gstOn(104)).toBe(10);
  });

  it("totals a document and only taxes taxable lines", () => {
    const totals = documentTotals(
      [
        line({ quantityMilli: 8000 }),
        line({ description: "Permit", unitPriceCents: 25000, taxable: false }),
      ],
      true,
    );
    expect(totals.subtotalCents).toBe(8 * 9500 + 25000);
    expect(totals.gstCents).toBe(7600); // 10% of the $760 labour only
    expect(totals.totalCents).toBe(76000 + 25000 + 7600);
    expect(totals.costCents).toBe(8 * 5000 + 5000);
  });

  it("charges no GST when the business isn't registered", () => {
    const totals = documentTotals([line()], false);
    expect(totals.gstCents).toBe(0);
    expect(totals.totalCents).toBe(totals.subtotalCents);
  });

  it("works out quoted margin", () => {
    expect(marginPercent(10000, 7300)).toBe(27);
    expect(marginPercent(0, 0)).toBeNull();
  });

  it("parses dollars and quantities typed by people", () => {
    expect(parseDollars("$1,250.5")).toBe(125050);
    expect(parseDollars("90")).toBe(9000);
    expect(parseDollars("12.345")).toBeNull();
    expect(parseDollars("abc")).toBeNull();
    expect(parseQuantity("1.5")).toBe(1500);
    expect(parseQuantity("0")).toBeNull();
  });

  it("formats Australian dollars", () => {
    expect(formatCents(123450)).toBe("$1,234.50");
  });
});
