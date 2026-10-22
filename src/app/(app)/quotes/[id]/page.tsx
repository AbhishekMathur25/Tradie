import Link from "next/link";
import { draftLinesAction, sendQuoteAction, updateQuoteAction } from "@/app/actions/documents";
import { SubmitButton } from "@/components/buttons";
import { DocumentEditor } from "@/components/DocumentEditor";
import { BackLink, Flash, Money, PageHead, RuleList, StatusPill } from "@/components/ui";
import { getDb } from "@/db/client";
import { formatDate } from "@/domain/dates";
import { formatQuantity, isBlockedLabel } from "@/lib/display";
import { requireOwner } from "@/lib/auth";
import { getBusiness, listPriceItems } from "@/services/directory";
import { getQuote, quoteChecks } from "@/services/documents";
import { getJob } from "@/services/jobs";
import { customerUrl, linkFor } from "@/services/support";

export default async function QuotePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const user = await requireOwner();
  const { id } = await params;
  const db = await getDb();
  const quote = await getQuote(db, user.businessId, id);
  const [job, business, priceItems, checks] = await Promise.all([
    getJob(db, user.businessId, quote.jobId),
    getBusiness(db, user.businessId),
    listPriceItems(db, user.businessId),
    quoteChecks(db, user.businessId, quote.id),
  ]);
  const link =
    quote.status !== "draft"
      ? customerUrl(await linkFor(db, user.businessId, "quote", quote.id))
      : null;

  return (
    <>
      <BackLink href={`/jobs/${job.id}`} label={job.title} />
      <PageHead title={quote.number ?? "Draft quote"} sub={<StatusPill status={quote.status} />}>
        <a
          className="button"
          href={`/api/documents/quote/${quote.id}`}
          target="_blank"
          rel="noreferrer"
        >
          PDF
        </a>
      </PageHead>
      <Flash params={await searchParams} />

      {quote.status === "draft" ? (
        <>
          <section className="card">
            <h2>Before you send</h2>
            <RuleList results={checks} />
            <form action={sendQuoteAction.bind(null, quote.id)} style={{ marginTop: 12 }}>
              <SubmitButton className="primary" pendingLabel="Sending…">
                {isBlockedLabel(checks, "Send quote")}
              </SubmitButton>
            </form>
          </section>
          <section className="card">
            <h2>Edit</h2>
            <DocumentEditor
              action={updateQuoteAction.bind(null, quote.id)}
              draftAction={draftLinesAction.bind(null, job.id)}
              priceItems={priceItems}
              initialLines={quote.lines}
              gstRegistered={business.gstRegistered}
              hidden={{ version: String(quote.version) }}
              submitLabel="Save changes"
            >
              <div className="field">
                <label htmlFor="notes">Notes for the customer</label>
                <textarea id="notes" name="notes" defaultValue={quote.notes} />
              </div>
            </DocumentEditor>
          </section>
        </>
      ) : (
        <section className="card">
          <p>
            Sent {formatDate(quote.sentAt)} · valid until {formatDate(quote.validUntil)}
            {quote.acceptedByName
              ? ` · accepted by ${quote.acceptedByName} on ${formatDate(quote.acceptedAt)}`
              : ""}
          </p>
          {link ? (
            <p className="small">
              Customer link: <Link href={link.replace(/^https?:\/\/[^/]+/, "")}>{link}</Link>
            </p>
          ) : null}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Description</th>
                  <th className="right">Qty</th>
                  <th className="right">Unit (ex GST)</th>
                </tr>
              </thead>
              <tbody>
                {quote.lines.map((line, index) => (
                  <tr key={index}>
                    <td>{line.description}</td>
                    <td className="right num">{formatQuantity(line.quantityMilli)}</td>
                    <td className="right">
                      <Money cents={line.unitPriceCents} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="totals" style={{ marginTop: 10 }}>
            <span>
              Subtotal <Money cents={quote.subtotalCents} />
            </span>
            <span>
              GST <Money cents={quote.gstCents} />
            </span>
            <span className="grand">
              Total <Money cents={quote.totalCents} />
            </span>
          </div>
          {quote.notes ? (
            <p style={{ marginTop: 10, whiteSpace: "pre-wrap" }}>{quote.notes}</p>
          ) : null}
        </section>
      )}
    </>
  );
}
