"use server";

/** Business settings, customers and the price book. Owner only. */
import { getDb } from "@/db/client";
import { actorOf, requireOwner } from "@/lib/auth";
import { act, checkbox, dollars, text, withQuery } from "@/lib/forms";
import {
  businessSettingsSchema,
  createCustomer,
  createPriceItem,
  customerSchema,
  priceItemSchema,
  setPriceItemActive,
  updateBusiness,
} from "@/services/directory";

export async function updateBusinessAction(form: FormData): Promise<void> {
  const user = await requireOwner();
  await act("/settings", async () => {
    const input = businessSettingsSchema.parse({
      name: text(form, "name"),
      abn: text(form, "abn"),
      licenceNumber: text(form, "licenceNumber"),
      licenseeName: text(form, "licenseeName"),
      gstRegistered: checkbox(form, "gstRegistered"),
      paymentTermsDays: Number(text(form, "paymentTermsDays") || 14),
      email: text(form, "email"),
      phone: text(form, "phone"),
      bankAccountName: text(form, "bankAccountName"),
      bankBsb: text(form, "bankBsb"),
      bankAccountNumber: text(form, "bankAccountNumber"),
    });
    await updateBusiness(await getDb(), actorOf(user), input);
    return withQuery("/settings", { notice: "Settings saved." });
  });
}

export async function createCustomerAction(form: FormData): Promise<void> {
  const user = await requireOwner();
  const returnTo = text(form, "returnTo") === "/jobs/new" ? "/jobs/new" : "/customers";
  await act(returnTo, async () => {
    const input = customerSchema.parse({
      name: text(form, "name"),
      email: text(form, "email"),
      phone: text(form, "phone"),
      address: text(form, "address"),
      abn: text(form, "abn"),
    });
    const customer = await createCustomer(await getDb(), actorOf(user), input);
    return withQuery(returnTo, { notice: `Added ${customer.name}.`, customer: customer.id });
  });
}

export async function createPriceItemAction(form: FormData): Promise<void> {
  const user = await requireOwner();
  await act("/price-book", async () => {
    const input = priceItemSchema.parse({
      name: text(form, "name"),
      unit: text(form, "unit") || "each",
      category: text(form, "category"),
      costCents: dollars(form, "cost", "Cost", true) ?? 0,
      priceCents: dollars(form, "price", "Price"),
      taxable: checkbox(form, "taxable"),
    });
    await createPriceItem(await getDb(), actorOf(user), input);
    return withQuery("/price-book", { notice: `Added ${input.name}.` });
  });
}

export async function setPriceItemActiveAction(
  priceItemId: string,
  active: boolean,
): Promise<void> {
  const user = await requireOwner();
  await act("/price-book", async () => {
    await setPriceItemActive(await getDb(), actorOf(user), priceItemId, active);
    return "/price-book";
  });
}
