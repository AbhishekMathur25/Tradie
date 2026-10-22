import Link from "next/link";
import { acceptInviteAction } from "@/app/actions/auth";
import { SubmitButton } from "@/components/buttons";
import { Flash } from "@/components/ui";
import { getDb } from "@/db/client";
import { MIN_PASSWORD_LENGTH } from "@/lib/passwords";
import { findInvite } from "@/services/accounts";
import { getBusiness } from "@/services/directory";

/** Where an invited crew member sets their password. */
export default async function InvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const db = await getDb();
  const invite = await findInvite(db, token);
  const flash = await searchParams;

  if (!invite) {
    return (
      <>
        <div className="tape" />
        <main className="narrow">
          <h1>Invite not valid</h1>
          <Flash params={flash} />
          <p>
            This invite link has expired or was already used. Ask the business owner to send a new
            one.
          </p>
          <p className="small">
            Already set up? <Link href="/login">Sign in</Link>
          </p>
        </main>
      </>
    );
  }

  const business = await getBusiness(db, invite.businessId);
  return (
    <>
      <div className="tape" />
      <main className="narrow">
        <h1>Join {business.name}</h1>
        <p className="muted">
          Hi {invite.name}. Set a password to see your jobs. You&apos;ll sign in with {invite.email}
          .
        </p>
        <Flash params={flash} />
        <form action={acceptInviteAction.bind(null, token)} className="stack card">
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
            <span className="hint">At least {MIN_PASSWORD_LENGTH} characters.</span>
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
          <SubmitButton className="primary" pendingLabel="Setting up…">
            Join and sign in
          </SubmitButton>
        </form>
      </main>
    </>
  );
}
