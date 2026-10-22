"use server";

/**
 * Actions taken by customers on their document link. No sign-in: the link's
 * long random token is the permission, and it's checked on every action.
 */
import { randomUUID } from "node:crypto";
import { getDb } from "@/db/client";
import { UserFacingError } from "@/lib/errors";
import { act, checkbox, text, withQuery } from "@/lib/forms";
import { getInvoice, respondToQuote, respondToVariation } from "@/services/documents";
import { recordPaymentEvent } from "@/services/payments";
import { resolveCustomerLink } from "@/services/support";

async function linkOrFail(token: string, kind: "quote" | "variation" | "invoice") {
  const link = await resolveCustomerLink(await getDb(), token);
  if (!link || link.kind !== kind)
    throw new UserFacingError("This link has expired or is not valid.");
  return link;
}

export async function respondToQuoteAction(token: string, form: FormData): Promise<void> {
  const page = `/c/${token}`;
  await act(page, async () => {
    const link = await linkOrFail(token, "quote");
    const decision = text(form, "decision") === "decline" ? "decline" : "accept";
    const name = text(form, "name");
    if (decision === "accept" && (!name || !checkbox(form, "agree"))) {
      throw new UserFacingError("Type your name and tick the box to accept.");
    }
    await respondToQuote(
      await getDb(),
      link.businessId,
      link.targetId,
      decision,
      name || "Customer",
    );
    return withQuery(page, {
      notice:
        decision === "accept" ? "Thanks, the quote is accepted." : "The quote has been declined.",
    });
  });
}

export async function respondToVariationAction(token: string, form: FormData): Promise<void> {
  const page = `/c/${token}`;
  await act(page, async () => {
    const link = await linkOrFail(token, "variation");
    const decision = text(form, "decision") === "decline" ? "decline" : "approve";
    const name = text(form, "name");
    if (decision === "approve" && (!name || !checkbox(form, "agree"))) {
      throw new UserFacingError("Type your name and tick the box to approve.");
    }
    await respondToVariation(
      await getDb(),
      link.businessId,
      link.targetId,
      decision,
      name || "Customer",
    );
    return withQuery(page, {
      notice:
        decision === "approve"
          ? "Thanks, the variation is approved."
          : "The variation has been declined.",
    });
  });
}

/** Prototype only: a test payment through the simulated PayID provider. */
export async function simulateCustomerPaymentAction(token: string): Promise<void> {
  const page = `/c/${token}`;
  await act(page, async () => {
    if (process.env.PAYMENTS_MODE === "live")
      throw new UserFacingError("Test payments are switched off.");
    const link = await linkOrFail(token, "invoice");
    const db = await getDb();
    const invoice = await getInvoice(db, link.businessId, link.targetId);
    const outstanding = invoice.totalCents - invoice.paidCents;
    if (invoice.status !== "sent" || outstanding <= 0)
      throw new UserFacingError("Nothing is owing on this invoice.");
    await recordPaymentEvent(db, {
      eventId: `sim-${randomUUID()}`,
      businessId: link.businessId,
      amountCents: outstanding,
      receivedAt: new Date().toISOString(),
      method: "payid",
      payId: invoice.payId ?? undefined,
      reference: invoice.paymentReference ?? "",
      payerName: "Customer (test payment)",
    });
    return withQuery(page, { notice: "Test payment received. No real money moved." });
  });
}
