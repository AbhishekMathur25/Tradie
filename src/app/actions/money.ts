"use server";

/** Payments, simulated bank transfers and the weekly summary. Owner only. */
import { randomUUID } from "node:crypto";
import { getDb } from "@/db/client";
import { todayIso } from "@/domain/dashboard";
import { actorOf, requireOwner } from "@/lib/auth";
import { UserFacingError } from "@/lib/errors";
import { act, dollars, text, withQuery } from "@/lib/forms";
import { sendWeeklySummary } from "@/services/dashboard";
import { matchPayment, recordPaymentEvent } from "@/services/payments";

export async function matchPaymentAction(paymentId: string, form: FormData): Promise<void> {
  const user = await requireOwner();
  await act("/payments", async () => {
    const invoiceId = text(form, "invoiceId");
    if (!invoiceId) throw new UserFacingError("Choose the invoice this payment is for.");
    await matchPayment(await getDb(), actorOf(user), paymentId, invoiceId);
    return withQuery("/payments", { notice: "Payment matched." });
  });
}

/**
 * Prototype only: pretends the bank received a transfer, so matching can be
 * tried without a payments provider. Goes through the same code path as a
 * real provider notification.
 */
export async function simulateBankTransferAction(form: FormData): Promise<void> {
  const user = await requireOwner();
  await act("/payments", async () => {
    const outcome = await recordPaymentEvent(await getDb(), {
      eventId: `sim-${randomUUID()}`,
      businessId: user.businessId,
      amountCents: dollars(form, "amount", "Amount") as number,
      receivedAt: new Date().toISOString(),
      method: "bank",
      reference: text(form, "reference"),
      payerName: text(form, "payerName") || "Test payer",
    });
    const message =
      outcome === "matched"
        ? "Test transfer received and matched to its invoice."
        : "Test transfer received. No invoice matched its reference, so it's waiting below.";
    return withQuery("/payments", { notice: message });
  });
}

export async function sendWeeklySummaryAction(): Promise<void> {
  const user = await requireOwner();
  await act("/dashboard", async () => {
    const sent = await sendWeeklySummary(await getDb(), user.businessId, todayIso());
    return withQuery("/dashboard", {
      notice: `Weekly summary queued for ${sent} owner${sent === 1 ? "" : "s"}. See the Outbox.`,
    });
  });
}
