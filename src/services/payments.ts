/**
 * Incoming payments. A payments provider (simulated in the prototype) tells
 * us about each payment; we match it to an invoice by its reference or PayID.
 *
 * Safety properties:
 * - Each provider event is processed once (unique providerEventId).
 * - Unmatched payments are kept and listed for the owner to match by hand.
 * - Matching and the invoice's paid amount change in one transaction.
 */
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db, DbOrTx } from "@/db/client";
import { customers, invoices, jobs, payments } from "@/db/schema";
import { UserFacingError } from "@/lib/errors";
import { audit, pushToAccounting, type ActorContext } from "./support";

export const paymentEventSchema = z.object({
  eventId: z.string().min(1).max(200),
  amountCents: z.number().int().positive(),
  receivedAt: z.string().datetime(),
  method: z.enum(["payid", "bank", "card"]),
  /** Where the money was sent (the invoice's PayID), if known. */
  payId: z.string().max(200).optional(),
  /** What the payer typed as the reference. */
  reference: z.string().max(200).default(""),
  payerName: z.string().max(200).default(""),
  /** The business account the provider credited. */
  businessId: z.string().uuid(),
});

export type PaymentEvent = z.infer<typeof paymentEventSchema>;

/** Finds the invoice a payment belongs to, if the reference or PayID matches. */
async function findInvoiceFor(db: DbOrTx, event: PaymentEvent) {
  const reference = event.reference.trim().toUpperCase().replace(/\s+/g, "");
  const conditions = [];
  if (event.payId) conditions.push(eq(invoices.payId, event.payId.trim().toLowerCase()));
  if (reference) conditions.push(eq(invoices.paymentReference, reference));
  if (conditions.length === 0) return null;
  const [row] = await db
    .select()
    .from(invoices)
    .where(
      and(
        eq(invoices.businessId, event.businessId),
        eq(invoices.status, "sent"),
        or(...conditions),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Adds a payment to an invoice and marks it paid when fully covered. */
async function applyToInvoice(db: DbOrTx, invoiceId: string, amountCents: number) {
  const [updated] = await db
    .update(invoices)
    .set({
      paidCents: sql`${invoices.paidCents} + ${amountCents}`,
      status: sql`CASE WHEN ${invoices.paidCents} + ${amountCents} >= ${invoices.totalCents} THEN 'paid' ELSE ${invoices.status} END`,
      updatedAt: new Date(),
    })
    .where(eq(invoices.id, invoiceId))
    .returning();
  return updated;
}

export type PaymentOutcome = "matched" | "unmatched" | "duplicate";

/** Handles one payment notification. Safe to call again with the same event. */
export async function recordPaymentEvent(db: Db, event: PaymentEvent): Promise<PaymentOutcome> {
  return db.transaction(async (tx) => {
    const invoice = await findInvoiceFor(tx, event);
    const inserted = await tx
      .insert(payments)
      .values({
        businessId: event.businessId,
        invoiceId: invoice?.id ?? null,
        amountCents: event.amountCents,
        receivedAt: new Date(event.receivedAt),
        method: event.method,
        providerEventId: event.eventId,
        payerName: event.payerName,
        reference: event.reference,
      })
      .onConflictDoNothing({ target: payments.providerEventId })
      .returning({ id: payments.id });
    if (inserted.length === 0) return "duplicate";

    const actor = { businessId: event.businessId, userId: null };
    const paymentId = inserted[0].id;
    if (!invoice) {
      await audit(tx, actor, "payment.unmatched", "payment", paymentId, {
        amountCents: event.amountCents,
      });
      return "unmatched";
    }
    await applyToInvoice(tx, invoice.id, event.amountCents);
    await pushToAccounting(tx, {
      businessId: event.businessId,
      entityType: "payment",
      entityId: paymentId,
      idempotencyKey: `payment:${paymentId}`,
      detail: { invoiceNumber: invoice.number, amountCents: event.amountCents },
    });
    await audit(tx, actor, "payment.matched", "payment", paymentId, { invoiceId: invoice.id });
    return "matched";
  });
}

/** The owner matches an unmatched payment to an invoice by hand. */
export async function matchPayment(
  db: Db,
  actor: ActorContext,
  paymentId: string,
  invoiceId: string,
) {
  await db.transaction(async (tx) => {
    const [payment] = await tx
      .select()
      .from(payments)
      .where(and(eq(payments.id, paymentId), eq(payments.businessId, actor.businessId)))
      .limit(1);
    if (!payment) throw new UserFacingError("Payment not found.");
    if (payment.invoiceId) throw new UserFacingError("This payment is already matched.");
    const [invoice] = await tx
      .select()
      .from(invoices)
      .where(
        and(
          eq(invoices.id, invoiceId),
          eq(invoices.businessId, actor.businessId),
          eq(invoices.status, "sent"),
        ),
      )
      .limit(1);
    if (!invoice) throw new UserFacingError("Choose an unpaid sent invoice.");

    // Guard against a double click matching the same payment twice.
    const claimed = await tx
      .update(payments)
      .set({ invoiceId: invoice.id })
      .where(and(eq(payments.id, payment.id), isNull(payments.invoiceId)))
      .returning({ id: payments.id });
    if (claimed.length === 0) throw new UserFacingError("This payment is already matched.");

    await applyToInvoice(tx, invoice.id, payment.amountCents);
    await pushToAccounting(tx, {
      businessId: actor.businessId,
      entityType: "payment",
      entityId: payment.id,
      idempotencyKey: `payment:${payment.id}`,
      detail: {
        invoiceNumber: invoice.number,
        amountCents: payment.amountCents,
        matchedBy: "owner",
      },
    });
    await audit(tx, actor, "payment.matched_manually", "payment", payment.id, {
      invoiceId: invoice.id,
    });
  });
}

export async function listPayments(db: DbOrTx, businessId: string) {
  return db
    .select({
      payment: payments,
      invoiceNumber: invoices.number,
      jobTitle: jobs.title,
      customerName: customers.name,
    })
    .from(payments)
    .leftJoin(invoices, eq(invoices.id, payments.invoiceId))
    .leftJoin(jobs, eq(jobs.id, invoices.jobId))
    .leftJoin(customers, eq(customers.id, jobs.customerId))
    .where(eq(payments.businessId, businessId))
    .orderBy(desc(payments.receivedAt));
}

/** Unpaid sent invoices, for the manual matching picker. */
export async function listOpenInvoices(db: DbOrTx, businessId: string) {
  return db
    .select({
      id: invoices.id,
      number: invoices.number,
      totalCents: invoices.totalCents,
      paidCents: invoices.paidCents,
    })
    .from(invoices)
    .where(and(eq(invoices.businessId, businessId), eq(invoices.status, "sent")))
    .orderBy(invoices.number);
}
