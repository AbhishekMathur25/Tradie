import { createInvoiceAction } from "@/app/actions/documents";
import { DocumentEditor } from "@/components/DocumentEditor";
import { BackLink, Flash, KIND_LABEL, PageHead } from "@/components/ui";
import { getDb } from "@/db/client";
import { INVOICE_KINDS } from "@/db/schema";
import type { Line } from "@/domain/money";
import { DEPOSIT_CAP_PERCENT } from "@/domain/rules";
import { requireOwner } from "@/lib/auth";
import { getBusiness, listPriceItems } from "@/services/directory";
import { stageLine } from "@/services/documents";
import { getJobDetail, jobFacts } from "@/services/jobs";

type Kind = (typeof INVOICE_KINDS)[number];

/** GST-exclusive amount whose GST-inclusive total doesn't exceed `inclusiveCents`. */
function exclusiveFor(inclusiveCents: number, gstRegistered: boolean): number {
  return gstRegistered ? Math.floor((inclusiveCents * 10) / 11) : inclusiveCents;
}

export default async function NewInvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ kind?: string; error?: string }>;
}) {
  const user = await requireOwner();
  const { id } = await params;
  const query = await searchParams;
  const kind: Kind = (INVOICE_KINDS as readonly string[]).includes(query.kind ?? "")
    ? (query.kind as Kind)
    : "standard";
  const db = await getDb();
  const [detail, business, priceItems] = await Promise.all([
    getJobDetail(db, user.businessId, id),
    getBusiness(db, user.businessId),
    listPriceItems(db, user.businessId),
  ]);
  const facts = jobFacts(detail.job, detail.quotes, detail.variations);

  // Sensible starting lines; the owner edits them before saving.
  let initialLines: Line[] = [];
  let stageLabel = "";
  if (kind === "deposit" && detail.job.contractPriceCents) {
    const cap = Math.floor((detail.job.contractPriceCents * DEPOSIT_CAP_PERCENT) / 100);
    initialLines = [
      stageLine(
        `Deposit (${DEPOSIT_CAP_PERCENT}% of contract price)`,
        exclusiveFor(cap, business.gstRegistered),
      ),
    ];
    stageLabel = "Deposit";
  } else if (kind === "final") {
    const contract =
      (detail.job.contractPriceCents ?? facts.acceptedQuoteTotalCents ?? 0) +
      facts.approvedVariationsCents;
    const claimed = detail.invoices
      .filter((invoice) => invoice.status === "sent" || invoice.status === "paid")
      .reduce((sum, invoice) => sum + invoice.totalCents, 0);
    const remaining = Math.max(contract - claimed, 0);
    if (remaining > 0)
      initialLines = [
        stageLine(
          "Final claim: balance of contract",
          exclusiveFor(remaining, business.gstRegistered),
        ),
      ];
    stageLabel = "Practical completion";
  } else if (kind === "standard") {
    const accepted = detail.quotes.find((quote) => quote.status === "accepted");
    if (accepted && detail.invoices.length === 0) initialLines = accepted.lines;
  }

  return (
    <>
      <BackLink href={`/jobs/${detail.job.id}`} label={detail.job.title} />
      <PageHead
        title={`New ${KIND_LABEL[kind].toLowerCase()}`}
        sub="Saved as a draft first. The NSW checks run before you send."
      />
      <Flash params={query} />
      <div className="card">
        <DocumentEditor
          action={createInvoiceAction.bind(null, detail.job.id)}
          priceItems={priceItems}
          initialLines={initialLines}
          gstRegistered={business.gstRegistered}
          hidden={{ kind }}
          submitLabel="Save draft"
        >
          <div className="row">
            <div className="field">
              <label htmlFor="stageLabel">Stage</label>
              <input
                id="stageLabel"
                name="stageLabel"
                type="text"
                defaultValue={stageLabel}
                placeholder="Cabinets installed"
              />
            </div>
            <div className="field">
              <label htmlFor="plannedOn">Planned send date</label>
              <input id="plannedOn" name="plannedOn" type="date" />
              <span className="hint">Used for the 30-day forecast on the dashboard.</span>
            </div>
          </div>
          <div className="field">
            <label htmlFor="notes">Notes</label>
            <textarea id="notes" name="notes" />
          </div>
        </DocumentEditor>
      </div>
    </>
  );
}
