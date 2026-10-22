"use server";

/** Quotes and invoices, including AI drafting. Owner only. */
import { getDb } from "@/db/client";
import { INVOICE_KINDS } from "@/db/schema";
import { todayIso } from "@/domain/dashboard";
import type { DraftResponse } from "@/components/DocumentEditor";
import { draftLines } from "@/integrations/ai/draft";
import { actorOf, requireOwner } from "@/lib/auth";
import { act, integer, jsonField, optionalDate, text, withQuery } from "@/lib/forms";
import { getCustomer, listPriceItems } from "@/services/directory";
import {
  createInvoiceDraft,
  createQuoteDraft,
  invoiceInputSchema,
  quoteInputSchema,
  sendInvoice,
  sendQuote,
  sendReminder,
  updateInvoice,
  updateQuoteDraft,
  voidInvoice,
} from "@/services/documents";
import { getJob } from "@/services/jobs";

// --- Drafting -----------------------------------------------------------------

/** Called from the editor; returns lines for the person to review. */
export async function draftLinesAction(jobId: string, description: string): Promise<DraftResponse> {
  const user = await requireOwner();
  const db = await getDb();
  const job = await getJob(db, user.businessId, jobId);
  const customer = await getCustomer(db, user.businessId, job.customerId);
  const priceItems = await listPriceItems(db, user.businessId);
  return draftLines({
    description: description.slice(0, 2000),
    priceItems,
    personalTerms: [
      customer.name,
      customer.address,
      customer.email,
      customer.phone,
      job.siteAddress,
    ],
  });
}

// --- Quotes -------------------------------------------------------------------

function quoteInput(form: FormData) {
  return quoteInputSchema.parse({ lines: jsonField(form, "lines"), notes: text(form, "notes") });
}

export async function createQuoteAction(jobId: string, form: FormData): Promise<void> {
  const user = await requireOwner();
  await act(`/jobs/${jobId}/quotes/new`, async () => {
    const quote = await createQuoteDraft(await getDb(), actorOf(user), jobId, quoteInput(form));
    return withQuery(`/quotes/${quote.id}`, { notice: "Quote saved as a draft." });
  });
}

export async function updateQuoteAction(quoteId: string, form: FormData): Promise<void> {
  const user = await requireOwner();
  const page = `/quotes/${quoteId}`;
  await act(page, async () => {
    await updateQuoteDraft(
      await getDb(),
      actorOf(user),
      quoteId,
      integer(form, "version"),
      quoteInput(form),
    );
    return withQuery(page, { notice: "Quote saved." });
  });
}

export async function sendQuoteAction(quoteId: string): Promise<void> {
  const user = await requireOwner();
  const page = `/quotes/${quoteId}`;
  await act(page, async () => {
    const { number } = await sendQuote(await getDb(), actorOf(user), quoteId, todayIso());
    return withQuery(page, { notice: `Quote ${number} sent. The email is in the Outbox.` });
  });
}

// --- Invoices and claims ------------------------------------------------------

function invoiceInput(form: FormData) {
  const kind = text(form, "kind");
  return invoiceInputSchema.parse({
    kind: (INVOICE_KINDS as readonly string[]).includes(kind) ? kind : "standard",
    stageLabel: text(form, "stageLabel"),
    lines: jsonField(form, "lines"),
    notes: text(form, "notes"),
    plannedOn: optionalDate(form, "plannedOn"),
  });
}

export async function createInvoiceAction(jobId: string, form: FormData): Promise<void> {
  const user = await requireOwner();
  await act(
    `/jobs/${jobId}/invoices/new?kind=${encodeURIComponent(text(form, "kind"))}`,
    async () => {
      const invoice = await createInvoiceDraft(
        await getDb(),
        actorOf(user),
        jobId,
        invoiceInput(form),
      );
      return withQuery(`/invoices/${invoice.id}`, {
        notice: "Saved as a draft. Check the rules panel, then send.",
      });
    },
  );
}

export async function updateInvoiceAction(invoiceId: string, form: FormData): Promise<void> {
  const user = await requireOwner();
  const page = `/invoices/${invoiceId}`;
  await act(page, async () => {
    await updateInvoice(
      await getDb(),
      actorOf(user),
      invoiceId,
      integer(form, "version"),
      invoiceInput(form),
    );
    return withQuery(page, { notice: "Invoice saved." });
  });
}

export async function sendInvoiceAction(invoiceId: string): Promise<void> {
  const user = await requireOwner();
  const page = `/invoices/${invoiceId}`;
  await act(page, async () => {
    const { number } = await sendInvoice(await getDb(), actorOf(user), invoiceId, todayIso());
    return withQuery(page, { notice: `${number} sent. The email is in the Outbox.` });
  });
}

export async function voidInvoiceAction(invoiceId: string): Promise<void> {
  const user = await requireOwner();
  const page = `/invoices/${invoiceId}`;
  await act(page, async () => {
    await voidInvoice(await getDb(), actorOf(user), invoiceId);
    return withQuery(page, { notice: "Invoice voided." });
  });
}

export async function sendReminderAction(invoiceId: string): Promise<void> {
  const user = await requireOwner();
  const page = `/invoices/${invoiceId}`;
  await act(page, async () => {
    await sendReminder(await getDb(), actorOf(user), invoiceId);
    return withQuery(page, { notice: "Reminder queued. It's in the Outbox." });
  });
}
