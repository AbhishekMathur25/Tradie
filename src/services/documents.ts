/**
 * Quotes, variations and invoices (deposits, progress claims, final and
 * standard invoices). Sending is where the NSW rule checks run, the number is
 * issued, the customer link is created and the email is queued, all in one
 * transaction so a failure leaves nothing half-sent.
 */
import { randomInt } from "node:crypto";
import { and, desc, eq, ne } from "drizzle-orm";
import { z } from "zod";
import type { Db, DbOrTx } from "@/db/client";
import {
  customers,
  invoices,
  jobs,
  quotes,
  variations,
  INVOICE_KINDS,
  type Business,
  type Customer,
  type Invoice,
} from "@/db/schema";
import { addDays } from "@/domain/dates";
import { documentTotals, formatCents, gstOn, lineSchema, type Line } from "@/domain/money";
import {
  checkInvoiceSend,
  checkQuoteSend,
  checkVariationSend,
  isBlocked,
  type RuleResult,
} from "@/domain/rules";
import { StaleRecordError, UserFacingError } from "@/lib/errors";
import { getBusiness } from "./directory";
import { getJob, loadJobFacts, touchJob } from "./jobs";
import {
  audit,
  customerUrl,
  issueNumber,
  linkFor,
  pushToAccounting,
  queueEmail,
  type ActorContext,
} from "./support";

export const linesSchema = z.array(lineSchema).min(1, "Add at least one line").max(100);

function blockMessage(results: RuleResult[]): string {
  return results
    .filter((result) => result.severity === "block")
    .map((result) => result.message)
    .join(" ");
}

// =============================================================================
// Quotes
// =============================================================================

export const quoteInputSchema = z.object({
  lines: linesSchema,
  notes: z.string().trim().max(2000),
});

export async function createQuoteDraft(
  db: Db,
  actor: ActorContext,
  jobId: string,
  input: z.infer<typeof quoteInputSchema>,
) {
  const job = await getJob(db, actor.businessId, jobId);
  const business = await getBusiness(db, actor.businessId);
  const totals = documentTotals(input.lines, business.gstRegistered);
  const [row] = await db
    .insert(quotes)
    .values({
      businessId: actor.businessId,
      jobId: job.id,
      lines: input.lines,
      notes: input.notes,
      ...totals,
    })
    .returning();
  await audit(db, actor, "quote.created", "quote", row.id);
  await touchJob(db, job.id);
  return row;
}

export async function getQuote(db: DbOrTx, businessId: string, quoteId: string) {
  const [row] = await db
    .select()
    .from(quotes)
    .where(and(eq(quotes.id, quoteId), eq(quotes.businessId, businessId)))
    .limit(1);
  if (!row) throw new UserFacingError("Quote not found.");
  return row;
}

export async function updateQuoteDraft(
  db: Db,
  actor: ActorContext,
  quoteId: string,
  version: number,
  input: z.infer<typeof quoteInputSchema>,
): Promise<void> {
  const quote = await getQuote(db, actor.businessId, quoteId);
  if (quote.status !== "draft") throw new UserFacingError("Only draft quotes can be edited.");
  const business = await getBusiness(db, actor.businessId);
  const totals = documentTotals(input.lines, business.gstRegistered);
  const updated = await db
    .update(quotes)
    .set({
      lines: input.lines,
      notes: input.notes,
      ...totals,
      version: version + 1,
      updatedAt: new Date(),
    })
    .where(and(eq(quotes.id, quote.id), eq(quotes.version, version)))
    .returning({ id: quotes.id });
  if (updated.length === 0) throw new StaleRecordError();
  await audit(db, actor, "quote.updated", "quote", quote.id);
}

/** Rule check results for a quote, so the page can show them before sending. */
export async function quoteChecks(
  db: Db,
  businessId: string,
  quoteId: string,
): Promise<RuleResult[]> {
  const quote = await getQuote(db, businessId, quoteId);
  const business = await getBusiness(db, businessId);
  const { facts } = await loadJobFacts(db, businessId, quote.jobId);
  return checkQuoteSend({ business, job: facts, quoteTotalCents: quote.totalCents });
}

