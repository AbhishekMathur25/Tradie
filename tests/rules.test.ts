import { describe, expect, it } from "vitest";
import {
  checkInvoiceSend,
  checkQuoteSend,
  coolingOffEnds,
  isBlocked,
  type BusinessFacts,
  type JobFacts,
} from "@/domain/rules";

const business: BusinessFacts = {
  licenceNumber: "123456C",
  licenseeName: "Harbour Renos Pty Ltd",
  gstRegistered: true,
};
const customer = { name: "A. Customer", abn: "" };

const job = (overrides: Partial<JobFacts> = {}): JobFacts => ({
  residentialBuildingWork: true,
  contractPriceCents: 3_250_000,
  contractSignedOn: "2026-10-01",
  insuranceCertificateNumber: "HBCF-1",
  acceptedQuoteTotalCents: null,
  approvedVariationsCents: 0,
  ...overrides,
});

const ruleIds = (results: { ruleId: string; severity: string }[], severity = "block") =>
  results.filter((r) => r.severity === severity).map((r) => r.ruleId);

describe("NSW rule checks", () => {
  it("blocks sending without licence details on residential work", () => {
    const results = checkQuoteSend({
      business: { ...business, licenceNumber: "" },
      job: job(),
      quoteTotalCents: 100_000,
    });
    expect(ruleIds(results)).toContain("licence-details");
  });

  it("does not need licence details for non-residential work", () => {
    const results = checkQuoteSend({
      business: { ...business, licenceNumber: "" },
      job: job({ residentialBuildingWork: false }),
      quoteTotalCents: 100_000,
    });
    expect(isBlocked(results)).toBe(false);
  });

  it("warns that quotes over $5,000 need a written contract", () => {
    const results = checkQuoteSend({ business, job: job(), quoteTotalCents: 600_000 });
    expect(ruleIds(results, "warn")).toContain("written-contract");
  });

  it("blocks a deposit over 10% of the contract price", () => {
    const base = { business, customer, job: job(), otherInvoices: [] };
    const ok = checkInvoiceSend({ ...base, invoice: { kind: "deposit", totalCents: 325_000 } });
    expect(isBlocked(ok)).toBe(false);
    const tooBig = checkInvoiceSend({ ...base, invoice: { kind: "deposit", totalCents: 325_001 } });
    expect(ruleIds(tooBig)).toContain("deposit-cap");
  });

  it("counts earlier deposits toward the 10% cap", () => {
    const results = checkInvoiceSend({
      business,
      customer,
      job: job(),
      invoice: { kind: "deposit", totalCents: 200_000 },
      otherInvoices: [{ kind: "deposit", totalCents: 200_000 }],
    });
    expect(ruleIds(results)).toContain("deposit-cap");
  });

  it("blocks payment requests over $20,000 until the insurance certificate is recorded", () => {
    const results = checkInvoiceSend({
      business,
      customer,
      job: job({ contractPriceCents: 9_600_000, insuranceCertificateNumber: null }),
      invoice: { kind: "deposit", totalCents: 500_000 },
      otherInvoices: [],
    });
    expect(ruleIds(results)).toContain("insurance-before-payment");
  });

  it("blocks payment requests over $5,000 until the contract is recorded", () => {
    const results = checkInvoiceSend({
      business,
      customer,
      job: job({
        contractPriceCents: null,
        contractSignedOn: null,
        acceptedQuoteTotalCents: 800_000,
      }),
      invoice: { kind: "standard", totalCents: 100_000 },
      otherInvoices: [],
    });
    expect(ruleIds(results)).toContain("written-contract");
  });

  it("blocks claims beyond the contract plus approved variations", () => {
    const results = checkInvoiceSend({
      business,
      customer,
      job: job({ contractPriceCents: 1_000_000, approvedVariationsCents: 100_000 }),
      invoice: { kind: "progress", totalCents: 600_001 },
      otherInvoices: [{ kind: "progress", totalCents: 500_000 }],
    });
    expect(ruleIds(results)).toContain("claims-within-contract");
  });

  it("requires the buyer's name or ABN on tax invoices of $1,000 or more", () => {
    const results = checkInvoiceSend({
      business,
      customer: { name: " ", abn: "" },
      job: job({ residentialBuildingWork: false, contractPriceCents: null }),
      invoice: { kind: "standard", totalCents: 100_000 },
      otherInvoices: [],
    });
    expect(ruleIds(results)).toContain("buyer-identity");
  });

  it("works out the cooling-off date skipping weekends", () => {
    // Thursday 1 Oct 2026 + 5 business days = Thursday 8 Oct 2026
    expect(coolingOffEnds("2026-10-01")).toBe("2026-10-08");
  });
});
