import { describe, expect, it } from "vitest";
import {
  keywordDraft,
  parseAiReply,
  redactPersonalDetails,
  type DraftPriceItem,
} from "@/domain/draft";

const items: DraftPriceItem[] = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    name: "Carpenter labour",
    unit: "hour",
    priceCents: 9500,
    costCents: 5500,
    taxable: true,
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    name: "Wall tiling",
    unit: "m2",
    priceCents: 8500,
    costCents: 4000,
    taxable: true,
  },
  {
    id: "00000000-0000-4000-8000-000000000003",
    name: "Vanity unit 900mm",
    unit: "each",
    priceCents: 120000,
    costCents: 80000,
    taxable: true,
  },
];

describe("AI reply parsing", () => {
  it("maps item numbers to price list items and keeps listed prices", () => {
    const result = parseAiReply('Sure! {"lines":[{"i":1,"q":8},{"i":3,"q":1}]}', items);
    expect(result?.lines).toHaveLength(2);
    expect(result?.lines[0]).toMatchObject({
      description: "Carpenter labour",
      quantityMilli: 8000,
      unitPriceCents: 9500,
    });
    expect(result?.lines[1].priceItemId).toBe(items[2].id);
  });

  it("accepts custom lines and flags ones without a price", () => {
    const result = parseAiReply(
      '{"lines":[{"d":"Skip bin","q":1,"p":450},{"d":"Council fee","q":1}]}',
      items,
    );
    expect(result?.lines[0].unitPriceCents).toBe(45000);
    expect(result?.notes[0]).toContain("Council fee");
  });

  it("rejects replies that aren't valid JSON in the expected shape", () => {
    expect(parseAiReply("I can't help with that", items)).toBeNull();
    expect(parseAiReply('{"lines":[{"q":-1}]}', items)).toBeNull();
  });
});

describe("keyword fallback", () => {
  it("finds items and quantities written before them", () => {
    const result = keywordDraft("8 hours carpenter labour, 12 m2 wall tiling and a vanity", items);
    const byName = Object.fromEntries(
      result.lines.map((line) => [line.description, line.quantityMilli]),
    );
    expect(byName["Carpenter labour"]).toBe(8000);
    expect(byName["Wall tiling"]).toBe(12000);
    expect(byName["Vanity unit 900mm"]).toBe(1000);
  });
});

describe("redaction", () => {
  it("removes known names, addresses, emails and phone numbers", () => {
    const text = redactPersonalDetails(
      "Bathroom for Jo Smith at 4 Bay St, call 0412 345 678 or jo@example.com",
      ["Jo Smith", "4 Bay St"],
    );
    expect(text).not.toContain("Jo Smith");
    expect(text).not.toContain("4 Bay St");
    expect(text).not.toContain("0412");
    expect(text).not.toContain("jo@example.com");
  });
});

describe("keyword fallback precision", () => {
  it("doesn't match an item on a shared generic word, and reads quantities before any matched word", () => {
    const withSheets: DraftPriceItem[] = [
      ...items,
      {
        id: "00000000-0000-4000-8000-000000000004",
        name: "Plasterboard sheet",
        unit: "each",
        priceCents: 4800,
        costCents: 2800,
        taxable: true,
      },
    ];
    const result = keywordDraft(
      "16 hours carpenter and 10 sheets of plasterboard for the laundry wall",
      withSheets,
    );
    const byName = Object.fromEntries(
      result.lines.map((line) => [line.description, line.quantityMilli]),
    );
    expect(byName["Wall tiling"]).toBeUndefined();
    expect(byName["Plasterboard sheet"]).toBe(10000);
    expect(byName["Carpenter labour"]).toBe(16000);
  });
});
