import Link from "next/link";
import { Flash, PageHead, StatusPill } from "@/components/ui";
import { getDb } from "@/db/client";
import { requireUser } from "@/lib/auth";
import { listJobs } from "@/services/jobs";

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const user = await requireUser();
  const rows = await listJobs(await getDb(), user.businessId);
  const params = await searchParams;
  return (
    <>
      <PageHead title="Jobs" sub={`${rows.length} job${rows.length === 1 ? "" : "s"}`}>
        {user.role === "owner" ? (
          <Link href="/jobs/new" className="button primary">
            New job
          </Link>
        ) : null}
      </PageHead>
      <Flash params={params} />
      <div className="card table-wrap">
        {rows.length === 0 ? (
          <p className="muted">No jobs yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Job</th>
                <th>Customer</th>
                <th>Site</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ job, customerName }) => (
                <tr key={job.id}>
                  <td>
                    <Link href={`/jobs/${job.id}`}>{job.title}</Link>
                  </td>
                  <td>{customerName}</td>
                  <td className="small">{job.siteAddress}</td>
                  <td>
                    <StatusPill status={job.status} />
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
