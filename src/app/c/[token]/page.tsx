import { notFound } from "next/navigation";
import {
  respondToQuoteAction,
  respondToVariationAction,
  simulateCustomerPaymentAction,
} from "@/app/actions/customer";
import { SubmitButton } from "@/components/buttons";
import { Flash, Money } from "@/components/ui";
import { getDb } from "@/db/client";
import { formatDate } from "@/domain/dates";
import { formatQuantity, lineAmountCents, type Line } from "@/domain/money";
import { getBusiness, getCustomer } from "@/services/directory";
import { getInvoice, getQuote, getVariation } from "@/services/documents";
import { getJob } from "@/services/jobs";
import { resolveCustomerLink } from "@/services/support";

/** What a customer sees from their link: view, accept or approve, and pay. */
export default async function CustomerDocumentPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const { token } = await params;
  const db = await getDb();
  const link = await resolveCustomerLink(db, token);
  if (!link) notFound();
  const business = await getBusiness(db, link.businessId);
  const flash = await searchParams;

  if (link.kind === "variation") {
    const variation = await getVariation(db, link.businessId, link.targetId);
    const job = await getJob(db, link.businessId, variation.jobId);
    return (
      <Shell business={business.name} flash={flash}>
        <h1>Variation {variation.number}</h1>
        <p className="muted">{job.title}</p>
        <div className="card">
          <p>{variation.description}</p>
          <p>
            Amount <Money cents={variation.amountCents} /> + GST{" "}
            <Money cents={variation.gstCents} /> ={" "}
            <b>
              <Money cents={variation.totalCents} />
            </b>
          </p>
        </div>
        {variation.status === "sent" ? (
          <form action={respondToVariationAction.bind(null, token)} className="card stack">
            <Agreement verb="approve" />
            <div className="actions">
              <SubmitButton className="primary" name="decision" value="approve">
                Approve variation
              </SubmitButton>
              <SubmitButton name="decision" value="decline">
                Decline
              </SubmitButton>
            </div>
          </form>
        ) : (
          <p className="card">
            This variation is <b>{variation.status}</b>
            {variation.approvedByName
              ? ` by ${variation.approvedByName} on ${formatDate(variation.approvedAt)}`
              : ""}
            .
          </p>
        )}
      </Shell>
    );
  }

  if (link.kind === "quote") {
    const quote = await getQuote(db, link.businessId, link.targetId);
    const job = await getJob(db, link.businessId, quote.jobId);
    const customer = await getCustomer(db, link.businessId, job.customerId);
    return (
      <Shell business={business.name} flash={flash}>
        <h1>Quote {quote.number}</h1>
        <p className="muted">
          {job.title} · for {customer.name} · valid until {formatDate(quote.validUntil)}
        </p>
        <LinesCard
          lines={quote.lines}
          subtotal={quote.subtotalCents}
          gst={quote.gstCents}
          total={quote.totalCents}
          notes={quote.notes}
          pdfHref={`/c/${token}/pdf`}
        />
        {quote.status === "sent" ? (
          <form action={respondToQuoteAction.bind(null, token)} className="card stack">
            <Agreement verb="accept" />
            {job.residentialBuildingWork && quote.totalCents > 500_000 ? (
              <p className="small muted">
                For work over $5,000 you&apos;ll also sign a written home building contract before
                any deposit is due.
              </p>
            ) : null}
            <div className="actions">
              <SubmitButton className="primary" name="decision" value="accept">
                Accept quote
              </SubmitButton>
              <SubmitButton name="decision" value="decline">
                Decline
              </SubmitButton>
            </div>
          </form>
        ) : (
          <p className="card">
            This quote is <b>{quote.status}</b>
            {quote.acceptedByName
              ? ` by ${quote.acceptedByName} on ${formatDate(quote.acceptedAt)}`
              : ""}
            .
          </p>
        )}
      </Shell>
    );
  }

  const invoice = await getInvoice(db, link.businessId, link.targetId);
  const job = await getJob(db, link.businessId, invoice.jobId);
  const outstanding = invoice.totalCents - invoice.paidCents;
  return (
    <Shell business={business.name} flash={flash}>
      <h1>
        {invoice.taxInvoice ? "Tax invoice" : "Invoice"} {invoice.number}
      </h1>
      <p className="muted">
        {job.title}
        {invoice.stageLabel ? ` · ${invoice.stageLabel}` : ""} · due {formatDate(invoice.dueOn)}
      </p>
      <LinesCard
        lines={invoice.lines}
        subtotal={invoice.subtotalCents}
        gst={invoice.gstCents}
        total={invoice.totalCents}
        notes={invoice.notes}
        pdfHref={`/c/${token}/pdf`}
      />
      {invoice.status === "sent" && outstanding > 0 ? (
        <section className="card stack">
          <h2>
            Pay <Money cents={outstanding} />
          </h2>
          <p>
            PayID <span className="mono">{invoice.payId}</span>
            <br />
            Reference <span className="mono">{invoice.paymentReference}</span>
          </p>
          {business.bankBsb && business.bankAccountNumber ? (
            <p className="small">
              Or bank transfer to {business.bankAccountName}, BSB {business.bankBsb}, account{" "}
              {business.bankAccountNumber}, using the reference above.
            </p>
          ) : null}
          <p className="small muted">
            Your bank app shows the business name when you pay a PayID. Check it says{" "}
            {business.name}.
          </p>
          {process.env.PAYMENTS_MODE !== "live" ? (
            <form action={simulateCustomerPaymentAction.bind(null, token)}>
              <p className="banner-sim">
                Prototype: this button makes a test payment. No real money moves.
              </p>
              <SubmitButton className="primary" pendingLabel="Paying…">
                Make test payment
              </SubmitButton>
            </form>
          ) : null}
        </section>
      ) : (
        <p className="card">
          {invoice.status === "paid"
            ? "Paid in full. Thank you."
            : `This invoice is ${invoice.status}.`}
        </p>
      )}
    </Shell>
  );
}

