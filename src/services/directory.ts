/**
 * Business settings, customers and the price book: the reference data that
 * quotes and invoices are built from.
 */
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import type { DbOrTx } from "@/db/client";
import { businesses, customers, priceItems, type Business } from "@/db/schema";
import { UserFacingError } from "@/lib/errors";
import { audit, type ActorContext } from "./support";

// --- Business ----------------------------------------------------------------

export async function getBusiness(db: DbOrTx, businessId: string): Promise<Business> {
  const [row] = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (!row) throw new UserFacingError("Business not found.");
  return row;
}

export const businessSettingsSchema = z.object({
  name: z.string().trim().min(1, "Business name is required").max(120),
  abn: z.string().trim().max(20),
  licenceNumber: z.string().trim().max(40),
  licenseeName: z.string().trim().max(120),
  gstRegistered: z.boolean(),
  paymentTermsDays: z.number().int().min(0).max(90),
  email: z.string().trim().max(200),
  phone: z.string().trim().max(40),
  bankAccountName: z.string().trim().max(120),
  bankBsb: z.string().trim().max(10),
  bankAccountNumber: z.string().trim().max(20),
});

export async function updateBusiness(
  db: DbOrTx,
  actor: ActorContext,
  input: z.infer<typeof businessSettingsSchema>,
): Promise<void> {
  await db.update(businesses).set(input).where(eq(businesses.id, actor.businessId));
  await audit(db, actor, "business.updated", "business", actor.businessId);
}

// --- Customers ----------------------------------------------------------------

export const customerSchema = z.object({
  name: z.string().trim().min(1, "Customer name is required").max(120),
  email: z.union([z.literal(""), z.string().trim().email("Enter a valid email or leave it blank")]),
  phone: z.string().trim().max(40),
  address: z.string().trim().max(300),
  abn: z.string().trim().max(20),
});

export function listCustomers(db: DbOrTx, businessId: string) {
  return db
    .select()
    .from(customers)
    .where(eq(customers.businessId, businessId))
    .orderBy(asc(customers.name));
}

export async function getCustomer(db: DbOrTx, businessId: string, customerId: string) {
  const [row] = await db
    .select()
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.businessId, businessId)))
    .limit(1);
  if (!row) throw new UserFacingError("Customer not found.");
  return row;
}

export async function createCustomer(
  db: DbOrTx,
  actor: ActorContext,
  input: z.infer<typeof customerSchema>,
) {
  const [row] = await db
    .insert(customers)
    .values({ ...input, businessId: actor.businessId })
    .returning();
  await audit(db, actor, "customer.created", "customer", row.id);
  return row;
}

// --- Price book ---------------------------------------------------------------

export const priceItemSchema = z.object({
  name: z.string().trim().min(1, "Item name is required").max(120),
  unit: z.string().trim().min(1).max(20),
  category: z.enum(["labour", "material", "other"]),
  costCents: z.number().int().min(0),
  priceCents: z.number().int().min(0),
  taxable: z.boolean(),
});

export function listPriceItems(db: DbOrTx, businessId: string, includeInactive = false) {
  const conditions = [eq(priceItems.businessId, businessId)];
  if (!includeInactive) conditions.push(eq(priceItems.active, true));
  return db
    .select()
    .from(priceItems)
    .where(and(...conditions))
    .orderBy(asc(priceItems.category), asc(priceItems.name));
}

export async function createPriceItem(
  db: DbOrTx,
  actor: ActorContext,
  input: z.infer<typeof priceItemSchema>,
) {
  const [row] = await db
    .insert(priceItems)
    .values({ ...input, businessId: actor.businessId })
    .returning();
  await audit(db, actor, "price_item.created", "price_item", row.id);
  return row;
}

export async function setPriceItemActive(
  db: DbOrTx,
  actor: ActorContext,
  priceItemId: string,
  active: boolean,
): Promise<void> {
  await db
    .update(priceItems)
    .set({ active })
    .where(and(eq(priceItems.id, priceItemId), eq(priceItems.businessId, actor.businessId)));
  await audit(db, actor, active ? "price_item.restored" : "price_item.archived", "price_item", priceItemId);
}
