/**
 * Payment notifications from the payments provider. The body must be signed
 * with PAYMENT_WEBHOOK_SECRET (header `x-signature: sha256=<hex>`). Repeated
 * notifications are safe: each event id is processed once.
 */
import { getDb } from "@/db/client";
import { verifySignature } from "@/lib/webhooks";
import { paymentEventSchema, recordPaymentEvent } from "@/services/payments";

export async function POST(request: Request) {
  const rawBody = await request.text();
  const secret = process.env.PAYMENT_WEBHOOK_SECRET ?? "";
  if (!verifySignature(rawBody, request.headers.get("x-signature"), secret)) {
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: "Body must be JSON" }, { status: 400 });
  }
  const parsed = paymentEventSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid payment event", issues: parsed.error.issues.map((i) => i.message) },
      { status: 400 },
    );
  }
  const outcome = await recordPaymentEvent(await getDb(), parsed.data);
  return Response.json({ outcome });
}
