import { redirect } from "next/navigation";
import { loginAction } from "@/app/actions/auth";
import { SubmitButton } from "@/components/buttons";
import { Flash } from "@/components/ui";
import { currentUser } from "@/lib/auth";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await currentUser()) redirect("/");
  const params = await searchParams;
  return (
    <>
      <div className="tape" />
      <main className="narrow">
        <h1>Tradie Paperwork</h1>
        <p className="muted">Sign in to your business.</p>
        <Flash params={params} />
        <form action={loginAction} className="stack card">
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" name="email" type="email" autoComplete="username" required />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </div>
          <SubmitButton className="primary" pendingLabel="Signing in…">
            Sign in
          </SubmitButton>
        </form>
        <p className="small muted">
          Local demo accounts are listed in the README after running{" "}
          <span className="mono">npm run db:reset</span>.
        </p>
      </main>
    </>
  );
}
