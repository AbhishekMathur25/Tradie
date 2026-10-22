/**
 * Owner dashboard figures. Pure functions over plain records so every number
 * can be unit-tested and traced back to the records behind it.
 *
 * Safe-MVP rule: these are facts from the business's own records. Nothing
 * here estimates tax owed, BAS amounts or tax to set aside.
 */
import { addDays, daysBetween, monthStart, quarterOf, toIsoDate, type IsoDate } from "./dates";
import { marginPercent } from "./money";
import { INSURANCE_THRESHOLD_CENTS, RESIDENTIAL_CONTRACT_THRESHOLD_CENTS } from "./rules";

export interface DashInvoice {
  id: string;
  jobId: string;
  number: string | null;
  kind: string;
  stageLabel: string;
  status: "draft" | "sent" | "paid" | "void";
  totalCents: number;
  gstCents: number;
  paidCents: number;
  sentOn: IsoDate | null;
  dueOn: IsoDate | null;
  plannedOn: IsoDate | null;
}

export interface DashJob {
  id: string;
  title: string;
  customerName: string;
  status: string;
  residentialBuildingWork: boolean;
  contractPriceCents: number | null;
  contractSignedOn: IsoDate | null;
  insuranceCertificateNumber: string | null;
  completedOn: IsoDate | null;
}

export interface DashQuote {
  id: string;
  jobId: string;
  status: "draft" | "sent" | "accepted" | "declined";
  subtotalCents: number;
  costCents: number;
  totalCents: number;
  sentOn: IsoDate | null;
  acceptedOn: IsoDate | null;
}

export interface DashVariation {
  id: string;
  jobId: string;
  number: string | null;
  status: "draft" | "sent" | "approved" | "declined";
  totalCents: number;
  sentOn: IsoDate | null;
}

export interface DashPayment {
  invoiceId: string | null;
  amountCents: number;
  receivedOn: IsoDate;
}

export interface DashboardInput {
  today: IsoDate;
  gstRegistered: boolean;
  jobs: DashJob[];
  quotes: DashQuote[];
  variations: DashVariation[];
  invoices: DashInvoice[];
  payments: DashPayment[];
}

export type NeedsYouSeverity = "block" | "warn" | "go" | "info";

export interface NeedsYouItem {
  severity: NeedsYouSeverity;
  title: string;
  detail: string;
  href: string;
}

export interface JobPosition {
  jobId: string;
  title: string;
  customerName: string;
  /** Contract price plus approved variations, incl. GST. */
  contractCents: number;
  claimedCents: number;
  paidCents: number;
  owedCents: number;
  leftToClaimCents: number;
  pendingVariationsCents: number;
  quotedMarginPercent: number | null;
  blockedReason: string | null;
}

export interface Dashboard {
  owed: { totalCents: number; count: number; overdueCents: number; overdueCount: number };
  overdueBuckets: { days1to30: number; days31to60: number; days61plus: number };
  comingIn30: { totalCents: number; invoiceCount: number; plannedClaimCount: number };
  receivedThisMonthCents: number;
  quotesWon90: { won: number; sent: number; wonValueCents: number };
  doneThisMonth: {
    jobsFinished: number;
    invoicesSent: number;
    quotesWon: number;
    paymentsReceived: number;
  };
  gstOnInvoicesThisQuarter: { cents: number; label: string };
  needsYou: NeedsYouItem[];
  jobPositions: JobPosition[];
  averageQuotedMarginPercent: number | null;
}

const isLive = (invoice: DashInvoice) => invoice.status === "sent" || invoice.status === "paid";
const outstanding = (invoice: DashInvoice) => Math.max(invoice.totalCents - invoice.paidCents, 0);

/** Whether a job's rule checks currently block payment requests, and why. */
export function paymentBlockReason(job: DashJob, acceptedQuoteTotalCents: number | null): string | null {
  if (!job.residentialBuildingWork) return null;
  const value = job.contractPriceCents ?? acceptedQuoteTotalCents;
  if (value === null) return null;
  if (value > RESIDENTIAL_CONTRACT_THRESHOLD_CENTS && !job.contractSignedOn) {
    return "Signed contract not recorded";
  }
  if (value > INSURANCE_THRESHOLD_CENTS && !job.insuranceCertificateNumber?.trim()) {
    return "Insurance certificate missing";
  }
  return null;
}

