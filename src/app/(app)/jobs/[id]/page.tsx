import Link from "next/link";
import {
  createVariationAction,
  sendVariationAction,
  setJobStatusAction,
  updateContractAction,
} from "@/app/actions/jobs";
import { SubmitButton } from "@/components/buttons";
import {
  BackLink,
  Flash,
  KIND_LABEL,
  Money,
  PageHead,
  StatusPill,
  invoiceState,
} from "@/components/ui";
import { getDb } from "@/db/client";
import { CONTRACT_KINDS, JOB_STATUSES } from "@/db/schema";
import { paymentBlockReason, todayIso } from "@/domain/dashboard";
import { centsToInput, formatWholeDollars } from "@/domain/money";
import {
  coolingOffEnds,
  INSURANCE_THRESHOLD_CENTS,
  jobValueCents,
  RESIDENTIAL_CONTRACT_THRESHOLD_CENTS,
} from "@/domain/rules";
import { requireUser } from "@/lib/auth";
import { getJobDetail, jobFacts } from "@/services/jobs";

const CONTRACT_LABEL: Record<(typeof CONTRACT_KINDS)[number], string> = {
  fair_trading: "NSW Fair Trading contract",
  hia: "HIA contract",
  master_builders: "Master Builders contract",
  own_lawyer: "Contract from my lawyer",
  other: "Other written contract",
};

