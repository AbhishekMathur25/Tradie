/**
 * End-to-end service tests against a real (in-memory) Postgres via PGlite:
 * quote → acceptance → contract → deposit and claims → payment matching.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { openPglite, type Db } from "@/db/client";
import { accountingSyncLog, businesses, invoices, jobs } from "@/db/schema";
import { createCustomer } from "@/services/directory";
import {
  createInvoiceDraft,
  createQuoteDraft,
  respondToQuote,
  sendInvoice,
  sendQuote,
  stageLine,
  updateInvoice,
} from "@/services/documents";
import { createJob, updateContract } from "@/services/jobs";
import { matchPayment, recordPaymentEvent } from "@/services/payments";
import type { ActorContext } from "@/services/support";

let db: Db;
let actor: ActorContext;
let jobId: string;

const today = "2026-10-22";
const line = (cents: number) => [stageLine("Bathroom renovation", cents)];

beforeAll(async () => {
  db = await openPglite(); // in memory, migrated
  const [business] = await db
    .insert(businesses)
    .values({ name: "Test Renos", licenceNumber: "123456C", licenseeName: "Test Renos Pty Ltd", email: "owner@test.example" })
    .returning();
  actor = { businessId: business.id, userId: null };
  const customer = await createCustomer(db, actor, {
    name: "Sam Customer",
    email: "sam@test.example",
    phone: "",
    address: "1 Test St",
    abn: "",
  });
  const job = await createJob(db, actor, {
    customerId: customer.id,
    title: "Bathroom",
    siteAddress: "1 Test St",
    residentialBuildingWork: true,
  });
  jobId = job.id;
});

describe("quote to paid", () => {
  it("numbers, sends and accepts a quote, marking the job won", async () => {
    // $30,000 ex GST = $33,000 incl. GST: needs a contract and insurance.
    const quote = await createQuoteDraft(db, actor, jobId, { lines: line(3_000_000), notes: "" });
    expect(quote.totalCents).toBe(3_300_000);
    const sent = await sendQuote(db, actor, quote.id, today);
    expect(sent.number).toBe("Q-0001");
    expect(sent.warnings.map((w) => w.ruleId)).toContain("written-contract");
    await respondToQuote(db, actor.businessId, quote.id, "accept", "Sam Customer");
    const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));
    expect(job.status).toBe("contracted");
  });

  it("blocks a deposit until the contract and insurance are recorded, then caps it at 10%", async () => {
    const deposit = await createInvoiceDraft(db, actor, jobId, {
      kind: "deposit",
      stageLabel: "Deposit",
      lines: line(300_000), // $3,300 incl. GST = 10% of $33,000
      notes: "",
      plannedOn: null,
    });
    await expect(sendInvoice(db, actor, deposit.id, today)).rejects.toThrow(/contract/i);

    await updateContract(db, actor, jobId, {
      contractPriceCents: 3_300_000,
      contractKind: "fair_trading",
      contractSignedOn: "2026-10-20",
      insuranceCertificateNumber: null,
      insuranceCertificateOn: null,
    });
    await expect(sendInvoice(db, actor, deposit.id, today)).rejects.toThrow(/insurance/i);

    await updateContract(db, actor, jobId, {
      contractPriceCents: 3_300_000,
      contractKind: "fair_trading",
      contractSignedOn: "2026-10-20",
      insuranceCertificateNumber: "HBCF-123",
      insuranceCertificateOn: "2026-10-21",
    });
    await updateInvoice(db, actor, deposit.id, deposit.version, {
      kind: "deposit",
      stageLabel: "Deposit",
      lines: line(300_001), // one cent over the cap once GST is added
      notes: "",
      plannedOn: null,
    });
    await expect(sendInvoice(db, actor, deposit.id, today)).rejects.toThrow(/10%/);

    await updateInvoice(db, actor, deposit.id, deposit.version + 1, {
      kind: "deposit",
      stageLabel: "Deposit",
      lines: line(300_000),
      notes: "",
      plannedOn: null,
    });
    const sent = await sendInvoice(db, actor, deposit.id, today);
    expect(sent.number).toBe("INV-0001");
  });

  it("rejects an edit based on an out-of-date version", async () => {
    const draft = await createInvoiceDraft(db, actor, jobId, {
      kind: "progress",
      stageLabel: "Waterproofing",
      lines: line(1_000_000),
      notes: "",
      plannedOn: "2026-10-30",
    });
    const input = { kind: "progress" as const, stageLabel: "Waterproofing", lines: line(900_000), notes: "", plannedOn: null };
    await updateInvoice(db, actor, draft.id, draft.version, input);
    await expect(updateInvoice(db, actor, draft.id, draft.version, input)).rejects.toThrow(/changed/);
  });

  it("matches a payment once, even if the provider sends it twice", async () => {
    const [deposit] = await db.select().from(invoices).where(eq(invoices.number, "INV-0001"));
    const event = {
      eventId: "evt-1",
      amountCents: deposit.totalCents,
      receivedAt: new Date().toISOString(),
      method: "payid" as const,
      payId: deposit.payId ?? undefined,
      reference: "",
      payerName: "Sam Customer",
      businessId: actor.businessId,
    };
    expect(await recordPaymentEvent(db, event)).toBe("matched");
    expect(await recordPaymentEvent(db, event)).toBe("duplicate");
    const [paid] = await db.select().from(invoices).where(eq(invoices.id, deposit.id));
    expect(paid.status).toBe("paid");
    expect(paid.paidCents).toBe(deposit.totalCents);
    // Paid invoices are locked for editing.
    await expect(
      updateInvoice(db, actor, deposit.id, paid.version, {
        kind: "deposit",
        stageLabel: "Deposit",
        lines: line(1),
        notes: "",
        plannedOn: null,
      }),
    ).rejects.toThrow(/credit note/);
  });

  it("keeps unmatched payments for the owner to match by hand", async () => {
    const draft = await createInvoiceDraft(db, actor, jobId, {
      kind: "progress",
      stageLabel: "Tiling",
      lines: line(500_000),
      notes: "",
      plannedOn: null,
    });
    const sent = await sendInvoice(db, actor, draft.id, today);
    expect(sent.number).toBe("INV-0002");
    const outcome = await recordPaymentEvent(db, {
      eventId: "evt-2",
      amountCents: 200_000,
      receivedAt: new Date().toISOString(),
      method: "bank",
      reference: "bathroom job",
      payerName: "S Customer",
      businessId: actor.businessId,
    });
    expect(outcome).toBe("unmatched");
    const { payments } = await import("@/db/schema");
    const [payment] = await db.select().from(payments).where(eq(payments.providerEventId, "evt-2"));
    await matchPayment(db, actor, payment.id, draft.id);
    await expect(matchPayment(db, actor, payment.id, draft.id)).rejects.toThrow(/already matched/);
    const [partPaid] = await db.select().from(invoices).where(eq(invoices.id, draft.id));
    expect(partPaid.status).toBe("sent");
    expect(partPaid.paidCents).toBe(200_000);
    const log = await db.select().from(accountingSyncLog);
    expect(log.length).toBeGreaterThanOrEqual(4); // 2 invoices + 2 payments, no duplicates
  });
});
