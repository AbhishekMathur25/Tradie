/**
 * Signing and verifying payment-provider webhooks. The provider signs the raw
 * request body with a shared secret; we reject anything that doesn't match.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export function signPayload(rawBody: string, secret: string): string {
  return "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
}

export function verifySignature(
  rawBody: string,
  signature: string | null,
  secret: string,
): boolean {
  if (!signature || !secret) return false;
  const expected = Buffer.from(signPayload(rawBody, secret));
  const received = Buffer.from(signature);
  return expected.length === received.length && timingSafeEqual(expected, received);
}
