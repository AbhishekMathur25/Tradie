import { updateBusinessAction } from "@/app/actions/settings";
import { SubmitButton } from "@/components/buttons";
import { Flash, PageHead } from "@/components/ui";
import { getDb } from "@/db/client";
import { RULES } from "@/domain/rules";
import { aiConfigured } from "@/integrations/ai/draft";
import { requireOwner } from "@/lib/auth";
import { getBusiness } from "@/services/directory";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const user = await requireOwner();
  const business = await getBusiness(await getDb(), user.businessId);
  return (
    <>
      <PageHead title="Settings" />
      <Flash params={await searchParams} />
      <div className="grid-2">
        <form action={updateBusinessAction} className="card stack">
          <h2>Business</h2>
          <div className="field">
            <label htmlFor="name">Business name</label>
            <input id="name" name="name" type="text" defaultValue={business.name} required />
          </div>
          <div className="row">
            <div className="field">
              <label htmlFor="abn">ABN</label>
              <input id="abn" name="abn" type="text" defaultValue={business.abn} />
            </div>
            <div className="field">
              <label htmlFor="paymentTermsDays">Payment terms (days)</label>
              <input
                id="paymentTermsDays"
                name="paymentTermsDays"
                type="number"
                min={0}
                max={90}
                defaultValue={business.paymentTermsDays}
              />
            </div>
          </div>
          <div className="row">
            <div className="field">
              <label htmlFor="licenceNumber">Contractor licence number</label>
              <input
                id="licenceNumber"
                name="licenceNumber"
                type="text"
                defaultValue={business.licenceNumber}
              />
            </div>
            <div className="field">
              <label htmlFor="licenseeName">Licensee name, exactly as on the licence</label>
              <input
                id="licenseeName"
                name="licenseeName"
                type="text"
                defaultValue={business.licenseeName}
              />
            </div>
          </div>
          <label className="check">
            <input type="checkbox" name="gstRegistered" defaultChecked={business.gstRegistered} />
            <span>Registered for GST (issue tax invoices with GST)</span>
          </label>
          <div className="row">
            <div className="field">
              <label htmlFor="email">Email (receives notices and summaries)</label>
              <input id="email" name="email" type="email" defaultValue={business.email} />
            </div>
            <div className="field">
              <label htmlFor="phone">Phone</label>
              <input id="phone" name="phone" type="text" defaultValue={business.phone} />
            </div>
          </div>
          <h3>Bank details shown on invoices</h3>
          <p className="small muted">
            Before launch, changes here will need you to sign in again and wait 24 hours, to stop
            invoice-redirection fraud.
          </p>
          <div className="row">
            <div className="field">
              <label htmlFor="bankAccountName">Account name</label>
              <input
                id="bankAccountName"
                name="bankAccountName"
                type="text"
                defaultValue={business.bankAccountName}
              />
            </div>
            <div className="field">
              <label htmlFor="bankBsb">BSB</label>
              <input id="bankBsb" name="bankBsb" type="text" defaultValue={business.bankBsb} />
            </div>
            <div className="field">
              <label htmlFor="bankAccountNumber">Account number</label>
              <input
                id="bankAccountNumber"
                name="bankAccountNumber"
                type="text"
                defaultValue={business.bankAccountNumber}
              />
            </div>
          </div>
          <div>
            <SubmitButton className="primary">Save settings</SubmitButton>
          </div>
        </form>

        <section className="card">
          <h2>Rule register</h2>
          <p className="small muted">
            The checks the app runs before anything is sent. They stop common mistakes; they are not
            legal advice. Each rule needs a lawyer&apos;s sign-off before launch.
          </p>
          <table>
            <tbody>
              {Object.values(RULES).map((rule) => (
                <tr key={rule.id}>
                  <td>
                    {rule.title}
                    <div className="small muted">
                      {rule.sourceUrl ? (
                        <a href={rule.sourceUrl} target="_blank" rel="noreferrer">
                          {rule.source}
                        </a>
                      ) : (
                        rule.source
                      )}
                    </div>
                  </td>
                  <td className="small">
                    <span className={`pill ${rule.review === "Internal" ? "" : "warn"}`}>
                      {rule.review}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3 style={{ marginTop: 16 }}>AI drafting</h3>
          <p className="small">
            {aiConfigured()
              ? "On. Job descriptions are sent to the configured AI service with customer names and addresses removed."
              : "Off. Drafts use keyword matching against your price list. Set AI_BASE_URL and AI_API_KEY in .env.local to turn it on."}
          </p>
        </section>
      </div>
    </>
  );
}
