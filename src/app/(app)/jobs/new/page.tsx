import { createJobAction } from "@/app/actions/jobs";
import { createCustomerAction } from "@/app/actions/settings";
import { SubmitButton } from "@/components/buttons";
import { BackLink, Flash, PageHead } from "@/components/ui";
import { getDb } from "@/db/client";
import { requireOwner } from "@/lib/auth";
import { listCustomers } from "@/services/directory";

export default async function NewJobPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string; customer?: string }>;
}) {
  const user = await requireOwner();
  const customerRows = await listCustomers(await getDb(), user.businessId);
  const params = await searchParams;
  return (
    <>
      <BackLink href="/jobs" label="Jobs" />
      <PageHead title="New job" />
      <Flash params={params} />
      <div className="grid-2">
        <form action={createJobAction} className="card stack">
          <h2>Job</h2>
          <div className="field">
            <label htmlFor="customerId">Customer</label>
            <select id="customerId" name="customerId" defaultValue={params.customer ?? ""} required>
              <option value="" disabled>
                Choose a customer
              </option>
              {customerRows.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="title">Short name</label>
            <input
              id="title"
              name="title"
              type="text"
              placeholder="Bathroom · Marrickville"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="siteAddress">Site address</label>
            <input id="siteAddress" name="siteAddress" type="text" />
          </div>
          <label className="check">
            <input type="checkbox" name="residentialBuildingWork" defaultChecked />
            <span>
              Residential building work in NSW
              <span className="muted small"> (turns on the Home Building Act checks)</span>
            </span>
          </label>
          <SubmitButton className="primary">Create job</SubmitButton>
        </form>

        <form action={createCustomerAction} className="card stack">
          <h2>Add a customer</h2>
          <input type="hidden" name="returnTo" value="/jobs/new" />
          <div className="field">
            <label htmlFor="name">Name</label>
            <input id="name" name="name" type="text" required />
          </div>
          <div className="row">
            <div className="field">
              <label htmlFor="email">Email</label>
              <input id="email" name="email" type="email" />
            </div>
            <div className="field">
              <label htmlFor="phone">Phone</label>
              <input id="phone" name="phone" type="text" />
            </div>
          </div>
          <div className="field">
            <label htmlFor="address">Address</label>
            <input id="address" name="address" type="text" />
          </div>
          <div className="field">
            <label htmlFor="abn">ABN (business customers)</label>
            <input id="abn" name="abn" type="text" />
          </div>
          <SubmitButton>Add customer</SubmitButton>
        </form>
      </div>
    </>
  );
}