function Shell({
  business,
  flash,
  children,
}: {
  business: string;
  flash: { error?: string; notice?: string };
  children: React.ReactNode;
}) {
  return (
    <>
      <div className="tape" />
      <main className="doc">
        <p className="small muted">{business}</p>
        <Flash params={flash} />
        {children}
      </main>
    </>
  );
}

function Agreement({ verb }: { verb: "accept" | "approve" }) {
  return (
    <>
      <div className="field">
        <label htmlFor="name">Your full name</label>
        <input id="name" name="name" type="text" autoComplete="name" />
      </div>
      <label className="check">
        <input type="checkbox" name="agree" />
        <span>I {verb} this and understand it is recorded with my name and the date.</span>
      </label>
    </>
  );
}

function LinesCard({
  lines,
  subtotal,
  gst,
  total,
  notes,
  pdfHref,
}: {
  lines: Line[];
  subtotal: number;
  gst: number;
  total: number;
  notes: string;
  pdfHref: string;
}) {
  return (
    <section className="card">
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Description</th>
              <th className="right">Qty</th>
              <th className="right">Amount (ex GST)</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => (
              <tr key={index}>
                <td>{line.description}</td>
                <td className="right num">{formatQuantity(line.quantityMilli)}</td>
                <td className="right">
                  <Money cents={lineAmountCents(line)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="totals" style={{ marginTop: 10 }}>
        <span>
          Subtotal <Money cents={subtotal} />
        </span>
        <span>
          GST <Money cents={gst} />
        </span>
        <span className="grand">
          Total <Money cents={total} />
        </span>
      </div>
      {notes ? <p style={{ whiteSpace: "pre-wrap", marginTop: 10 }}>{notes}</p> : null}
      <p className="small" style={{ marginTop: 10 }}>
        <a href={pdfHref} target="_blank" rel="noreferrer">
          Download PDF
        </a>
      </p>
    </section>
  );
}