export async function sendQuote(db: Db, actor: ActorContext, quoteId: string, today: string) {
  return db.transaction(async (tx) => {
    const quote = await getQuote(tx, actor.businessId, quoteId);
    if (quote.status !== "draft") throw new UserFacingError("This quote has already been sent.");
    const business = await getBusiness(tx, actor.businessId);
    const { facts, customer, job } = await loadJobFacts(tx, actor.businessId, quote.jobId);
    const results = checkQuoteSend({ business, job: facts, quoteTotalCents: quote.totalCents });
    if (isBlocked(results)) throw new UserFacingError(blockMessage(results));

    const number = await issueNumber(tx, actor.businessId, "quote");
    await tx
      .update(quotes)
      .set({
        status: "sent",
        number,
        sentAt: new Date(),
        validUntil: addDays(today, 30),
        updatedAt: new Date(),
      })
      .where(eq(quotes.id, quote.id));
    const token = await linkFor(tx, actor.businessId, "quote", quote.id);
    await queueEmail(tx, {
      businessId: actor.businessId,
      to: customer.email,
      kind: "document",
      subject: `Quote ${number} from ${business.name}: ${job.title}`,
      body:
        `Hi ${customer.name},\n\nHere is quote ${number} for ${job.title} ` +
        `(${formatCents(quote.totalCents)} incl. GST).\n\nView and accept it here:\n${customerUrl(token)}\n\n${business.name}`,
    });
    await audit(tx, actor, "quote.sent", "quote", quote.id, { number });
    await touchJob(tx, job.id);
    return { number, warnings: results };
  });
}

/** A customer accepts or declines a quote through their link. */
export async function respondToQuote(
  db: Db,
  businessId: string,
  quoteId: string,
  decision: "accept" | "decline",
  customerName: string,
) {
  return db.transaction(async (tx) => {
    const quote = await getQuote(tx, businessId, quoteId);
    if (quote.status !== "sent") throw new UserFacingError("This quote can no longer be changed.");
    const accepted = decision === "accept";
    await tx
      .update(quotes)
      .set({
        status: accepted ? "accepted" : "declined",
        acceptedAt: accepted ? new Date() : null,
        acceptedByName: accepted ? customerName : null,
        updatedAt: new Date(),
      })
      .where(eq(quotes.id, quote.id));
    if (accepted) {
      // A won job moves out of quoting; the dashboard flags any missing contract.
      await tx
        .update(jobs)
        .set({ status: "contracted", updatedAt: new Date() })
        .where(and(eq(jobs.id, quote.jobId), eq(jobs.status, "quoting")));
    }
    const business = await getBusiness(tx, businessId);
    await queueEmail(tx, {
      businessId,
      to: business.email,
      kind: "document",
      subject: `Quote ${quote.number} ${accepted ? "accepted" : "declined"}`,
      body: `${customerName} ${accepted ? "accepted" : "declined"} quote ${quote.number} (${formatCents(quote.totalCents)}).`,
    });
    await audit(
      tx,
      { businessId, userId: null },
      `quote.${accepted ? "accepted" : "declined"}`,
      "quote",
      quote.id,
      {
        name: customerName,
      },
    );
  });
}

// =============================================================================
// Variations
// =============================================================================

export const variationInputSchema = z.object({
  description: z.string().trim().min(1, "Describe the variation").max(1000),
  amountCents: z.number().int().positive("Enter the variation amount"),
});

export async function createVariation(
  db: Db,
  actor: ActorContext,
  jobId: string,
  input: z.infer<typeof variationInputSchema>,
) {
  const job = await getJob(db, actor.businessId, jobId);
  const business = await getBusiness(db, actor.businessId);
  const gstCents = business.gstRegistered ? gstOn(input.amountCents) : 0;
  const [row] = await db
    .insert(variations)
    .values({
      businessId: actor.businessId,
      jobId: job.id,
      description: input.description,
      amountCents: input.amountCents,
      gstCents,
      totalCents: input.amountCents + gstCents,
    })
    .returning();
  await audit(db, actor, "variation.created", "variation", row.id);
  await touchJob(db, job.id);
  return row;
}

export async function getVariation(db: DbOrTx, businessId: string, variationId: string) {
  const [row] = await db
    .select()
    .from(variations)
    .where(and(eq(variations.id, variationId), eq(variations.businessId, businessId)))
    .limit(1);
  if (!row) throw new UserFacingError("Variation not found.");
  return row;
}

