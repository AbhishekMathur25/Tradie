import Link from "next/link";
import { sendWeeklySummaryAction } from "@/app/actions/money";
import { SubmitButton } from "@/components/buttons";
import { Flash, PageHead } from "@/components/ui";
import { getDb } from "@/db/client";
import { todayIso } from "@/domain/dashboard";
import { formatDate } from "@/domain/dates";
import { formatWholeDollars } from "@/domain/money";
import { requireOwner } from "@/lib/auth";
import { loadDashboard } from "@/services/dashboard";

/**
 * Owner dashboard, safe-MVP version: facts from the business's own records.
 * Every amount is labelled incl. or excl. GST and links to the records behind it.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const user = await requireOwner();
  const today = todayIso();
  const dash = await loadDashboard(await getDb(), user.businessId, today);
  const params = await searchParams;

  return (
    <>
      <PageHead title="Today" sub={`${formatDate(today)} · amounts include GST unless marked`}>
        <form action={sendWeeklySummaryAction}>
          <SubmitButton pendingLabel="Queuing…">Email weekly summary</SubmitButton>
        </form>
      </PageHead>
      <Flash params={params} />

      <div className="strip">
        <b>
          GST on invoices sent · {dash.gstOnInvoicesThisQuarter.label}:{" "}
          {formatWholeDollars(dash.gstOnInvoicesThisQuarter.cents)}
        </b>
        <span className="muted small">
          The total GST shown on your own invoices. Your BAS figures come from Xero or your
          bookkeeper.
        </span>
      </div>

      <div className="grid-4">
        <Link href="/invoices?filter=unpaid" className="tile">
          <div className="label">Owed to you</div>
          <div className="value">{formatWholeDollars(dash.owed.totalCents)}</div>
          <div className={`note ${dash.owed.overdueCount > 0 ? "bad" : ""}`}>
            {dash.owed.overdueCount > 0
              ? `${formatWholeDollars(dash.owed.overdueCents)} overdue · ${dash.owed.overdueCount}`
              : `${dash.owed.count} unpaid, none overdue`}
          </div>
        </Link>
        <Link href="/invoices" className="tile">
          <div className="label">Coming in · 30 days (forecast)</div>
          <div className="value">{formatWholeDollars(dash.comingIn30.totalCents)}</div>
          <div className="note">
            {plural(dash.comingIn30.invoiceCount, "invoice")} due,{" "}
            {plural(dash.comingIn30.plannedClaimCount, "planned claim")}
          </div>
        </Link>
        <Link href="/payments" className="tile">
          <div className="label">Received this month</div>
          <div className="value">{formatWholeDollars(dash.receivedThisMonthCents)}</div>
          <div className="note">{plural(dash.doneThisMonth.paymentsReceived, "payment")}</div>
        </Link>
        <Link href="/jobs" className="tile">
          <div className="label">Quotes won · 90 days</div>
          <div className="value">
            {dash.quotesWon90.won} of {dash.quotesWon90.sent}
          </div>
          <div className="note">{formatWholeDollars(dash.quotesWon90.wonValueCents)} of work</div>
        </Link>
      </div>

      <div className="grid-2">
        <section className="card">
          <h2>Needs you ({dash.needsYou.length})</h2>
          {dash.needsYou.length === 0 ? (
            <p className="muted">Nothing waiting on you.</p>
          ) : (
            <ul className="todo">
              {dash.needsYou.map((item) => (
                <li key={item.title} className={item.severity}>
                  <Link href={item.href}>{item.title}</Link>
                  <span>{item.detail}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <h2>Jobs on contract</h2>
          {dash.jobPositions.length === 0 ? (
            <p className="muted">No won or active jobs yet.</p>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              {dash.jobPositions.map((job) => {
                const paidPct =
                  job.contractCents > 0 ? (job.paidCents / job.contractCents) * 100 : 0;
                const owedPct =
                  job.contractCents > 0 ? (job.owedCents / job.contractCents) * 100 : 0;
                return (
                  <div key={job.jobId}>
                    <div className="actions" style={{ justifyContent: "space-between" }}>
                      <Link href={`/jobs/${job.jobId}`}>
                        <b>{job.title}</b>
                      </Link>
                      <span className="num">{formatWholeDollars(job.contractCents)}</span>
                    </div>
                    <div className="bar" aria-hidden="true">
                      <i className="paid" style={{ width: `${Math.min(paidPct, 100)}%` }} />
                      <i
                        className="owed"
                        style={{ width: `${Math.min(owedPct, 100 - paidPct)}%` }}
                      />
                    </div>
                    <div className="small muted num">
                      {job.blockedReason ? (
                        <span style={{ color: "var(--bad)", fontWeight: 600 }}>
                          Payments blocked: {job.blockedReason}
                        </span>
                      ) : (
                        <>
                          Paid {formatWholeDollars(job.paidCents)} · Owed{" "}
                          {formatWholeDollars(job.owedCents)} · Left to claim{" "}
                          {formatWholeDollars(job.leftToClaimCents)}
                          {job.pendingVariationsCents > 0
                            ? ` · +${formatWholeDollars(job.pendingVariationsCents)} pending`
                            : ""}
                          {job.quotedMarginPercent !== null
                            ? ` · Quoted margin ${job.quotedMarginPercent}% (excl. GST)`
                            : ""}
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      <section className="card">
        <h2>Done this month</h2>
        <div className="grid-4">
          <div>
            <div className="muted small">Jobs finished</div>
            <b className="num">{dash.doneThisMonth.jobsFinished}</b>
          </div>
          <div>
            <div className="muted small">Invoices and claims sent</div>
            <b className="num">{dash.doneThisMonth.invoicesSent}</b>
          </div>
          <div>
            <div className="muted small">Quotes won</div>
            <b className="num">{dash.doneThisMonth.quotesWon}</b>
          </div>
          <div>
            <div className="muted small">Payments received</div>
            <b className="num">{dash.doneThisMonth.paymentsReceived}</b>
          </div>
        </div>
        {dash.averageQuotedMarginPercent !== null ? (
          <p className="small muted" style={{ marginTop: 10 }}>
            Average quoted margin on active jobs: {dash.averageQuotedMarginPercent}% (excl. GST,
            from price list costs; actual profit needs cost tracking, which comes later).
          </p>
        ) : null}
      </section>
    </>
  );
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
