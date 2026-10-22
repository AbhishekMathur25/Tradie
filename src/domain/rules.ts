/**
 * NSW rule checks. Pure functions: given the facts about a job and the
 * document being sent, return what blocks the send and what to warn about.
 *
 * These are guardrails, not legal advice. Every rule is listed in RULES with
 * its source and review status so a lawyer can sign each one off.
 */
import { addBusinessDays, type IsoDate } from "./dates";
import { formatCents } from "./money";

export const RESIDENTIAL_CONTRACT_THRESHOLD_CENTS = 500_000; // over $5,000 incl. GST
export const INSURANCE_THRESHOLD_CENTS = 2_000_000; // over $20,000 incl. GST
export const DEPOSIT_CAP_PERCENT = 10;
export const BUYER_IDENTITY_THRESHOLD_CENTS = 100_000; // $1,000 incl. GST
export const COOLING_OFF_BUSINESS_DAYS = 5;

export type RuleId =
  | "licence-details"
  | "written-contract"
  | "deposit-cap"
  | "insurance-before-payment"
  | "cooling-off"
  | "buyer-identity"
  | "claims-within-contract"
  | "not-gst-registered";

export interface RuleInfo {
  id: RuleId;
  title: string;
  source: string;
  sourceUrl: string;
  /** Who has reviewed the rule. Update when the lawyer signs it off. */
  review: string;
}

const PENDING = "Pending legal review";

/** The rule register shown in the app and kept in step with this file. */
export const RULES: Record<RuleId, RuleInfo> = {
  "licence-details": {
    id: "licence-details",
    title: "Licence number and exact licensee name on residential documents",
    source: "NSW Government, guide to providing home building contracts",
    sourceUrl:
      "https://www.nsw.gov.au/housing-and-construction/compliance-and-regulation/your-obligations-to-your-customers/guide-to-providing-home-building-contracts",
    review: PENDING,
  },
  "written-contract": {
    id: "written-contract",
    title: "Written contract for NSW residential work over $5,000",
    source: "NSW Fair Trading, guide to home building contracts",
    sourceUrl:
      "https://www.fairtrading.nsw.gov.au/trades-and-businesses/construction-and-trade-essentials/guide-to-home-building-contracts",
    review: PENDING,
  },
  "deposit-cap": {
    id: "deposit-cap",
    title: "Deposit no more than 10% of the contract price",
    source: "Home Building Act 1989 (NSW); Fair Trading owner checklist",
    sourceUrl:
      "https://www.fairtrading.nsw.gov.au/__data/assets/pdf_file/0007/987298/before-you-build-owner-checklist.pdf",
    review: PENDING,
  },
  "insurance-before-payment": {
    id: "insurance-before-payment",
    title: "Insurance certificate before asking for any payment (jobs over $20,000)",
    source: "NSW Fair Trading owner checklist",
    sourceUrl:
      "https://www.fairtrading.nsw.gov.au/__data/assets/pdf_file/0007/987298/before-you-build-owner-checklist.pdf",
    review: PENDING,
  },
  "cooling-off": {
    id: "cooling-off",
    title: "5-business-day cooling-off for contracts over $20,000",
    source: "NSW Government, guide to providing home building contracts",
    sourceUrl:
      "https://www.nsw.gov.au/housing-and-construction/compliance-and-regulation/your-obligations-to-your-customers/guide-to-providing-home-building-contracts",
    review: PENDING,
  },
  "buyer-identity": {
    id: "buyer-identity",
    title: "Buyer's name or ABN on tax invoices of $1,000 or more",
    source: "ATO, tax invoices",
    sourceUrl: "https://www.ato.gov.au/Issuetaxinvoice",
    review: PENDING,
  },
  "claims-within-contract": {
    id: "claims-within-contract",
    title: "Claims can't exceed the contract price plus approved variations",
    source: "Product rule (keeps claims reconciled)",
    sourceUrl: "",
    review: "Internal",
  },
  "not-gst-registered": {
    id: "not-gst-registered",
    title: "Businesses not registered for GST issue invoices without GST",
    source: "ATO, tax invoices",
    sourceUrl: "https://www.ato.gov.au/Issuetaxinvoice",
    review: PENDING,
  },
};

export type Severity = "block" | "warn" | "info";

export interface RuleResult {
  ruleId: RuleId;
  severity: Severity;
  message: string;
}

export interface BusinessFacts {
  licenceNumber: string;
  licenseeName: string;
  gstRegistered: boolean;
}

export interface JobFacts {
  residentialBuildingWork: boolean;
  /** Contract price incl. GST, if a contract has been recorded. */
  contractPriceCents: number | null;
  contractSignedOn: IsoDate | null;
  insuranceCertificateNumber: string | null;
  /** Total of the accepted quote incl. GST, used before a contract exists. */
  acceptedQuoteTotalCents: number | null;
  /** Approved variations incl. GST. */
  approvedVariationsCents: number;
}

export interface CustomerFacts {
  name: string;
  abn: string;
}

/** The value the thresholds are measured against: contract, else accepted quote. */
export function jobValueCents(job: JobFacts): number | null {
  return job.contractPriceCents ?? job.acceptedQuoteTotalCents;
}

/** Last day of the cooling-off period (guide: weekends skipped, holidays not). */
export function coolingOffEnds(contractSignedOn: IsoDate): IsoDate {
  return addBusinessDays(contractSignedOn, COOLING_OFF_BUSINESS_DAYS);
}

