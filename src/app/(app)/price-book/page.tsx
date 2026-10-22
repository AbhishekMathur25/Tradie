import { createPriceItemAction, setPriceItemActiveAction } from "@/app/actions/settings";
import { SubmitButton } from "@/components/buttons";
import { Flash, Money, PageHead } from "@/components/ui";
import { getDb } from "@/db/client";
import { marginPercent } from "@/domain/money";
import { requireOwner } from "@/lib/auth";
import { listPriceItems } from "@/services/directory";

export default async function PriceBookPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const user = await requireOwner();
  const items = await listPriceItems(await getDb(), user.businessId, true);
  return (
    <>
      <PageHead
        title="Price list"
        sub="Prices exclude GST. Costs stay private and give the quoted margin."
      />
      <Flash params={await searchParams} />
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th>Unit</th>
              <th>Type</th>
              <th className="right">Cost</th>
              <th className="right">Price</th>
              <th className="right">Margin</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} style={{ opacity: item.active ? 1 : 0.5 }}>
                <td>
                  {item.name}
                  {item.taxable ? (
                    ""
                  ) : (
                    <span className="pill" style={{ marginLeft: 6 }}>
                      GST-free
                    </span>
                  )}
                </td>
                <td>{item.unit}</td>
                <td className="small">{item.category}</td>
                <td className="right">
                  <Money cents={item.costCents} />
                </td>
                <td className="right">
                  <Money cents={item.priceCents} />
                </td>
                <td className="right num">
                  {marginPercent(item.priceCents, item.costCents) ?? "—"}%
                </td>
                <td className="right">
                  <form action={setPriceItemActiveAction.bind(null, item.id, !item.active)}>
                    <SubmitButton className="link">
                      {item.active ? "Archive" : "Restore"}
                    </SubmitButton>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form action={createPriceItemAction} className="card stack">
        <h2>Add an item</h2>
        <div className="row">
          <div className="field">
            <label htmlFor="name">Name</label>
            <input id="name" name="name" type="text" placeholder="Wall tiling" required />
          </div>
          <div className="field">
            <label htmlFor="unit">Unit</label>
            <input id="unit" name="unit" type="text" placeholder="m2" />
          </div>
          <div className="field">
            <label htmlFor="category">Type</label>
            <select id="category" name="category" defaultValue="material">
              <option value="labour">Labour</option>
              <option value="material">Material</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="cost">Your cost (excl. GST)</label>
            <input id="cost" name="cost" type="text" inputMode="decimal" />
          </div>
          <div className="field">
            <label htmlFor="price">Price (excl. GST)</label>
            <input id="price" name="price" type="text" inputMode="decimal" required />
          </div>
        </div>
        <label className="check">
          <input type="checkbox" name="taxable" defaultChecked /> <span>GST applies</span>
        </label>
        <div>
          <SubmitButton className="primary">Add item</SubmitButton>
        </div>
      </form>
    </>
  );
}
