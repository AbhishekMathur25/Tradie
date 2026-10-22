import Link from "next/link";
import { Flash, KIND_LABEL, Money, PageHead, StatusPill, invoiceState } from "@/components/ui";
import { getDb } from "@/db/client";
import { todayIso } from "@/domain/dashboard";
import { formatDate } from "@/domain/dates";
import { requireOwner } from "@/lib/auth";
import { listInvoices } from "@/services/documents";

const FILTERS = { all: "All", unpaid: "Unpaid", overdue: "Overdue", draft: "Drafts" } as const;

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; error?: string; notice?: string }>;
}) {
  const user = await requireOwner();
  const params = await searchParams;
  const filter = (
    params.filter && params.filter in FILTERS ? params.filter : "all"
  ) as keyof typeof FILTERS;
  const today = todayIso();
  const rows = (await listInvoices(await getDb(), user.businessId)).filter(({ invoice }) => {
    const state = invoiceState(invoice, today);
    if (filter === "unpaid") return invoice.status === "sent";
    if (filter === "overdue") return state === "overdue";
    if (filter === "draft") return invoice.status === "draft";
    return true;
  });

  return (
    <>
      <PageHead title="Invoices and claims">
        {Object.entries(FILTERS).map(([key, label]) => (
          <Link
            key={key}
            href={`/invoices?filter=${key}`}
            className={`button ${key === filter ? "primary" : ""}`}
          >
            {label}
          </Link>
        ))}
      </PageHead>
      <Flash params={params} />
      <div className="card table-wrap">
        {rows.length === 0 ? (
          <p className="muted">Nothing here.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Number</th>
                <th>Job</th>
                <th>Type</th>
                <th>Due</th>
                <th>Status</th>
                <th className="right">Total</th>
                <th className="right">Outstanding</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ invoice, jobTitle, customerName }) => (
                <tr key={invoice.id}>
                  <td>
                    <Link href={`/invoices/${invoice.id}`}>{invoice.number ?? "Draft"}</Link>
                  </td>
                  <td>
                    {jobTitle}
                    <div className="small muted">{customerName}</div>
                  </td>
                  <td className="small">
                    {KIND_LABEL[invoice.kind]}
                    {invoice.stageLabel ? ` · ${invoice.stageLabel}` : ""}
                  </td>
                  <td className="small">{formatDate(invoice.dueOn)}</td>
                  <td>
                    <StatusPill status={invoiceState(invoice, today)} />
                  </td>
                  <td className="right">
                    <Money cents={invoice.totalCents} />
                  </td>
                  <td className="right">
                    <Money
                      cents={invoice.status === "sent" ? invoice.totalCents - invoice.paidCents : 0}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
