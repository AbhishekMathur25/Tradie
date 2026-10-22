import { inviteCrewAction, removeCrewAction, revokeInviteAction } from "@/app/actions/team";
import { ConfirmButton, SubmitButton } from "@/components/buttons";
import { Flash, PageHead } from "@/components/ui";
import { getDb } from "@/db/client";
import { formatDate } from "@/domain/dates";
import { requireOwner } from "@/lib/auth";
import { listTeam } from "@/services/accounts";

export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const user = await requireOwner();
  const { members, pending } = await listTeam(await getDb(), user.businessId);
  return (
    <>
      <PageHead
        title="Team"
        sub="Crew see their jobs only. They never see prices, invoices or money."
      />
      <Flash params={await searchParams} />
      <div className="grid-2">
        <section className="card">
          <h2>People</h2>
          <table>
            <tbody>
              {members.map((member) => (
                <tr key={member.id}>
                  <td>
                    {member.name}
                    {member.id === user.id ? <span className="muted small"> (you)</span> : null}
                    <div className="small muted">{member.email}</div>
                  </td>
                  <td>
                    <span className={`pill ${member.role === "owner" ? "info" : ""}`}>
                      {member.role}
                    </span>
                  </td>
                  <td className="right">
                    {member.role === "crew" ? (
                      <form action={removeCrewAction.bind(null, member.id)}>
                        <ConfirmButton
                          message={`Remove ${member.name}? They won't be able to sign in.`}
                        >
                          Remove
                        </ConfirmButton>
                      </form>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {pending.length > 0 ? (
            <>
              <h3 style={{ marginTop: 16 }}>Invites waiting</h3>
              <table>
                <tbody>
                  {pending.map((invite) => (
                    <tr key={invite.id}>
                      <td>
                        {invite.name}
                        <div className="small muted">{invite.email}</div>
                      </td>
                      <td className="small">Expires {formatDate(invite.expiresAt)}</td>
                      <td className="right">
                        <form action={revokeInviteAction.bind(null, invite.id)}>
                          <SubmitButton className="link">Cancel invite</SubmitButton>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : null}
        </section>

        <form action={inviteCrewAction} className="card stack">
          <h2>Invite crew</h2>
          <p className="small muted">
            They get an email with a link to set their password. The link works once and expires in
            7 days.
          </p>
          <div className="field">
            <label htmlFor="name">Name</label>
            <input id="name" name="name" type="text" required />
          </div>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" name="email" type="email" required />
          </div>
          <div>
            <SubmitButton className="primary" pendingLabel="Inviting…">
              Send invite
            </SubmitButton>
          </div>
        </form>
      </div>
    </>
  );
}