export default async function JobPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const flash = await searchParams;
  const detail = await getJobDetail(await getDb(), user.businessId, id);
  const { job, customer } = detail;

  // Crew see the job basics only: no prices, claims or invoices.
  if (user.role !== "owner") {
    return (
      <>
        <BackLink href="/jobs" label="Jobs" />
        <PageHead title={job.title} sub={<StatusPill status={job.status} />} />
        <div className="card">
          <p>
            <b>Site:</b> {job.siteAddress || "Not recorded"}
          </p>
          <p>
            <b>Customer:</b> {customer.name} {customer.phone ? `· ${customer.phone}` : ""}
          </p>
        </div>
      </>
    );
  }

  const facts = jobFacts(job, detail.quotes, detail.variations);
  const value = jobValueCents(facts);
  const blocked = paymentBlockReason(
    { ...job, customerName: customer.name },
    facts.acceptedQuoteTotalCents,
  );
  const today = todayIso();
  const live = detail.invoices.filter(
    (invoice) => invoice.status === "sent" || invoice.status === "paid",
  );
  const claimed = live.reduce((sum, invoice) => sum + invoice.totalCents, 0);
  const paid = live.reduce((sum, invoice) => sum + invoice.paidCents, 0);
  const contractTotal =
    (job.contractPriceCents ?? facts.acceptedQuoteTotalCents ?? 0) + facts.approvedVariationsCents;

  return (
    <>
      <BackLink href="/jobs" label="Jobs" />
      <PageHead
        title={job.title}
        sub={
          <>
            {customer.name} · {job.siteAddress || "no site address"} ·{" "}
            <StatusPill status={job.status} />
            {job.residentialBuildingWork ? (
              <span className="pill info" style={{ marginLeft: 6 }}>
                NSW residential
              </span>
            ) : null}
          </>
        }
      >
        <form action={setJobStatusAction.bind(null, job.id)} className="actions">
          <select name="status" defaultValue={job.status} aria-label="Job status">
            {JOB_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status.replace("_", " ")}
              </option>
            ))}
          </select>
          <SubmitButton>Update status</SubmitButton>
        </form>
      </PageHead>
      <Flash params={flash} />

      <div className="grid-4">
        <div className="tile">
          <div className="label">Contract + approved variations</div>
          <div className="value">{formatWholeDollars(contractTotal)}</div>
          <div className="note">incl. GST</div>
        </div>
        <div className="tile">
          <div className="label">Claimed so far</div>
          <div className="value">{formatWholeDollars(claimed)}</div>
          <div className="note">sent invoices and claims</div>
        </div>
        <div className="tile">
          <div className="label">Paid</div>
          <div className="value">{formatWholeDollars(paid)}</div>
          <div className="note">owed {formatWholeDollars(claimed - paid)}</div>
        </div>
        <div className="tile">
          <div className="label">Left to claim</div>
          <div className="value">{formatWholeDollars(Math.max(contractTotal - claimed, 0))}</div>
          <div className="note">incl. GST</div>
        </div>
      </div>

      <div className="grid-2">
        <section className="card">
          <h2>Contract and insurance</h2>
          {blocked ? (
            <p className="flash error">Payment requests are blocked: {blocked}.</p>
          ) : job.residentialBuildingWork && value !== null ? (
            <p className="flash notice">Contract checks are clear for payment requests.</p>
          ) : null}
          {job.residentialBuildingWork && value !== null ? (
            <ul className="small muted">
              {value > RESIDENTIAL_CONTRACT_THRESHOLD_CENTS ? (
                <li>Over $5,000: a written contract is required.</li>
              ) : null}
              {value > INSURANCE_THRESHOLD_CENTS ? (
                <li>
                  Over $20,000: insurance certificate needed before any payment; 5-business-day
                  cooling-off.
                </li>
              ) : null}
              {value > INSURANCE_THRESHOLD_CENTS && job.contractSignedOn ? (
                <li>
                  Cooling-off runs until about {coolingOffEnds(job.contractSignedOn)} (weekends
                  skipped, public holidays not counted).
                </li>
              ) : null}
            </ul>
          ) : null}
          <form action={updateContractAction.bind(null, job.id)} className="stack">
            <div className="row">
              <div className="field">
                <label htmlFor="contractPrice">Contract price (incl. GST)</label>
                <input
                  id="contractPrice"
                  name="contractPrice"
                  type="text"
                  inputMode="decimal"
                  defaultValue={job.contractPriceCents ? centsToInput(job.contractPriceCents) : ""}
                />
              </div>
              <div className="field">
                <label htmlFor="contractSignedOn">Signed on</label>
                <input
                  id="contractSignedOn"
                  name="contractSignedOn"
                  type="date"
                  defaultValue={job.contractSignedOn ?? ""}
                />
              </div>
            </div>
            <div className="field">
              <label htmlFor="contractKind">Contract used</label>
              <select id="contractKind" name="contractKind" defaultValue={job.contractKind ?? ""}>
                <option value="">Not recorded</option>
                {CONTRACT_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {CONTRACT_LABEL[kind]}
                  </option>
                ))}
              </select>
            </div>
            <div className="row">
              <div className="field">
                <label htmlFor="insuranceCertificateNumber">Insurance certificate number</label>
                <input
                  id="insuranceCertificateNumber"
                  name="insuranceCertificateNumber"
                  type="text"
                  defaultValue={job.insuranceCertificateNumber ?? ""}
                />
              </div>
              <div className="field">
                <label htmlFor="insuranceCertificateOn">Given to customer on</label>
                <input
                  id="insuranceCertificateOn"
                  name="insuranceCertificateOn"
                  type="date"
                  defaultValue={job.insuranceCertificateOn ?? ""}
                />
              </div>
            </div>
            <p className="hint small muted">
              The app checks these details; it doesn&apos;t write contracts. Use the official
              contract, one from HIA or Master Builders, or your lawyer&apos;s.
            </p>
            <SubmitButton>Save contract details</SubmitButton>
          </form>
        </section>

        <section className="card">
          <div className="page-head">
            <h2>Quotes</h2>
            <Link href={`/jobs/${job.id}/quotes/new`} className="button">
              New quote
            </Link>
          </div>
          {detail.quotes.length === 0 ? (
            <p className="muted small">No quotes yet.</p>
          ) : (
            <table>
              <tbody>
                {detail.quotes.map((quote) => (
                  <tr key={quote.id}>
                    <td>
                      <Link href={`/quotes/${quote.id}`}>{quote.number ?? "Draft quote"}</Link>
                    </td>
                    <td>
                      <StatusPill status={quote.status} />
                    </td>
                    <td className="right">
                      <Money cents={quote.totalCents} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      <section className="card">
        <div className="page-head">
          <h2>Claims and invoices</h2>
          <div className="actions">
            <Link href={`/jobs/${job.id}/invoices/new?kind=deposit`} className="button">
              Deposit claim
            </Link>
            <Link href={`/jobs/${job.id}/invoices/new?kind=progress`} className="button">
              Progress claim
            </Link>
            <Link href={`/jobs/${job.id}/invoices/new?kind=final`} className="button">
              Final claim
            </Link>
            <Link href={`/jobs/${job.id}/invoices/new?kind=standard`} className="button">
              Invoice
            </Link>
          </div>
        </div>
        {detail.invoices.length === 0 ? (
          <p className="muted small">Nothing claimed yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Number</th>
                  <th>Type</th>
                  <th>Stage</th>
                  <th>Status</th>
                  <th className="right">Total</th>
                  <th className="right">Paid</th>
                </tr>
              </thead>
              <tbody>
                {detail.invoices.map((invoice) => (
                  <tr key={invoice.id}>
                    <td>
                      <Link href={`/invoices/${invoice.id}`}>{invoice.number ?? "Draft"}</Link>
                    </td>
                    <td>{KIND_LABEL[invoice.kind]}</td>
                    <td className="small">
                      {invoice.stageLabel}
                      {invoice.plannedOn ? ` · planned ${invoice.plannedOn}` : ""}
                    </td>
                    <td>
                      <StatusPill status={invoiceState(invoice, today)} />
                    </td>
                    <td className="right">
                      <Money cents={invoice.totalCents} />
                    </td>
                    <td className="right">
                      <Money cents={invoice.paidCents} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Variations</h2>
        {detail.variations.length > 0 ? (
          <div className="table-wrap">
            <table>
              <tbody>
                {detail.variations.map((variation) => (
                  <tr key={variation.id}>
                    <td className="mono">{variation.number ?? "Draft"}</td>
                    <td>{variation.description}</td>
                    <td>
                      <StatusPill status={variation.status} />
                    </td>
                    <td className="right">
                      <Money cents={variation.totalCents} />
                    </td>
                    <td className="right">
                      {variation.status === "draft" ? (
                        <form action={sendVariationAction.bind(null, job.id, variation.id)}>
                          <SubmitButton pendingLabel="Sending…">Send for sign-off</SubmitButton>
                        </form>
                      ) : variation.approvedByName ? (
                        <span className="small muted">Signed by {variation.approvedByName}</span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        <form
          action={createVariationAction.bind(null, job.id)}
          className="stack"
          style={{ marginTop: 12 }}
        >
          <div className="row">
            <div className="field" style={{ gridColumn: "span 2" }}>
              <label htmlFor="description">New variation</label>
              <input
                id="description"
                name="description"
                type="text"
                placeholder="Move toilet waste 600mm"
                required
              />
            </div>
            <div className="field">
              <label htmlFor="amount">Amount (excl. GST)</label>
              <input id="amount" name="amount" type="text" inputMode="decimal" required />
            </div>
          </div>
          <div>
            <SubmitButton>Save variation</SubmitButton>
          </div>
        </form>
      </section>
    </>
  );
}