export async function sendVariation(db: Db, actor: ActorContext, variationId: string) {
  return db.transaction(async (tx) => {
    const variation = await getVariation(tx, actor.businessId, variationId);
    if (variation.status !== "draft")
      throw new UserFacingError("This variation has already been sent.");
    const business = await getBusiness(tx, actor.businessId);
    const { facts, customer, job } = await loadJobFacts(tx, actor.businessId, variation.jobId);
    const results = checkVariationSend({ business, job: facts });
    if (isBlocked(results)) throw new UserFacingError(blockMessage(results));

    const number = await issueNumber(tx, actor.businessId, "variation");
    await tx
      .update(variations)
      .set({ status: "sent", number, sentAt: new Date(), updatedAt: new Date() })
      .where(eq(variations.id, variation.id));
    const token = await linkFor(tx, actor.businessId, "variation", variation.id);
    await queueEmail(tx, {
      businessId: actor.businessId,
      to: customer.email,
      kind: "document",
      subject: `Variation ${number} for ${job.title}: please review`,
      body:
        `Hi ${customer.name},\n\nWe need your sign-off on variation ${number}: ${variation.description} ` +
        `(${formatCents(variation.totalCents)} incl. GST).\n\nReview it here:\n${customerUrl(token)}\n\n${business.name}`,
    });
    await audit(tx, actor, "variation.sent", "variation", variation.id, { number });
    await touchJob(tx, job.id);
    return { number };
  });
}

export async function respondToVariation(
  db: Db,
  businessId: string,
  variationId: string,
  decision: "approve" | "decline",
  customerName: string,
) {
  await db.transaction(async (tx) => {
    const variation = await getVariation(tx, businessId, variationId);
    if (variation.status !== "sent")
      throw new UserFacingError("This variation can no longer be changed.");
    const approved = decision === "approve";
    await tx
      .update(variations)
      .set({
        status: approved ? "approved" : "declined",
        approvedAt: approved ? new Date() : null,
        approvedByName: approved ? customerName : null,
        updatedAt: new Date(),
      })
      .where(eq(variations.id, variation.id));
    await audit(
      tx,
      { businessId, userId: null },
      `variation.${approved ? "approved" : "declined"}`,
      "variation",
      variation.id,
      {
        name: customerName,
      },
    );
  });
}

// =============================================================================
// Invoices and claims
// =============================================================================

export const invoiceInputSchema = z.object({
  kind: z.enum(INVOICE_KINDS),
  stageLabel: z.string().trim().max(120),
  lines: linesSchema,
  notes: z.string().trim().max(2000),
  plannedOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
});

export async function getInvoice(
  db: DbOrTx,
  businessId: string,
  invoiceId: string,
): Promise<Invoice> {
  const [row] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.businessId, businessId)))
    .limit(1);
  if (!row) throw new UserFacingError("Invoice not found.");
  return row;
}

export async function createInvoiceDraft(
  db: Db,
  actor: ActorContext,
  jobId: string,
  input: z.infer<typeof invoiceInputSchema>,
) {
  const job = await getJob(db, actor.businessId, jobId);
  const business = await getBusiness(db, actor.businessId);
  const totals = documentTotals(input.lines, business.gstRegistered);
  const [row] = await db
    .insert(invoices)
    .values({
      businessId: actor.businessId,
      jobId: job.id,
      kind: input.kind,
      stageLabel: input.stageLabel,
      lines: input.lines,
      notes: input.notes,
      plannedOn: input.plannedOn,
      taxInvoice: business.gstRegistered,
      subtotalCents: totals.subtotalCents,
      gstCents: totals.gstCents,
      totalCents: totals.totalCents,
    })
    .returning();
  await audit(db, actor, "invoice.created", "invoice", row.id, { kind: input.kind });
  await touchJob(db, job.id);
  return row;
}

/** Runs the NSW checks for an invoice as if it were sent with these totals. */
async function invoiceRuleResults(
  db: DbOrTx,
  business: Business,
  invoice: Pick<Invoice, "id" | "jobId" | "kind">,
  totalCents: number,
): Promise<{ results: RuleResult[]; customer: Customer }> {
  const {
    facts,
    customer,
    invoices: jobInvoices,
  } = await loadJobFacts(db, business.id, invoice.jobId);
  const otherInvoices = jobInvoices
    .filter(
      (other) => other.id !== invoice.id && (other.status === "sent" || other.status === "paid"),
    )
    .map((other) => ({ kind: other.kind, totalCents: other.totalCents }));
  const results = checkInvoiceSend({
    business,
    job: facts,
    customer,
    invoice: { kind: invoice.kind, totalCents },
    otherInvoices,
  });
  return { results, customer };
}

