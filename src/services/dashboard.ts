/**
 * Loads the owner dashboard from the database and builds the weekly summary
 * email. The figures themselves are calculated in domain/dashboard.ts.
 */
import { eq } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { customers, invoices, jobs, payments, quotes, users, variations } from "@/db/schema";
import { buildDashboard, type Dashboard } from "@/domain/dashboard";
import { toIsoDate } from "@/domain/dates";
import { formatWholeDollars } from "@/domain/money";
import { getBusiness } from "./directory";
import { customerUrl, queueEmail } from "./support";

const isoOrNull = (value: Date | null) => (value ? toIsoDate(value) : null);

export async function loadDashboard(
  db: DbOrTx,
  businessId: string,
  today: string,
): Promise<Dashboard> {
  const business = await getBusiness(db, businessId);
  const [jobRows, quoteRows, variationRows, invoiceRows, paymentRows] = await Promise.all([
    db
      .select({ job: jobs, customerName: customers.name })
      .from(jobs)
      .innerJoin(customers, eq(customers.id, jobs.customerId))
      .where(eq(jobs.businessId, businessId)),
    db.select().from(quotes).where(eq(quotes.businessId, businessId)),
    db.select().from(variations).where(eq(variations.businessId, businessId)),
    db.select().from(invoices).where(eq(invoices.businessId, businessId)),
    db.select().from(payments).where(eq(payments.businessId, businessId)),
  ]);

  return buildDashboard({
    today,
    gstRegistered: business.gstRegistered,
    jobs: jobRows.map(({ job, customerName }) => ({
      id: job.id,
      title: job.title,
      customerName,
      status: job.status,
      residentialBuildingWork: job.residentialBuildingWork,
      contractPriceCents: job.contractPriceCents,
      contractSignedOn: job.contractSignedOn,
      insuranceCertificateNumber: job.insuranceCertificateNumber,
      completedOn: job.completedOn,
    })),
    quotes: quoteRows.map((quote) => ({
      id: quote.id,
      jobId: quote.jobId,
      status: quote.status,
      subtotalCents: quote.subtotalCents,
      costCents: quote.costCents,
      totalCents: quote.totalCents,
      sentOn: isoOrNull(quote.sentAt),
      acceptedOn: isoOrNull(quote.acceptedAt),
    })),
    variations: variationRows.map((variation) => ({
      id: variation.id,
      jobId: variation.jobId,
      number: variation.number,
      status: variation.status,
      totalCents: variation.totalCents,
      sentOn: isoOrNull(variation.sentAt),
    })),
    invoices: invoiceRows.map((invoice) => ({
      id: invoice.id,
      jobId: invoice.jobId,
      number: invoice.number,
      kind: invoice.kind,
      stageLabel: invoice.stageLabel,
      status: invoice.status,
      totalCents: invoice.totalCents,
      gstCents: invoice.gstCents,
      paidCents: invoice.paidCents,
      sentOn: isoOrNull(invoice.sentAt),
      dueOn: invoice.dueOn,
      plannedOn: invoice.plannedOn,
    })),
    payments: paymentRows.map((payment) => ({
      invoiceId: payment.invoiceId,
      amountCents: payment.amountCents,
      receivedOn: toIsoDate(payment.receivedAt),
    })),
  });
}

/** Plain-text weekly summary. Facts only; no tax advice. */
export function weeklySummaryText(businessName: string, dash: Dashboard): string {
  const lines = [
    `${businessName}: your week in money`,
    "",
    `Owed to you: ${formatWholeDollars(dash.owed.totalCents)} (${formatWholeDollars(dash.owed.overdueCents)} overdue across ${dash.owed.overdueCount} invoice${dash.owed.overdueCount === 1 ? "" : "s"})`,
    `Coming in over the next 30 days (forecast): ${formatWholeDollars(dash.comingIn30.totalCents)}`,
    `Received this month: ${formatWholeDollars(dash.receivedThisMonthCents)}`,
    "",
    dash.needsYou.length > 0 ? "Needs you:" : "Nothing needs you this week.",
    ...dash.needsYou.slice(0, 8).map((item) => `- ${item.title}`),
    "",
    `GST shown on invoices sent ${dash.gstOnInvoicesThisQuarter.label}: ${formatWholeDollars(dash.gstOnInvoicesThisQuarter.cents)}.`,
    "Your BAS figures come from Xero or your bookkeeper.",
    "",
    `Open the dashboard: ${customerUrl("").replace(/\/c\/$/, "/dashboard")}`,
  ];
  return lines.join("\n");
}

/** Queues the weekly summary for every owner of the business. */
export async function sendWeeklySummary(
  db: DbOrTx,
  businessId: string,
  today: string,
): Promise<number> {
  const business = await getBusiness(db, businessId);
  const dash = await loadDashboard(db, businessId, today);
  const owners = await db.select().from(users).where(eq(users.businessId, businessId));
  const body = weeklySummaryText(business.name, dash);
  let sent = 0;
  for (const owner of owners.filter((user) => user.role === "owner")) {
    await queueEmail(db, {
      businessId,
      to: owner.email,
      kind: "summary",
      subject: `Weekly money summary · ${business.name}`,
      body,
    });
    sent += 1;
  }
  return sent;
}