export function buildDashboard(input: DashboardInput): Dashboard {
  const { today } = input;
  const month = monthStart(today);
  const in30 = addDays(today, 30);
  const ninetyDaysAgo = addDays(today, -90);
  const quarter = quarterOf(today);

  // --- Money owed -----------------------------------------------------------
  const unpaid = input.invoices.filter((inv) => inv.status === "sent" && outstanding(inv) > 0);
  const overdue = unpaid.filter((inv) => inv.dueOn !== null && inv.dueOn < today);
  const buckets = { days1to30: 0, days31to60: 0, days61plus: 0 };
  for (const inv of overdue) {
    const late = daysBetween(inv.dueOn as IsoDate, today);
    if (late <= 30) buckets.days1to30 += outstanding(inv);
    else if (late <= 60) buckets.days31to60 += outstanding(inv);
    else buckets.days61plus += outstanding(inv);
  }

  // --- Coming in over the next 30 days (a forecast) ------------------------
  const dueSoon = unpaid.filter((inv) => inv.dueOn !== null && inv.dueOn >= today && inv.dueOn <= in30);
  const plannedClaims = input.invoices.filter(
    (inv) => inv.status === "draft" && inv.plannedOn !== null && inv.plannedOn <= in30,
  );

  // --- Payments and activity ------------------------------------------------
  const receivedThisMonth = input.payments.filter((p) => p.receivedOn >= month && p.receivedOn <= today);
  const sentInLast90 = input.quotes.filter((q) => q.sentOn !== null && q.sentOn >= ninetyDaysAgo);
  const wonInLast90 = sentInLast90.filter((q) => q.status === "accepted");

  // --- Job positions --------------------------------------------------------
  const acceptedQuoteByJob = new Map<string, DashQuote>();
  for (const quote of input.quotes) {
    if (quote.status === "accepted") acceptedQuoteByJob.set(quote.jobId, quote);
  }
  const activeJobs = input.jobs.filter((job) => job.status === "contracted" || job.status === "in_progress");
  const jobPositions: JobPosition[] = activeJobs.map((job) => {
    const jobInvoices = input.invoices.filter((inv) => inv.jobId === job.id && isLive(inv));
    const jobVariations = input.variations.filter((v) => v.jobId === job.id);
    const approved = jobVariations.filter((v) => v.status === "approved").reduce((s, v) => s + v.totalCents, 0);
    const pending = jobVariations.filter((v) => v.status === "sent").reduce((s, v) => s + v.totalCents, 0);
    const quote = acceptedQuoteByJob.get(job.id) ?? null;
    const base = job.contractPriceCents ?? quote?.totalCents ?? 0;
    const claimed = jobInvoices.reduce((s, inv) => s + inv.totalCents, 0);
    const paid = jobInvoices.reduce((s, inv) => s + inv.paidCents, 0);
    return {
      jobId: job.id,
      title: job.title,
      customerName: job.customerName,
      contractCents: base + approved,
      claimedCents: claimed,
      paidCents: paid,
      owedCents: claimed - paid,
      leftToClaimCents: Math.max(base + approved - claimed, 0),
      pendingVariationsCents: pending,
      quotedMarginPercent: quote ? marginPercent(quote.subtotalCents, quote.costCents) : null,
      blockedReason: paymentBlockReason(job, quote?.totalCents ?? null),
    };
  });

  const margins = jobPositions
    .map((position) => position.quotedMarginPercent)
    .filter((value): value is number => value !== null);

  return {
    owed: {
      totalCents: unpaid.reduce((s, inv) => s + outstanding(inv), 0),
      count: unpaid.length,
      overdueCents: overdue.reduce((s, inv) => s + outstanding(inv), 0),
      overdueCount: overdue.length,
    },
    overdueBuckets: buckets,
    comingIn30: {
      totalCents:
        dueSoon.reduce((s, inv) => s + outstanding(inv), 0) +
        plannedClaims.reduce((s, inv) => s + inv.totalCents, 0),
      invoiceCount: dueSoon.length,
      plannedClaimCount: plannedClaims.length,
    },
    receivedThisMonthCents: receivedThisMonth.reduce((s, p) => s + p.amountCents, 0),
    quotesWon90: {
      won: wonInLast90.length,
      sent: sentInLast90.length,
      wonValueCents: wonInLast90.reduce((s, q) => s + q.totalCents, 0),
    },
    doneThisMonth: {
      jobsFinished: input.jobs.filter((j) => j.completedOn !== null && j.completedOn >= month).length,
      invoicesSent: input.invoices.filter((inv) => inv.sentOn !== null && inv.sentOn >= month).length,
      quotesWon: input.quotes.filter((q) => q.acceptedOn !== null && q.acceptedOn >= month).length,
      paymentsReceived: receivedThisMonth.length,
    },
    gstOnInvoicesThisQuarter: {
      cents: input.gstRegistered
        ? input.invoices
            .filter((inv) => isLive(inv) && inv.sentOn !== null && inv.sentOn >= quarter.start && inv.sentOn <= quarter.end)
            .reduce((s, inv) => s + inv.gstCents, 0)
        : 0,
      label: quarter.label,
    },
    needsYou: buildNeedsYou(input, jobPositions, overdue),
    jobPositions,
    averageQuotedMarginPercent:
      margins.length > 0 ? Math.round(margins.reduce((s, m) => s + m, 0) / margins.length) : null,
  };
}