export async function invoiceChecks(
  db: Db,
  businessId: string,
  invoiceId: string,
): Promise<RuleResult[]> {
  const invoice = await getInvoice(db, businessId, invoiceId);
  const business = await getBusiness(db, businessId);
  const totals = documentTotals(invoice.lines, business.gstRegistered);
  return (await invoiceRuleResults(db, business, invoice, totals.totalCents)).results;
}

/**
 * Edits an invoice. Drafts can always be edited. A sent invoice can be edited
 * until a payment is recorded; after that, changes need a credit note.
 */
export async function updateInvoice(
  db: Db,
  actor: ActorContext,
  invoiceId: string,
  version: number,
  input: z.infer<typeof invoiceInputSchema>,
): Promise<void> {
  await db.transaction(async (tx) => {
    const invoice = await getInvoice(tx, actor.businessId, invoiceId);
    if (invoice.status === "void") throw new UserFacingError("This invoice has been voided.");
    if (invoice.paidCents > 0) {
      throw new UserFacingError(
        "A payment has been recorded, so this invoice can't be edited. Changes need a credit note.",
      );
    }
    const business = await getBusiness(tx, actor.businessId);
    // A sent invoice keeps the GST treatment it was issued with.
    const gst = invoice.status === "draft" ? business.gstRegistered : invoice.taxInvoice;
    const totals = documentTotals(input.lines, gst);
    const isSent = invoice.status === "sent";
    if (isSent) {
      const { results } = await invoiceRuleResults(
        tx,
        business,
        { ...invoice, kind: input.kind },
        totals.totalCents,
      );
      if (isBlocked(results)) throw new UserFacingError(blockMessage(results));
    }
    const updated = await tx
      .update(invoices)
      .set({
        kind: isSent ? invoice.kind : input.kind, // the kind is fixed once sent
        stageLabel: input.stageLabel,
        lines: input.lines,
        notes: input.notes,
        plannedOn: input.plannedOn,
        subtotalCents: totals.subtotalCents,
        gstCents: totals.gstCents,
        totalCents: totals.totalCents,
        version: version + 1,
        updatedAt: new Date(),
      })
      .where(and(eq(invoices.id, invoice.id), eq(invoices.version, version)))
      .returning({ id: invoices.id });
    if (updated.length === 0) throw new StaleRecordError();
    if (isSent) {
      await pushToAccounting(tx, {
        businessId: actor.businessId,
        entityType: "invoice",
        entityId: invoice.id,
        idempotencyKey: `invoice:${invoice.id}:v${version + 1}`,
        detail: { action: "update", number: invoice.number, totalCents: totals.totalCents },
      });
    }
    await audit(tx, actor, "invoice.updated", "invoice", invoice.id, { sent: isSent });
  });
}

/** Short, unambiguous payment reference customers type into their bank app. */
function newPaymentReference(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let reference = "T";
  for (let i = 0; i < 8; i += 1) reference += alphabet[randomInt(alphabet.length)];
  return reference;
}

export async function sendInvoice(db: Db, actor: ActorContext, invoiceId: string, today: string) {
  return db.transaction(async (tx) => {
    const invoice = await getInvoice(tx, actor.businessId, invoiceId);
    if (invoice.status !== "draft")
      throw new UserFacingError("This invoice has already been sent.");
    const business = await getBusiness(tx, actor.businessId);
    // Totals are recalculated with the GST registration at the moment of sending.
    const totals = documentTotals(invoice.lines, business.gstRegistered);
    const { results, customer } = await invoiceRuleResults(
      tx,
      business,
      invoice,
      totals.totalCents,
    );
    if (isBlocked(results)) throw new UserFacingError(blockMessage(results));

    const number = await issueNumber(tx, actor.businessId, "invoice");
    const reference = newPaymentReference();
    // Simulated PayID: a real provider issues one PayID per invoice.
    const payId = `${reference.toLowerCase()}@pay.tradie.test`;
    const dueOn = addDays(today, business.paymentTermsDays);
    await tx
      .update(invoices)
      .set({
        status: "sent",
        number,
        taxInvoice: business.gstRegistered,
        subtotalCents: totals.subtotalCents,
        gstCents: totals.gstCents,
        totalCents: totals.totalCents,
        sentAt: new Date(),
        dueOn,
        plannedOn: null,
        payId,
        paymentReference: reference,
        updatedAt: new Date(),
      })
      .where(eq(invoices.id, invoice.id));

    const job = await getJob(tx, actor.businessId, invoice.jobId);
    if (job.status === "contracted") {
      await tx
        .update(jobs)
        .set({ status: "in_progress", updatedAt: new Date() })
        .where(eq(jobs.id, job.id));
    }
    const token = await linkFor(tx, actor.businessId, "invoice", invoice.id);
    const title = business.gstRegistered ? "Tax invoice" : "Invoice";
    await queueEmail(tx, {
      businessId: actor.businessId,
      to: customer.email,
      kind: "document",
      subject: `${title} ${number} from ${business.name}: ${formatCents(totals.totalCents)} due ${dueOn}`,
      body:
        `Hi ${customer.name},\n\n${title} ${number} for ${job.title}` +
        `${invoice.stageLabel ? ` (${invoice.stageLabel})` : ""} is ${formatCents(totals.totalCents)}, due ${dueOn}.\n\n` +
        `Pay by PayID: ${payId}\nReference: ${reference}\n\nView or pay online:\n${customerUrl(token)}\n\n${business.name}`,
    });
    await pushToAccounting(tx, {
      businessId: actor.businessId,
      entityType: "invoice",
      entityId: invoice.id,
      idempotencyKey: `invoice:${invoice.id}:v${invoice.version}`,
      detail: {
        action: "create",
        number,
        totalCents: totals.totalCents,
        gstCents: totals.gstCents,
        dueOn,
      },
    });
    await audit(tx, actor, "invoice.sent", "invoice", invoice.id, {
      number,
      totalCents: totals.totalCents,
    });
    await touchJob(tx, job.id);
    return { number, warnings: results };
  });
}