function licenceCheck(business: BusinessFacts, job: JobFacts): RuleResult[] {
  if (!job.residentialBuildingWork) return [];
  if (business.licenceNumber.trim() && business.licenseeName.trim()) return [];
  return [
    {
      ruleId: "licence-details",
      severity: "block",
      message: "Add your licence number and the licensee's exact name in Settings before sending.",
    },
  ];
}

function gstNotice(business: BusinessFacts): RuleResult[] {
  if (business.gstRegistered) return [];
  return [
    {
      ruleId: "not-gst-registered",
      severity: "info",
      message: 'You\'re not registered for GST, so this is titled "Invoice" and carries no GST.',
    },
  ];
}

/** Checks before a quote is sent to the customer. */
export function checkQuoteSend(input: {
  business: BusinessFacts;
  job: JobFacts;
  quoteTotalCents: number;
}): RuleResult[] {
  const { business, job, quoteTotalCents } = input;
  const results = [...licenceCheck(business, job)];
  if (job.residentialBuildingWork && quoteTotalCents > RESIDENTIAL_CONTRACT_THRESHOLD_CENTS) {
    results.push({
      ruleId: "written-contract",
      severity: "warn",
      message:
        "This job is over $5,000, so a written contract is needed before any deposit. " +
        "Accepting this quote does not replace the contract.",
    });
  }
  if (job.residentialBuildingWork && quoteTotalCents > INSURANCE_THRESHOLD_CENTS) {
    results.push({
      ruleId: "insurance-before-payment",
      severity: "warn",
      message:
        "This job is over $20,000, so you'll need the insurance certificate before asking for any payment.",
    });
  }
  return results;
}

/** Checks before a variation is sent for the customer's sign-off. */
export function checkVariationSend(input: {
  business: BusinessFacts;
  job: JobFacts;
}): RuleResult[] {
  return licenceCheck(input.business, input.job);
}

export interface InvoiceFacts {
  kind: "deposit" | "progress" | "final" | "standard";
  totalCents: number;
}

/**
 * Checks before any payment request (deposit, claim or invoice) is sent.
 * `otherInvoices` are this job's other invoices that have been sent and not
 * voided. Drafts don't count until they are sent.
 */
export function checkInvoiceSend(input: {
  business: BusinessFacts;
  job: JobFacts;
  customer: CustomerFacts;
  invoice: InvoiceFacts;
  otherInvoices: InvoiceFacts[];
}): RuleResult[] {
  const { business, job, customer, invoice, otherInvoices } = input;
  const results = [...licenceCheck(business, job), ...gstNotice(business)];
  const value = jobValueCents(job);

  if (job.residentialBuildingWork && value !== null) {
    const needsContract = value > RESIDENTIAL_CONTRACT_THRESHOLD_CENTS;
    if (needsContract && !job.contractSignedOn) {
      results.push({
        ruleId: "written-contract",
        severity: "block",
        message: "Record the signed written contract on this job before asking for payment.",
      });
    }

    if (value > INSURANCE_THRESHOLD_CENTS && !job.insuranceCertificateNumber?.trim()) {
      results.push({
        ruleId: "insurance-before-payment",
        severity: "block",
        message:
          "Record the home building insurance certificate on this job before asking for any payment.",
      });
    }

    if (value > INSURANCE_THRESHOLD_CENTS && job.contractSignedOn) {
      results.push({
        ruleId: "cooling-off",
        severity: "info",
        message: `Cooling-off runs until about ${coolingOffEnds(job.contractSignedOn)} (weekends skipped; public holidays not counted, so check).`,
      });
    }
  }

  if (invoice.kind === "deposit") {
    if (job.contractPriceCents === null) {
      results.push({
        ruleId: "deposit-cap",
        severity: "block",
        message: "Record the contract price first, so the 10% deposit limit can be checked.",
      });
    } else if (job.residentialBuildingWork) {
      const cap = Math.floor((job.contractPriceCents * DEPOSIT_CAP_PERCENT) / 100);
      const depositsSoFar = otherInvoices
        .filter((other) => other.kind === "deposit")
        .reduce((sum, other) => sum + other.totalCents, 0);
      if (depositsSoFar + invoice.totalCents > cap) {
        results.push({
          ruleId: "deposit-cap",
          severity: "block",
          message: `Deposits can't exceed 10% of the contract price (${formatCents(cap)}). This would make ${formatCents(depositsSoFar + invoice.totalCents)}.`,
        });
      }
    }
  }

  if (invoice.kind !== "standard" && job.contractPriceCents !== null) {
    const limit = job.contractPriceCents + job.approvedVariationsCents;
    const claimed = otherInvoices.reduce((sum, other) => sum + other.totalCents, 0);
    if (claimed + invoice.totalCents > limit) {
      results.push({
        ruleId: "claims-within-contract",
        severity: "block",
        message: `Claims would total ${formatCents(claimed + invoice.totalCents)}, more than the contract plus approved variations (${formatCents(limit)}).`,
      });
    }
  }

  if (
    business.gstRegistered &&
    invoice.totalCents >= BUYER_IDENTITY_THRESHOLD_CENTS &&
    !customer.name.trim() &&
    !customer.abn.trim()
  ) {
    results.push({
      ruleId: "buyer-identity",
      severity: "block",
      message: "Tax invoices of $1,000 or more must show the customer's name or ABN.",
    });
  }

  return results;
}

export function isBlocked(results: RuleResult[]): boolean {
  return results.some((result) => result.severity === "block");
}
