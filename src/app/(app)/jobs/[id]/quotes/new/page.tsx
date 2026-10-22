import { createQuoteAction, draftLinesAction } from "@/app/actions/documents";
import { DocumentEditor } from "@/components/DocumentEditor";
import { BackLink, Flash, PageHead } from "@/components/ui";
import { getDb } from "@/db/client";
import { aiConfigured } from "@/integrations/ai/draft";
import { requireOwner } from "@/lib/auth";
import { getBusiness, listPriceItems } from "@/services/directory";
import { getJob } from "@/services/jobs";

export default async function NewQuotePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await requireOwner();
  const { id } = await params;
  const db = await getDb();
  const [job, business, priceItems] = await Promise.all([
    getJob(db, user.businessId, id),
    getBusiness(db, user.businessId),
    listPriceItems(db, user.businessId),
  ]);
  return (
    <>
      <BackLink href={`/jobs/${job.id}`} label={job.title} />
      <PageHead
        title="New quote"
        sub={
          aiConfigured()
            ? "Describe the job and draft lines with AI, or add them yourself."
            : "AI is off: drafting uses keyword matching against your price list."
        }
      />
      <Flash params={await searchParams} />
      <div className="card">
        <DocumentEditor
          action={createQuoteAction.bind(null, job.id)}
          draftAction={draftLinesAction.bind(null, job.id)}
          priceItems={priceItems}
          initialLines={[]}
          gstRegistered={business.gstRegistered}
          submitLabel="Save draft quote"
        >
          <div className="field">
            <label htmlFor="notes">Notes for the customer</label>
            <textarea id="notes" name="notes" placeholder="Inclusions, exclusions, timing" />
          </div>
        </DocumentEditor>
      </div>
    </>
  );
}
