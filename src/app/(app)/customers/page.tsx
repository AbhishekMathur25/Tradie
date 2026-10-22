import { createCustomerAction } from "@/app/actions/settings";
import { SubmitButton } from "@/components/buttons";
import { Flash, PageHead } from "@/components/ui";
import { getDb } from "@/db/client";
import { requireOwner } from "@/lib/auth";
import { listCustomers } from "@/services/directory";

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const user = await requireOwner();
  const rows = await listCustomers(await getDb(), user.businessId);
  return (
    <>
      <PageHead title="Customers" sub={`${rows.length} customer${rows.length === 1 ? "" : "s"}`} />
      <Flash params={await searchParams} />
      <div className="grid-2">
        <div className="card table-wrap">
          {rows.length === 0 ? (
            <p className="muted">No customers yet.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Contact</th>
                  <th>Address</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((customer) => (
                  <tr key={customer.id}>
                    <td>
                      {customer.name}
                      {customer.abn ? <div className="small muted">ABN {customer.abn}</div> : null}
                    </td>
                    <td className="small">
                      {customer.email}
                      <br />
                      {customer.phone}
                    </td>
                    <td className="small">{customer.address}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <form action={createCustomerAction} className="card stack">
          <h2>Add a customer</h2>
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
          <SubmitButton className="primary">Add customer</SubmitButton>
        </form>
      </div>
    </>
  );
}
