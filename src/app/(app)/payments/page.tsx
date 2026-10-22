import Link from "next/link";
import { matchPaymentAction, simulateBankTransferAction } from "@/app/actions/money";
import { SubmitButton } from "@/components/buttons";
import { Flash, Money, PageHead } from "@/components/ui";
import { getDb } from "@/db/client";
import { formatDate } from "@/domain/dates";
import { formatCents } from "@/domain/money";
import { requireOwner } from "@/lib/auth";
import { listOpenInvoices, listPayments } from "@/services/payments";

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const user = await requireOwner();
  const db = await getDb();
  const [rows, openInvoices] = await Promise.all([
    listPayments(db, user.businessId),
    listOpenInvoices(db, user.businessId),
  ]);
  const unmatched = rows.filter(({ payment }) => payment.invoiceId === null);
  const matched = rows.filter(({ payment }) => payment.invoiceId !== null);

  return (
    <>
      <PageHead
        title="Payments"
        sub="Payments are matched to invoices by their PayID or reference."
      />
      <Flash params={await searchParams} />
      <p className="banner-sim">
        Prototype: the payments provider is simulated. Use the test transfer form to try matching.
      </p>

      <section className="card">
        <h2>To match ({unmatched.length})</h2>
        {unmatched.length === 0 ? (
          <p className="muted small">Every payment is matched.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Received</th>
                  <th>From</th>
                  <th>Reference given</th>
                  <th className="right">Amount</th>
                  <th>Match to</th>
                </tr>
              </thead>
              <tbody>
                {unmatched.map(({ payment }) => (
                  <tr key={payment.id}>
                    <td className="small">{formatDate(payment.receivedAt)}</td>
                    <td>{payment.payerName}</td>
                    <td className="mono">{payment.reference || "(none)"}</td>
                    <td className="right">
                      <Money cents={payment.amountCents} />
                    </td>
                    <td>
                      <form action={matchPaymentAction.bind(null, payment.id)} className="actions">
                        <select name="invoiceId" defaultValue="" aria-label="Invoice">
                          <option value="" disabled>
                            Choose invoice
                          </option>
                          {openInvoices.map((invoice) => (
                            <option key={invoice.id} value={invoice.id}>
                              {invoice.number} · owing{" "}
                              {formatCents(invoice.totalCents - invoice.paidCents)}
                            </option>
                          ))}
                        </select>
                        <SubmitButton>Match</SubmitButton>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Matched</h2>
        {matched.length === 0 ? (
          <p className="muted small">No payments yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Received</th>
                  <th>Invoice</th>
                  <th>Job</th>
                  <th>Method</th>
                  <th className="right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {matched.map(({ payment, invoiceNumber, jobTitle }) => (
                  <tr key={payment.id}>
                    <td className="small">{formatDate(payment.receivedAt)}</td>
                    <td>
                      <Link href={`/invoices/${payment.invoiceId}`}>{invoiceNumber}</Link>
                    </td>
                    <td className="small">{jobTitle}</td>
                    <td className="small">{payment.method}</td>
                    <td className="right">
                      <Money cents={payment.amountCents} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <form action={simulateBankTransferAction} className="card stack">
        <h2>Test bank transfer</h2>
        <p className="small muted">
          Pretend a customer paid by bank transfer. Use an invoice&apos;s reference to see automatic
          matching, or anything else to see it land in &quot;To match&quot;.
        </p>
        <div className="row">
          <div className="field">
            <label htmlFor="amount">Amount (incl. GST)</label>
            <input id="amount" name="amount" type="text" inputMode="decimal" required />
          </div>
          <div className="field">
            <label htmlFor="reference">Reference</label>
            <input id="reference" name="reference" type="text" placeholder="e.g. TABC23456" />
          </div>
          <div className="field">
            <label htmlFor="payerName">Payer name</label>
            <input id="payerName" name="payerName" type="text" />
          </div>
        </div>
        <div>
          <SubmitButton>Receive test transfer</SubmitButton>
        </div>
      </form>
    </>
  );
}
