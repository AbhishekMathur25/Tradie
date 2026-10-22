/** Gathers what a quote or invoice PDF shows. */
import type { DbOrTx } from "@/db/client";
import { formatDate } from "@/domain/dates";
import type { PrintableDocument } from "@/pdf/render";
import { getBusiness, getCustomer } from "./directory";
import { getInvoice, getQuote } from "./documents";
import { getJob } from "./jobs";

export async function printableQuote(
  db: DbOrTx,
  businessId: string,
  quoteId: string,
): Promise<PrintableDocument> {
  const quote = await getQuote(db, businessId, quoteId);
  const business = await getBusiness(db, businessId);
  const job = await getJob(db, businessId, quote.jobId);
  const customer = await getCustomer(db, businessId, job.customerId);
  return {
    title: "Quote",
    number: quote.number ?? "DRAFT",
    business,
    showLicence: job.residentialBuildingWork,
    customer,
    jobTitle: job.title,
    siteAddress: job.siteAddress,
    facts: [
      ["Issued", formatDate(quote.sentAt ?? quote.createdAt)],
      ["Valid until", quote.validUntil ? formatDate(quote.validUntil) : "30 days from issue"],
    ],
    lines: quote.lines,
    subtotalCents: quote.subtotalCents,
    gstCents: quote.gstCents,
    totalCents: quote.totalCents,
    gstRegistered: business.gstRegistered,
    notes: quote.notes,
  };
}

export async function printableInvoice(
  db: DbOrTx,
  businessId: string,
  invoiceId: string,
): Promise<PrintableDocument> {
  const invoice = await getInvoice(db, businessId, invoiceId);
  const business = await getBusiness(db, businessId);
  const job = await getJob(db, businessId, invoice.jobId);
  const customer = await getCustomer(db, businessId, job.customerId);
  const gst = invoice.status === "draft" ? business.gstRegistered : invoice.taxInvoice;
  const claim =
    invoice.kind === "standard"
      ? ""
      : ` (${invoice.kind} claim${invoice.stageLabel ? `: ${invoice.stageLabel}` : ""})`;
  return {
    title: gst ? "Tax invoice" : "Invoice",
    number: (invoice.number ?? "DRAFT") + claim,
    business,
    showLicence: job.residentialBuildingWork,
    customer,
    jobTitle: job.title,
    siteAddress: job.siteAddress,
    facts: [
      ["Issued", formatDate(invoice.sentAt ?? invoice.createdAt)],
      ["Due", invoice.dueOn ? formatDate(invoice.dueOn) : "On issue"],
    ],
    lines: invoice.lines,
    subtotalCents: invoice.subtotalCents,
    gstCents: invoice.gstCents,
    totalCents: invoice.totalCents,
    gstRegistered: gst,
    payment:
      invoice.payId && invoice.paymentReference && invoice.dueOn
        ? {
            payId: invoice.payId,
            reference: invoice.paymentReference,
            dueOn: formatDate(invoice.dueOn),
            outstandingCents: Math.max(invoice.totalCents - invoice.paidCents, 0),
          }
        : undefined,
    notes: invoice.notes,
  };
}
