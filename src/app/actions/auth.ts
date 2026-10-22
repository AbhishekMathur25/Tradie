"use server";

import { redirect } from "next/navigation";
import { endSession, startSession, verifyLogin } from "@/lib/auth";
import { text, withQuery } from "@/lib/forms";

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