export async function voidInvoice(db: Db, actor: ActorContext, invoiceId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const invoice = await getInvoice(tx, actor.businessId, invoiceId);
    if (invoice.paidCents > 0)
      throw new UserFacingError("Invoices with payments can't be voided. Use a credit note.");
    if (invoice.status === "void") return;
    await tx
      .update(invoices)
      .set({ status: "void", updatedAt: new Date() })
      .where(eq(invoices.id, invoice.id));
    if (invoice.number) {
      await pushToAccounting(tx, {
        businessId: actor.businessId,
        entityType: "invoice",
        entityId: invoice.id,
        idempotencyKey: `invoice:${invoice.id}:void`,
        detail: { action: "void", number: invoice.number },
      });
    }
    await audit(tx, actor, "invoice.voided", "invoice", invoice.id);
  });
}

export async function sendReminder(db: Db, actor: ActorContext, invoiceId: string): Promise<void> {
  const invoice = await getInvoice(db, actor.businessId, invoiceId);
  const outstanding = invoice.totalCents - invoice.paidCents;
  if (invoice.status !== "sent" || outstanding <= 0) {
    throw new UserFacingError("Only unpaid sent invoices need a reminder.");
  }
  const business = await getBusiness(db, actor.businessId);
  const [row] = await db
    .select({ customer: customers, job: jobs })
    .from(jobs)
    .innerJoin(customers, eq(customers.id, jobs.customerId))
    .where(eq(jobs.id, invoice.jobId));
  const token = await linkFor(db, actor.businessId, "invoice", invoice.id);
  await queueEmail(db, {
    businessId: actor.businessId,
    to: row.customer.email,
    kind: "reminder",
    subject: `Reminder: invoice ${invoice.number} (${formatCents(outstanding)})`,
    body:
      `Hi ${row.customer.name},\n\nA friendly reminder that invoice ${invoice.number} for ${row.job.title} ` +
      `has ${formatCents(outstanding)} outstanding, due ${invoice.dueOn}.\n\n` +
      `Pay by PayID: ${invoice.payId}\nReference: ${invoice.paymentReference}\n\n${customerUrl(token)}\n\n${business.name}`,
  });
  await audit(db, actor, "invoice.reminder_sent", "invoice", invoice.id);
}

export async function listInvoices(db: DbOrTx, businessId: string) {
  return db
    .select({ invoice: invoices, jobTitle: jobs.title, customerName: customers.name })
    .from(invoices)
    .innerJoin(jobs, eq(jobs.id, invoices.jobId))
    .innerJoin(customers, eq(customers.id, jobs.customerId))
    .where(and(eq(invoices.businessId, businessId), ne(invoices.status, "void")))
    .orderBy(desc(invoices.createdAt));
}

/** Lines that start a claim: one line for a stage amount, GST-exclusive. */
export function stageLine(description: string, amountExGstCents: number): Line {
  return {
    description,
    quantityMilli: 1000,
    unitPriceCents: amountExGstCents,
    unitCostCents: 0,
    taxable: true,
    priceItemId: null,
  };
}