/** The pending list. Each item has exactly one place to act on it. */
function buildNeedsYou(input: DashboardInput, positions: JobPosition[], overdue: DashInvoice[]): NeedsYouItem[] {
  const { today } = input;
  const items: NeedsYouItem[] = [];
  const jobTitle = (jobId: string) => input.jobs.find((job) => job.id === jobId)?.title ?? "Job";

  for (const position of positions) {
    if (position.blockedReason) {
      items.push({
        severity: "block",
        title: `Payment requests blocked · ${position.title}`,
        detail: `${position.blockedReason}. Record it on the job to unblock.`,
        href: `/jobs/${position.jobId}`,
      });
    }
  }

  for (const inv of input.invoices) {
    if (inv.status === "draft" && inv.plannedOn !== null && inv.plannedOn <= addDays(today, 3)) {
      items.push({
        severity: "go",
        title: `Send ${inv.stageLabel ? `claim "${inv.stageLabel}"` : "draft invoice"} · ${jobTitle(inv.jobId)}`,
        detail: `Planned for ${inv.plannedOn}`,
        href: `/invoices/${inv.id}`,
      });
    }
  }

  if (overdue.length > 0) {
    items.push({
      severity: "warn",
      title: `${overdue.length} invoice${overdue.length === 1 ? "" : "s"} overdue`,
      detail: "Send a reminder from each invoice",
      href: "/invoices?filter=overdue",
    });
  }

  for (const variation of input.variations) {
    if (variation.status === "sent" && variation.sentOn && daysBetween(variation.sentOn, today) >= 7) {
      items.push({
        severity: "warn",
        title: `Variation ${variation.number ?? ""} unsigned for ${daysBetween(variation.sentOn, today)} days · ${jobTitle(variation.jobId)}`,
        detail: "Resend the sign-off link or call the customer",
        href: `/jobs/${variation.jobId}`,
      });
    }
  }

  const unmatched = input.payments.filter((payment) => payment.invoiceId === null);
  if (unmatched.length > 0) {
    items.push({
      severity: "warn",
      title: `${unmatched.length} payment${unmatched.length === 1 ? "" : "s"} to match`,
      detail: "Received without a reference we could match",
      href: "/payments",
    });
  }

  for (const quote of input.quotes) {
    if (quote.status === "sent" && quote.sentOn && daysBetween(quote.sentOn, today) >= 5) {
      items.push({
        severity: "info",
        title: `Follow up quote · ${jobTitle(quote.jobId)}`,
        detail: `Sent ${daysBetween(quote.sentOn, today)} days ago`,
        href: `/quotes/${quote.id}`,
      });
    }
  }

  // GST registration watch for businesses not yet registered (a fact, not advice).
  if (!input.gstRegistered) {
    const yearAgo = addDays(today, -365);
    const turnover = input.invoices
      .filter((inv) => isLive(inv) && inv.sentOn !== null && inv.sentOn >= yearAgo)
      .reduce((s, inv) => s + inv.totalCents, 0);
    if (turnover >= 6_500_000) {
      items.push({
        severity: "info",
        title: "Invoices in the last 12 months are nearing $75,000",
        detail: "The GST registration threshold is $75,000. Check with your accountant.",
        href: "/settings",
      });
    }
  }

  const order: Record<NeedsYouSeverity, number> = { block: 0, go: 1, warn: 2, info: 3 };
  return items.sort((a, b) => order[a.severity] - order[b.severity]);
}

export function todayIso(): IsoDate {
  return toIsoDate(new Date());
}
