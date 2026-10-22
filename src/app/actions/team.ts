"use server";

/** Inviting and removing crew. Owner only. */
import { getDb } from "@/db/client";
import { actorOf, requireOwner } from "@/lib/auth";
import { act, text, withQuery } from "@/lib/forms";
import { inviteCrew, inviteSchema, removeCrew, revokeInvite } from "@/services/accounts";

export async function inviteCrewAction(form: FormData): Promise<void> {
  const user = await requireOwner();
  await act("/team", async () => {
    const input = inviteSchema.parse({ name: text(form, "name"), email: text(form, "email") });
    await inviteCrew(
      await getDb(),
      actorOf(user),
      input,
      process.env.APP_URL || "http://localhost:3000",
    );
    return withQuery("/team", {
      notice: `Invite sent to ${input.email}. In the prototype the email, with its link, is in the Outbox.`,
    });
  });
}

export async function revokeInviteAction(inviteId: string): Promise<void> {
  const user = await requireOwner();
  await act("/team", async () => {
    await revokeInvite(await getDb(), actorOf(user), inviteId);
    return withQuery("/team", { notice: "Invite cancelled. Its link no longer works." });
  });
}

export async function removeCrewAction(userId: string): Promise<void> {
  const user = await requireOwner();
  await act("/team", async () => {
    await removeCrew(await getDb(), actorOf(user), userId);
    return withQuery("/team", { notice: "Crew member removed. They can no longer sign in." });
  });
}
