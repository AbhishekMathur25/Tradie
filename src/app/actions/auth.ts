"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { endSession, startSession, verifyLogin } from "@/lib/auth";
import { UserFacingError } from "@/lib/errors";
import { act, text, withQuery } from "@/lib/forms";
import { acceptInvite, signUp, signUpSchema } from "@/services/accounts";

export async function loginAction(form: FormData): Promise<void> {
  const user = await verifyLogin(text(form, "email"), text(form, "password"));
  if (!user) redirect(withQuery("/login", { error: "That email and password don't match." }));
  await startSession(user.id);
  redirect(user.role === "owner" ? "/dashboard" : "/jobs");
}

export async function logoutAction(): Promise<void> {
  await endSession();
  redirect("/login");
}

/** Creates a business and its owner, signs them in and sends them to Settings. */
export async function signUpAction(form: FormData): Promise<void> {
  await act("/signup", async () => {
    // Passwords aren't trimmed: spaces can be part of a password.
    const password = String(form.get("password") ?? "");
    if (password !== String(form.get("confirmPassword") ?? "")) {
      throw new UserFacingError("The two passwords don't match.");
    }
    const input = signUpSchema.parse({
      businessName: text(form, "businessName"),
      name: text(form, "name"),
      email: text(form, "email"),
      password,
    });
    const owner = await signUp(await getDb(), input);
    await startSession(owner.id);
    return withQuery("/settings", {
      notice:
        "Welcome! Add your ABN, licence details and GST status before sending your first quote.",
    });
  });
}

/** An invited crew member sets their password and is signed in. */
export async function acceptInviteAction(token: string, form: FormData): Promise<void> {
  await act(`/invite/${token}`, async () => {
    const password = String(form.get("password") ?? "");
    if (password !== String(form.get("confirmPassword") ?? "")) {
      throw new UserFacingError("The two passwords don't match.");
    }
    const user = await acceptInvite(await getDb(), token, password);
    await startSession(user.id);
    return "/jobs";
  });
}
