import { describe, expect, it } from "vitest";
import { buildDashboard, type DashboardInput, type DashInvoice } from "@/domain/dashboard";

const invoice = (overrides: Partial<DashInvoice>): DashInvoice => ({
  id: "inv",
  jobId: "job-1",
  number: "INV-0001",
  kind: "progress",
  stageLabel: "",
  status: "sent",
  totalCents: 0,
  gstCents: 0,
  paidCents: 0,
  sentOn: "2026-10-01",
  dueOn: "2026-10-15",
  plannedOn: null,
  ...overrides,
});

const base: DashboardInput = {
  today: "2026-10-22",
  gstRegistered: true,
  jobs: [
    {
      id: "job-1",
      title: "Kitchen · Ryde",
      customerName: "Lee",
      status: "in_progress",
      residentialBuildingWork: true,
      contractPriceCents: 4_800_000,
      contractSignedOn: "2026-09-01",
      insuranceCertificateNumber: "HBCF-1",
      completedOn: null,
    },
    {
      id: "job-2",
      title: "Extension · Penrith",
      customerName: "Park",
      status: "contracted",
      residentialBuildingWork: true,
      contractPriceCents: 9_600_000,
      contractSignedOn: "2026-10-10",
      insuranceCertificateNumber: null,
      completedOn: null,
    },
  ],
  quotes: [
    {
      id: "q1",
      jobId: "job-1",
      status: "accepted",
      subtotalCents: 100_000,
      costCents: 73_000,
      totalCents: 110_000,
      sentOn: "2026-08-20",
      acceptedOn: "2026-08-25",
    },
  ],
  variations: [
    {
      id: "v1",
      jobId: "job-1",
      number: "V1",
      status: "approved",
      totalCents: 210_000,
      sentOn: "2026-09-10",
    },
    {
      id: "v2",
      jobId: "job-1",
      number: "V2",
      status: "sent",
      totalCents: 185_000,
      sentOn: "2026-10-13",
    },
  ],
  invoices: [
    invoice({
      id: "a",
      totalCents: 1_000_000,
      gstCents: 90_909,
      paidCents: 1_000_000,
      status: "paid",
      sentOn: "2026-10-02",
      dueOn: "2026-10-16",
    }),
    invoice({ id: "b", totalCents: 425_000, gstCents: 38_636, paidCents: 0, dueOn: "2026-10-10" }),
    invoice({
      id: "c",
      totalCents: 300_000,
      paidCents: 100_000,
      dueOn: "2026-11-05",
      sentOn: "2026-10-20",
    }),
    invoice({
      id: "d",
      status: "draft",
      totalCents: 1_240_000,
      sentOn: null,
      dueOn: null,
      plannedOn: "2026-10-24",
      stageLabel: "Cabinets installed",
    }),
  ],
  payments: [
    { invoiceId: "a", amountCents: 1_000_000, receivedOn: "2026-10-12" },
    { invoiceId: "c", amountCents: 100_000, receivedOn: "2026-10-21" },
    { invoiceId: null, amountCents: 330_000, receivedOn: "2026-10-21" },
  ],
};

describe("owner dashboard", () => {
  const dash = buildDashboard(base);

  it("adds up what is owed and what is overdue", () => {
    expect(dash.owed.totalCents).toBe(425_000 + 200_000);
    expect(dash.owed.overdueCents).toBe(425_000);
    expect(dash.overdueBuckets.days1to30).toBe(425_000);
  });

  it("forecasts money coming in from due invoices and planned claims", () => {
    expect(dash.comingIn30.totalCents).toBe(200_000 + 1_240_000);
    expect(dash.comingIn30.plannedClaimCount).toBe(1);
  });

  it("counts payments received this month, matched or not", () => {
    expect(dash.receivedThisMonthCents).toBe(1_430_000);
  });

  it("reports the GST shown on invoices sent this quarter", () => {
    expect(dash.gstOnInvoicesThisQuarter.cents).toBe(90_909 + 38_636);
    expect(dash.gstOnInvoicesThisQuarter.label).toContain("Oct");
  });

  it("shows each job's contract position including approved variations", () => {
    const kitchen = dash.jobPositions.find((p) => p.jobId === "job-1")!;
    expect(kitchen.contractCents).toBe(4_800_000 + 210_000);
    expect(kitchen.claimedCents).toBe(1_725_000);
    expect(kitchen.paidCents).toBe(1_100_000);
    expect(kitchen.pendingVariationsCents).toBe(185_000);
    expect(kitchen.quotedMarginPercent).toBe(27);
  });

  it("lists blocked jobs, claims to send, overdue invoices, unsigned variations and unmatched payments", () => {
    const titles = dash.needsYou.map((item) => item.title);
    expect(dash.needsYou[0].severity).toBe("block");
    expect(titles.some((t) => t.includes("Extension · Penrith"))).toBe(true);
    expect(titles.some((t) => t.includes("Cabinets installed"))).toBe(true);
    expect(titles.some((t) => t.includes("overdue"))).toBe(true);
    expect(titles.some((t) => t.startsWith("Variation V2"))).toBe(true);
    expect(titles.some((t) => t.includes("payment to match"))).toBe(true);
  });

  it("never shows GST figures for a business that isn't registered", () => {
    expect(buildDashboard({ ...base, gstRegistered: false }).gstOnInvoicesThisQuarter.cents).toBe(
      0,
    );
  });
});
