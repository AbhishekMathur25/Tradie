/**
 * Jobs and their contract position. A job is the record every document hangs
 * off: type the customer, site and contract once, reuse everywhere.
 */
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { DbOrTx } from "@/db/client";
import {
  CONTRACT_KINDS,
  JOB_STATUSES,
  customers,
  invoices,
  jobs,
  quotes,
  variations,
  type Job,
  type Quote,
  type Variation,
} from "@/db/schema";
import type { JobFacts } from "@/domain/rules";
import { UserFacingError } from "@/lib/errors";
import { getCustomer } from "./directory";
import { audit, type ActorContext } from "./support";

export const newJobSchema = z.object({
  customerId: z.string().uuid("Choose a customer"),
  title: z.string().trim().min(1, "Give the job a short name").max(120),
  siteAddress: z.string().trim().max(300),
  residentialBuildingWork: z.boolean(),
});

export async function createJob(db: DbOrTx, actor: ActorContext, input: z.infer<typeof newJobSchema>) {
  await getCustomer(db, actor.businessId, input.customerId); // ensures same business
  const [row] = await db
    .insert(jobs)
    .values({ ...input, businessId: actor.businessId })
    .returning();
  await audit(db, actor, "job.created", "job", row.id);
  return row;
}

export async function listJobs(db: DbOrTx, businessId: string) {
  return db
    .select({ job: jobs, customerName: customers.name })
    .from(jobs)
    .innerJoin(customers, eq(customers.id, jobs.customerId))
    .where(eq(jobs.businessId, businessId))
    .orderBy(desc(jobs.updatedAt));
}

export async function getJob(db: DbOrTx, businessId: string, jobId: string): Promise<Job> {
  const [row] = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.id, jobId), eq(jobs.businessId, businessId)))
    .limit(1);
  if (!row) throw new UserFacingError("Job not found.");
  return row;
}

/** Everything the job page shows, in one call. */
export async function getJobDetail(db: DbOrTx, businessId: string, jobId: string) {
  const job = await getJob(db, businessId, jobId);
  const [customer, jobQuotes, jobVariations, jobInvoices] = await Promise.all([
    getCustomer(db, businessId, job.customerId),
    db.select().from(quotes).where(eq(quotes.jobId, jobId)).orderBy(desc(quotes.createdAt)),
    db.select().from(variations).where(eq(variations.jobId, jobId)).orderBy(desc(variations.createdAt)),
    db.select().from(invoices).where(eq(invoices.jobId, jobId)).orderBy(desc(invoices.createdAt)),
  ]);
  return { job, customer, quotes: jobQuotes, variations: jobVariations, invoices: jobInvoices };
}

/** The facts the NSW rule checks need, built from a job and its documents. */
export function jobFacts(job: Job, jobQuotes: Quote[], jobVariations: Variation[]): JobFacts {
  const accepted = jobQuotes.find((quote) => quote.status === "accepted");
  return {
    residentialBuildingWork: job.residentialBuildingWork,
    contractPriceCents: job.contractPriceCents,
    contractSignedOn: job.contractSignedOn,
    insuranceCertificateNumber: job.insuranceCertificateNumber,
    acceptedQuoteTotalCents: accepted?.totalCents ?? null,
    approvedVariationsCents: jobVariations
      .filter((variation) => variation.status === "approved")
      .reduce((sum, variation) => sum + variation.totalCents, 0),
  };
}

export async function loadJobFacts(db: DbOrTx, businessId: string, jobId: string) {
  const detail = await getJobDetail(db, businessId, jobId);
  return { ...detail, facts: jobFacts(detail.job, detail.quotes, detail.variations) };
}

export const contractSchema = z.object({
  contractPriceCents: z.number().int().positive().nullable(),
  contractKind: z.enum(CONTRACT_KINDS).nullable(),
  contractSignedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  insuranceCertificateNumber: z.string().trim().max(60).nullable(),
  insuranceCertificateOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
});

/** Records the signed contract and insurance certificate details. */
export async function updateContract(
  db: DbOrTx,
  actor: ActorContext,
  jobId: string,
  input: z.infer<typeof contractSchema>,
): Promise<void> {
  const job = await getJob(db, actor.businessId, jobId);
  if (input.contractSignedOn && input.contractPriceCents === null) {
    throw new UserFacingError("Enter the contract price as well as the date it was signed.");
  }
  const status = input.contractSignedOn && job.status === "quoting" ? "contracted" : job.status;
  await db
    .update(jobs)
    .set({ ...input, status, updatedAt: new Date() })
    .where(eq(jobs.id, job.id));
  await audit(db, actor, "job.contract_updated", "job", job.id, {
    contractPriceCents: input.contractPriceCents,
    contractSignedOn: input.contractSignedOn,
    insuranceRecorded: Boolean(input.insuranceCertificateNumber),
  });
}

export async function setJobStatus(
  db: DbOrTx,
  actor: ActorContext,
  jobId: string,
  status: (typeof JOB_STATUSES)[number],
  today: string,
): Promise<void> {
  const job = await getJob(db, actor.businessId, jobId);
  await db
    .update(jobs)
    .set({ status, completedOn: status === "completed" ? today : null, updatedAt: new Date() })
    .where(eq(jobs.id, job.id));
  await audit(db, actor, "job.status_changed", "job", job.id, { from: job.status, to: status });
}

export async function touchJob(db: DbOrTx, jobId: string): Promise<void> {
  await db.update(jobs).set({ updatedAt: new Date() }).where(eq(jobs.id, jobId));
}
