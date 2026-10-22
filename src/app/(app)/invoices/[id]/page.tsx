import Link from "next/link";
import { eq } from "drizzle-orm";
import {
  sendInvoiceAction,
  sendReminderAction,
  updateInvoiceAction,
  voidInvoiceAction,
} from "@/app/actions/documents";
import { ConfirmButton, SubmitButton } from "@/components/buttons";
import { DocumentEditor } from "@/components/DocumentEditor";
import {
  BackLink,
  Flash,
  KIND_LABEL,
  Money,
  PageHead,
  RuleList,
  StatusPill,
  invoiceState,
} from "@/components/ui";
import { getDb } from "@/db/client";
import { payments } from "@/db/schema";
import { todayIso } from "@/domain/dashboard";
import { formatDate } from "@/domain/dates";
import { isBlockedLabel } from "@/lib/display";
import { requireOwner } from "@/lib/auth";
import { getBusiness, listPriceItems } from "@/services/directory";
import { getInvoice, invoiceChecks } from "@/services/documents";
import { getJob } from "@/services/jobs";
import { customerUrl, linkFor } from "@/services/support";

export default async function InvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const user = await requireOwner();
  const { id } = await params;
  const db = await getDb();
  const invoice = await getInvoice(db, user.businessId, id);
  const [job, business, priceItems, checks, invoicePayments] = await Promise.all([
    getJob(db, user.businessId, invoice.jobId),
    getBusiness(db, user.businessId),
    listPriceItems(db, user.businessId),
    invoice.status === "draft"
      ? invoiceChecks(db, user.businessId, invoice.id)
      : Promise.resolve([]),
    db.select().from(payments).where(eq(payments.invoiceId, invoice.id)),
  ]);
  const today = todayIso();
  const outstanding = invoice.totalCents - invoice.paidCents;
  const editable =
    invoice.status === "draft" || (invoice.status === "sent" && invoice.paidCents === 0);
  const link =
    invoice.status === "draft" || invoice.status === "void"
      ? null
      : customerUrl(await linkFor(db, user.businessId, "invoice", invoice.id));
  const title = invoice.number ?? `Draft ${KIND_LABEL[invoice.kind].toLowerCase()}`;

  return (
    <>
      <BackLink href={`/jobs/${job.id}`} label={job.title} />
      <PageHead
        title={title}
        sub={
          <>
            {KIND_LABEL[invoice.kind]}
            {invoice.stageLabel ? ` · ${invoice.stageLabel}` : ""} ·{" "}
            <StatusPill status={invoiceState(invoice, today)} />
          </>
        }
      >
        <a
          className="button"
          href={`/api/documents/invoice/${invoice.id}`}
          target="_blank"
          rel="noreferrer"
        >
          PDF
        </a>
        {invoice.status === "sent" && outstanding > 0 ? (
          <form action={sendReminderAction.bind(null, invoice.id)}>
            <SubmitButton pendingLabel="Queuing…">Send reminder</SubmitButton>
          </form>
        ) : null}
        {invoice.paidCents === 0 && invoice.status !== "void" ? (
          <form action={voidInvoiceAction.bind(null, invoice.id)}>
            <ConfirmButton message="Void this invoice? It can't be undone.">Void</ConfirmButton>
          </form>
        ) : null}
      </PageHead>
      <Flash params={await searchParams} />

      {invoice.status === "draft" ? (
        <section className="card">
          <h2>Before you send</h2>
          <RuleList results={checks} />
          <form action={sendInvoiceAction.bind(null, invoice.id)} style={{ marginTop: 12 }}>
            <SubmitButton className="primary" pendingLabel="Sending…">
              {isBlockedLabel(checks, `Send ${KIND_LABEL[invoice.kind].toLowerCase()}`)}
            </SubmitButton>
          </form>
        </section>
      ) : (
        <div className="grid-2">
          <section className="card">
            <h2>Payment</h2>
            <p>
              Total <Money cents={invoice.totalCents} /> · paid <Money cents={invoice.paidCents} />{" "}
              · outstanding{" "}
              <b>
                <Money cents={Math.max(outstanding, 0)} />
              </b>
            </p>
            <p className="small">
              Sent {formatDate(invoice.sentAt)} · due {formatDate(invoice.dueOn)}
            </p>
            <p className="small">
              PayID <span className="mono">{invoice.payId}</span> · reference{" "}
              <span className="mono">{invoice.paymentReference}</span>
            </p>
            <p className="banner-sim">
              Prototype: PayID and payments are simulated. No real money moves.
            </p>
            {link ? (
              <p className="small">
                Customer link: <Link href={link.replace(/^https?:\/\/[^/]+/, "")}>{link}</Link>
              </p>
            ) : null}
          </section>
          <section className="card">
            <h2>Payments received</h2>
            {invoicePayments.length === 0 ? (
              <p className="muted small">None yet.</p>
            ) : (
              <table>
                <tbody>
                  {invoicePayments.map((payment) => (
                    <tr key={payment.id}>
                      <td className="small">{formatDate(payment.receivedAt)}</td>
                      <td className="small">{payment.method}</td>
                      <td className="right">
                        <Money cents={payment.amountCents} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      )}

      {editable ? (
        <section className="card">
          <h2>{invoice.status === "draft" ? "Edit" : "Edit sent invoice"}</h2>
          {invoice.status === "sent" ? (
            <p className="small muted">
              Allowed until a payment is recorded. Saving re-runs the checks and updates the
              accounting record.
            </p>
          ) : null}
          <DocumentEditor
            action={updateInvoiceAction.bind(null, invoice.id)}
            priceItems={priceItems}
            initialLines={invoice.lines}
            gstRegistered={invoice.status === "draft" ? business.gstRegistered : invoice.taxInvoice}
            hidden={{ version: String(invoice.version), kind: invoice.kind }}
            submitLabel="Save changes"
          >
            <div className="row">
              <div className="field">
                <label htmlFor="stageLabel">Stage</label>
                <input
                  id="stageLabel"
                  name="stageLabel"
                  type="text"
                  defaultValue={invoice.stageLabel}
                />
              </div>
              {invoice.status === "draft" ? (
                <div className="field">
                  <label htmlFor="plannedOn">Planned send date</label>
                  <input
                    id="plannedOn"
                    name="plannedOn"
                    type="date"
                    defaultValue={invoice.plannedOn ?? ""}
                  />
                </div>
              ) : null}
            </div>
            <div className="field">
              <label htmlFor="notes">Notes</label>
              <textarea id="notes" name="notes" defaultValue={invoice.notes} />
            </div>
          </DocumentEditor>
        </section>
      ) : invoice.paidCents > 0 ? (
        <p className="small muted">
          A payment has been recorded, so this invoice is locked. Changes need a credit note (coming
          next).
        </p>
      ) : null}
    </>
  );
}
