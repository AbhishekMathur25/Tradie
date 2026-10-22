"use server";

/** Jobs, contract details and variations. Owner only. */
import { getDb } from "@/db/client";
import { JOB_STATUSES } from "@/db/schema";
import { todayIso } from "@/domain/dashboard";
import { actorOf, requireOwner } from "@/lib/auth";
import { UserFacingError } from "@/lib/errors";
import { act, checkbox, dollars, optionalDate, text, withQuery } from "@/lib/forms";
import { createVariation, sendVariation, variationInputSchema } from "@/services/documents";
import {
  contractSchema,
  createJob,
  newJobSchema,
  setJobStatus,
  updateContract,
} from "@/services/jobs";

export async function createJobAction(form: FormData): Promise<void> {
  const user = await requireOwner();
  await act("/jobs/new", async () => {
    const input = newJobSchema.parse({
      customerId: text(form, "customerId"),
      title: text(form, "title"),
      siteAddress: text(form, "siteAddress"),
      residentialBuildingWork: checkbox(form, "residentialBuildingWork"),
    });
    const job = await createJob(await getDb(), actorOf(user), input);
    return `/jobs/${job.id}`;
  });
}

export async function updateContractAction(jobId: string, form: FormData): Promise<void> {
  const user = await requireOwner();
  const page = `/jobs/${jobId}`;
  await act(page, async () => {
    const kind = text(form, "contractKind");
    const input = contractSchema.parse({
      contractPriceCents: dollars(form, "contractPrice", "Contract price", true),
      contractKind: kind || null,
      contractSignedOn: optionalDate(form, "contractSignedOn"),
      insuranceCertificateNumber: text(form, "insuranceCertificateNumber") || null,
      insuranceCertificateOn: optionalDate(form, "insuranceCertificateOn"),
    });
    await updateContract(await getDb(), actorOf(user), jobId, input);
    return withQuery(page, { notice: "Contract details saved." });
  });
}

export async function setJobStatusAction(jobId: string, form: FormData): Promise<void> {
  const user = await requireOwner();
  const page = `/jobs/${jobId}`;
  await act(page, async () => {
    const status = text(form, "status");
    if (!(JOB_STATUSES as readonly string[]).includes(status))
      throw new UserFacingError("Choose a status.");
    await setJobStatus(
      await getDb(),
      actorOf(user),
      jobId,
      status as (typeof JOB_STATUSES)[number],
      todayIso(),
    );
    return withQuery(page, { notice: "Status updated." });
  });
}

export async function createVariationAction(jobId: string, form: FormData): Promise<void> {
  const user = await requireOwner();
  const page = `/jobs/${jobId}`;
  await act(page, async () => {
    const input = variationInputSchema.parse({
      description: text(form, "description"),
      amountCents: dollars(form, "amount", "Variation amount"),
    });
    await createVariation(await getDb(), actorOf(user), jobId, input);
    return withQuery(page, {
      notice: "Variation saved as a draft. Send it for sign-off when ready.",
    });
  });
}

export async function sendVariationAction(jobId: string, variationId: string): Promise<void> {
  const user = await requireOwner();
  const page = `/jobs/${jobId}`;
  await act(page, async () => {
    const { number } = await sendVariation(await getDb(), actorOf(user), variationId);
    return withQuery(page, { notice: `Variation ${number} sent for sign-off.` });
  });
}
