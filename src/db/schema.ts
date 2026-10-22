/**
 * Database schema. Every money column is a whole number of cents (integer)
 * so arithmetic is exact. Amounts named `...Cents` are GST-exclusive unless
 * the name says otherwise (e.g. `totalCents` includes GST).
 */
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { Line } from "@/domain/money";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
const businessId = () =>
  uuid("business_id")
    .notNull()
    .references(() => businesses.id);

export const businesses = pgTable("businesses", {
  id: id(),
  name: text("name").notNull(),
  abn: text("abn").notNull().default(""),
  // NSW requires the licence number and the licensee's exact name on contracts.
  licenceNumber: text("licence_number").notNull().default(""),
  licenseeName: text("licensee_name").notNull().default(""),
  state: text("state", { enum: ["NSW"] })
    .notNull()
    .default("NSW"),
  gstRegistered: boolean("gst_registered").notNull().default(true),
  paymentTermsDays: integer("payment_terms_days").notNull().default(14),
  email: text("email").notNull().default(""),
  phone: text("phone").notNull().default(""),
  bankAccountName: text("bank_account_name").notNull().default(""),
  bankBsb: text("bank_bsb").notNull().default(""),
  bankAccountNumber: text("bank_account_number").notNull().default(""),
  createdAt: createdAt(),
});

