import Link from "next/link";
import { redirect } from "next/navigation";
import { signUpAction } from "@/app/actions/auth";
import { SubmitButton } from "@/components/buttons";
import { Flash } from "@/components/ui";
import { currentUser } from "@/lib/auth";
import { MIN_PASSWORD_LENGTH } from "@/lib/passwords";

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await currentUser()) redirect("/");
  return (
    <>
      <div className="tape" />
      <main className="narrow">
        <h1>Start your business account</h1>
        <p className="muted">You&apos;ll be the owner. You can invite your crew afterwards.</p>
        <Flash params={await searchParams} />
        <form action={signUpAction} className="stack card">
          <div className="field">
            <label htmlFor="businessName">Business name</label>
            <input
              id="businessName"
              name="businessName"
              type="text"
              autoComplete="organization"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="name">Your name</label>
            <input id="name" name="name" type="text" autoComplete="name" required />
          </div>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" name="email" type="email" autoComplete="email" required />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              required
            />
            <span className="hint">
              At least {MIN_PASSWORD_LENGTH} characters. A short phrase works well.
            </span>
          </div>
          <div className="field">
            <label htmlFor="confirmPassword">Password again</label>
            <input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              required
            />
          </div>
          <SubmitButton className="primary" pendingLabel="Creating account…">
            Create account
          </SubmitButton>
        </form>
        <p className="small">
          Already have an account? <Link href="/login">Sign in</Link>
        </p>
      </main>
    </>
  );
}
