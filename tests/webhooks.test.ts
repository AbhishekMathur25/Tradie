import { describe, expect, it } from "vitest";
import { signPayload, verifySignature } from "@/lib/webhooks";

describe("payment webhook signatures", () => {
  const secret = "test-secret-for-unit-tests-only";
  const body = JSON.stringify({ eventId: "evt-1", amountCents: 1000 });

  it("accepts a body signed with the shared secret", () => {
    expect(verifySignature(body, signPayload(body, secret), secret)).toBe(true);
  });

  it("rejects a changed body, a wrong secret or a missing signature", () => {
    const signature = signPayload(body, secret);
    expect(verifySignature(body.replace("1000", "9999"), signature, secret)).toBe(false);
    expect(verifySignature(body, signPayload(body, "another-secret"), secret)).toBe(false);
    expect(verifySignature(body, null, secret)).toBe(false);
    expect(verifySignature(body, signature, "")).toBe(false);
  });
});
