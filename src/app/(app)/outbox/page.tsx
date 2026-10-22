import { desc, eq } from "drizzle-orm";
import { PageHead } from "@/components/ui";
import { getDb } from "@/db/client";
import { accountingSyncLog, outboxMessages } from "@/db/schema";
import { formatDate } from "@/domain/dates";
import { formatCents } from "@/domain/money";
import { requireOwner } from "@/lib/auth";

/** What the app would have sent: emails, and pushes to accounting. */
export default async function OutboxPage() {
  const user = await requireOwner();
  const db = await getDb();
  const [messages, pushes] = await Promise.all([
    db
      .select()
      .from(outboxMessages)
      .where(eq(outboxMessages.businessId, user.businessId))
      .orderBy(desc(outboxMessages.createdAt))
      .limit(50),
    db
      .select()
      .from(accountingSyncLog)
      .where(eq(accountingSyncLog.businessId, user.businessId))
      .orderBy(desc(accountingSyncLog.createdAt))
      .limit(50),
  ]);
  return (
    <>
      <PageHead
        title="Outbox"
        sub="In the prototype nothing leaves this computer. Emails and accounting pushes are recorded here."
      />
      <div className="grid-2">
        <section className="card">
          <h2>Emails ({messages.length})</h2>
          {messages.length === 0 ? <p className="muted small">No emails yet.</p> : null}
          <div style={{ display: "grid", gap: 12 }}>
            {messages.map((message) => (
              <details key={message.id} className="card" style={{ padding: 12 }}>
                <summary>
                  <b>{message.subject}</b>
                  <div className="small muted">
                    To {message.toAddress} · {message.kind} · {formatDate(message.createdAt)}
                  </div>
                </summary>
                <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", margin: "10px 0 0" }}>
                  {message.body}
                </pre>
              </details>
            ))}
          </div>
        </section>
        <section className="card">
          <h2>Accounting pushes (simulated Xero)</h2>
          {pushes.length === 0 ? <p className="muted small">Nothing pushed yet.</p> : null}
          <table>
            <tbody>
              {pushes.map((push) => (
                <tr key={push.id}>
                  <td className="small">{formatDate(push.createdAt)}</td>
                  <td>{push.entityType}</td>
                  <td className="small">
                    {String(push.detail.action ?? "record")}{" "}
                    {String(push.detail.number ?? push.detail.invoiceNumber ?? "")}
                  </td>
                  <td className="right small num">
                    {typeof push.detail.amountCents === "number"
                      ? formatCents(push.detail.amountCents)
                      : typeof push.detail.totalCents === "number"
                        ? formatCents(push.detail.totalCents)
                        : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </>
  );
}