export const users = pgTable("users", {
  id: id(),
  businessId: businessId(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  // Crew never see money figures; enforced in lib/auth.ts.
  role: text("role", { enum: ["owner", "crew"] }).notNull(),
  createdAt: createdAt(),
});

export const customers = pgTable(
  "customers",
  {
    id: id(),
    businessId: businessId(),
    name: text("name").notNull(),
    email: text("email").notNull().default(""),
    phone: text("phone").notNull().default(""),
    address: text("address").notNull().default(""),
    abn: text("abn").notNull().default(""),
    createdAt: createdAt(),
  },
  (t) => [index("customers_business_idx").on(t.businessId)],
);

export const priceItems = pgTable(
  "price_items",
  {
    id: id(),
    businessId: businessId(),
    name: text("name").notNull(),
    unit: text("unit").notNull().default("each"),
    category: text("category", { enum: ["labour", "material", "other"] })
      .notNull()
      .default("material"),
    costCents: integer("cost_cents").notNull().default(0),
    priceCents: integer("price_cents").notNull(),
    taxable: boolean("taxable").notNull().default(true),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index("price_items_business_idx").on(t.businessId)],
);

export const JOB_STATUSES = [
  "quoting",
  "contracted",
  "in_progress",
  "completed",
  "cancelled",
] as const;
export const CONTRACT_KINDS = [
  "fair_trading",
  "hia",
  "master_builders",
  "own_lawyer",
  "other",
] as const;

export const jobs = pgTable(
  "jobs",
  {
    id: id(),
    businessId: businessId(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    title: text("title").notNull(),
    siteAddress: text("site_address").notNull().default(""),
    // Residential building work in NSW triggers the Home Building Act checks.
    residentialBuildingWork: boolean("residential_building_work").notNull().default(true),
    status: text("status", { enum: JOB_STATUSES }).notNull().default("quoting"),
    // Contract price including GST, as written on the signed contract.
    contractPriceCents: integer("contract_price_cents"),
    contractKind: text("contract_kind", { enum: CONTRACT_KINDS }),
    contractSignedOn: date("contract_signed_on"),
    insuranceCertificateNumber: text("insurance_certificate_number"),
    insuranceCertificateOn: date("insurance_certificate_on"),
    completedOn: date("completed_on"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("jobs_business_idx").on(t.businessId)],
);

export const quotes = pgTable(
  "quotes",
  {
    id: id(),
    businessId: businessId(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id),
    // Numbers are assigned by the server when the document is sent.
    number: text("number"),
    status: text("status", { enum: ["draft", "sent", "accepted", "declined"] })
      .notNull()
      .default("draft"),
    lines: jsonb("lines").$type<Line[]>().notNull().default([]),
    subtotalCents: integer("subtotal_cents").notNull().default(0),
    gstCents: integer("gst_cents").notNull().default(0),
    totalCents: integer("total_cents").notNull().default(0),
    costCents: integer("cost_cents").notNull().default(0),
    notes: text("notes").notNull().default(""),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    validUntil: date("valid_until"),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedByName: text("accepted_by_name"),
    // Optimistic locking: every edit must name the version it started from.
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("quotes_job_idx").on(t.jobId)],
);

export const variations = pgTable(
  "variations",
  {
    id: id(),
    businessId: businessId(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id),
    number: text("number"),
    description: text("description").notNull(),
    amountCents: integer("amount_cents").notNull(),
    gstCents: integer("gst_cents").notNull(),
    totalCents: integer("total_cents").notNull(),
    status: text("status", { enum: ["draft", "sent", "approved", "declined"] })
      .notNull()
      .default("draft"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedByName: text("approved_by_name"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("variations_job_idx").on(t.jobId)],
);

export const INVOICE_KINDS = ["deposit", "progress", "final", "standard"] as const;

export const invoices = pgTable(
  "invoices",
  {
    id: id(),
    businessId: businessId(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id),
    // Deposit and progress claims are invoices with a kind, so every payment
    // request goes through the same rule checks and numbering.
    kind: text("kind", { enum: INVOICE_KINDS }).notNull().default("standard"),
    stageLabel: text("stage_label").notNull().default(""),
    number: text("number"),
    status: text("status", { enum: ["draft", "sent", "paid", "void"] })
      .notNull()
      .default("draft"),
    // Fixed at send time from the business's GST registration.
    taxInvoice: boolean("tax_invoice").notNull().default(true),
    lines: jsonb("lines").$type<Line[]>().notNull().default([]),
    subtotalCents: integer("subtotal_cents").notNull().default(0),
    gstCents: integer("gst_cents").notNull().default(0),
    totalCents: integer("total_cents").notNull().default(0),
    paidCents: integer("paid_cents").notNull().default(0),
    // For draft claims: the date the owner expects to send it (forecast only).
    plannedOn: date("planned_on"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    dueOn: date("due_on"),
    payId: text("pay_id"),
    paymentReference: text("payment_reference"),
    notes: text("notes").notNull().default(""),
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("invoices_job_idx").on(t.jobId),
    uniqueIndex("invoices_reference_idx").on(t.paymentReference),
  ],
);

export const payments = pgTable(
  "payments",
  {
    id: id(),
    businessId: businessId(),
    // Null until the payment is matched to an invoice.
    invoiceId: uuid("invoice_id").references(() => invoices.id),
    amountCents: integer("amount_cents").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    method: text("method", { enum: ["payid", "bank", "card", "manual"] }).notNull(),
    // Provider event id: the same notification is only ever processed once.
    providerEventId: text("provider_event_id").notNull().unique(),
    payerName: text("payer_name").notNull().default(""),
    reference: text("reference").notNull().default(""),
    createdAt: createdAt(),
  },
  (t) => [index("payments_business_idx").on(t.businessId)],
);

export const customerLinks = pgTable("customer_links", {
  id: id(),
  businessId: businessId(),
  // Long random token; the only thing a customer needs to view a document.
  token: text("token").notNull().unique(),
  kind: text("kind", { enum: ["quote", "variation", "invoice"] }).notNull(),
  targetId: uuid("target_id").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: createdAt(),
});

/** Emails the app would send. Nothing leaves the machine in the prototype. */
export const outboxMessages = pgTable("outbox_messages", {
  id: id(),
  businessId: businessId(),
  toAddress: text("to_address").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  kind: text("kind", { enum: ["document", "reminder", "summary"] }).notNull(),
  createdAt: createdAt(),
});

/** Records of the one-way push to accounting (simulated Xero in the prototype). */
export const accountingSyncLog = pgTable("accounting_sync_log", {
  id: id(),
  businessId: businessId(),
  entityType: text("entity_type", { enum: ["invoice", "payment"] }).notNull(),
  entityId: uuid("entity_id").notNull(),
  // Pushing the same thing twice is a no-op.
  idempotencyKey: text("idempotency_key").notNull().unique(),
  detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
});

export const auditEvents = pgTable(
  "audit_events",
  {
    id: id(),
    businessId: businessId(),
    userId: uuid("user_id"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("audit_business_idx").on(t.businessId)],
);

/** Per-business counters so document numbers never repeat. Holds the last number issued. */
export const numberSequences = pgTable(
  "number_sequences",
  {
    businessId: businessId(),
    kind: text("kind", { enum: ["quote", "invoice", "variation"] }).notNull(),
    lastValue: integer("last_value").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.businessId, t.kind] })],
);

export type Business = typeof businesses.$inferSelect;
export type User = typeof users.$inferSelect;
export type Customer = typeof customers.$inferSelect;
export type PriceItem = typeof priceItems.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type Quote = typeof quotes.$inferSelect;
export type Variation = typeof variations.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type CustomerLink = typeof customerLinks.$inferSelect;
