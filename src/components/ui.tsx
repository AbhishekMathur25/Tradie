/**
 * Small presentational pieces shared by pages. Server components.
 */
import Link from "next/link";
import { formatCents } from "@/domain/money";
import { RULES, type RuleResult } from "@/domain/rules";

/** Shows `?error=` and `?notice=` messages set by server actions. */
export function Flash({ params }: { params: { error?: string; notice?: string } }) {
  return (
    <>
      {params.error ? (
        <div className="flash error" role="alert">
          {params.error}
        </div>
      ) : null}
      {params.notice ? (
        <div className="flash notice" role="status">
          {params.notice}
        </div>
      ) : null}
    </>
  );
}

export function PageHead({
  title,
  sub,
  children,
}: {
  title: string;
  sub?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {sub ? <div className="sub">{sub}</div> : null}
      </div>
      {children ? <div className="actions">{children}</div> : null}
    </div>
  );
}

const STATUS_TONE: Record<string, string> = {
  draft: "",
  sent: "info",
  accepted: "good",
  approved: "good",
  paid: "good",
  declined: "bad",
  void: "bad",
  quoting: "",
  contracted: "info",
  in_progress: "warn",
  completed: "good",
  cancelled: "bad",
  overdue: "bad",
  "part paid": "warn",
};

export function StatusPill({ status }: { status: string }) {
  return <span className={`pill ${STATUS_TONE[status] ?? ""}`}>{status.replace("_", " ")}</span>;
}

export function Money({ cents }: { cents: number }) {
  return <span className="num">{formatCents(cents)}</span>;
}

const SEVERITY_LABEL = { block: "Blocked", warn: "Check", info: "Note" } as const;

/** Rule check results with a link to each rule's source. */
export function RuleList({ results }: { results: RuleResult[] }) {
  if (results.length === 0) return <p className="muted small">No rule checks raised anything.</p>;
  return (
    <ul className="rules">
      {results.map((result, index) => {
        const rule = RULES[result.ruleId];
        return (
          <li key={`${result.ruleId}-${index}`} className={result.severity}>
            <b>{SEVERITY_LABEL[result.severity]}</b>
            {result.message}{" "}
            {rule.sourceUrl ? (
              <a href={rule.sourceUrl} target="_blank" rel="noreferrer" className="small">
                Source
              </a>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="small">
      ← {label}
    </Link>
  );
}

/** Invoice status as a person would describe it. */
export function invoiceState(
  invoice: {
    status: string;
    paidCents: number;
    totalCents: number;
    dueOn: string | null;
  },
  today: string,
): string {
  if (invoice.status === "sent" && invoice.paidCents > 0) return "part paid";
  if (invoice.status === "sent" && invoice.dueOn && invoice.dueOn < today) return "overdue";
  return invoice.status;
}

export const KIND_LABEL: Record<string, string> = {
  deposit: "Deposit claim",
  progress: "Progress claim",
  final: "Final claim",
  standard: "Invoice",
};
