/**
 * Small building blocks shared by the services: who is acting, document
 * numbering, customer links, the email outbox, the accounting push and the
 * audit trail. All take a Db or a transaction so callers can group writes.
 */
import { randomBytes } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import {
  accountingSyncLog,
  auditEvents,
  customerLinks,
  numberSequences,
  outboxMessages,
} from "@/db/schema";

/** Who is doing something. userId is null for customers and webhooks. */
export interface ActorContext {
  businessId: string;
  userId: string | null;
}

// --- Document numbers ------------------------------------------------------

const PREFIX = { quote: "Q", invoice: "INV", variation: "V" } as const;

/**
 * Issues the next number for a document kind ("INV-0042"). The upsert is a
 * single atomic statement, so two sends at once can't get the same number.
 */
export async function issueNumber(
  db: DbOrTx,
  businessId: string,
  kind: keyof typeof PREFIX,
): Promise<string> {
  const [row] = await db
    .insert(numberSequences)
    .values({ businessId, kind, lastValue: 1 })
    .onConflictDoUpdate({
      target: [numberSequences.businessId, numberSequences.kind],
      set: { lastValue: sql`${numberSequences.lastValue} + 1` },
    })
    .returning({ value: numberSequences.lastValue });
  return `${PREFIX[kind]}-${String(row.value).padStart(4, "0")}`;
}

// --- Customer links --------------------------------------------------------

const LINK_LIFETIME_DAYS = 60;

/** Creates an unguessable, expiring link a customer uses to view a document. */
export async function createCustomerLink(
  db: DbOrTx,
  businessId: string,
  kind: "quote" | "variation" | "invoice",
  targetId: string,
): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + LINK_LIFETIME_DAYS * 86_400_000);
  await db.insert(customerLinks).values({ businessId, token, kind, targetId, expiresAt });
  return token;
}

/** Returns the newest live link for a document, creating one if needed. */
export async function linkFor(
  db: DbOrTx,
  businessId: string,
  kind: "quote" | "variation" | "invoice",
  targetId: string,
): Promise<string> {
  const [existing] = await db
    .select({ token: customerLinks.token })
    .from(customerLinks)
    .where(
      and(
        eq(customerLinks.businessId, businessId),
        eq(customerLinks.kind, kind),
        eq(customerLinks.targetId, targetId),
        isNull(customerLinks.revokedAt),
        gt(customerLinks.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return existing?.token ?? createCustomerLink(db, businessId, kind, targetId);
}

export async function resolveCustomerLink(db: DbOrTx, token: string) {
  if (!/^[A-Za-z0-9_-]{40,}$/.test(token)) return null;
  const [link] = await db
    .select()
    .from(customerLinks)
    .where(
      and(
        eq(customerLinks.token, token),
        isNull(customerLinks.revokedAt),
        gt(customerLinks.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return link ?? null;
}

export function customerUrl(token: string): string {
  const base = process.env.APP_URL || "http://localhost:3000";
  return `${base.replace(/\/$/, "")}/c/${token}`;
}

// --- Outbox (emails) --------------------------------------------------------

/**
 * Queues an email. In the prototype nothing is sent: messages appear on the
 * Outbox page. Swapping in a real email provider only touches this function.
 */
export async function queueEmail(
  db: DbOrTx,
  input: {
    businessId: string;
    to: string;
    subject: string;
    body: string;
    kind: "document" | "reminder" | "summary";
  },
): Promise<void> {
  await db.insert(outboxMessages).values({
    businessId: input.businessId,
    toAddress: input.to || "(no email on file)",
    subject: input.subject,
    body: input.body,
    kind: input.kind,
  });
}

// --- Accounting push (simulated Xero) ---------------------------------------

/**
 * Records a one-way push to accounting. The idempotency key makes repeats a
 * no-op, which is what the real Xero integration will rely on too.
 */
export async function pushToAccounting(
  db: DbOrTx,
  input: {
    businessId: string;
    entityType: "invoice" | "payment";
    entityId: string;
    idempotencyKey: string;
    detail: Record<string, unknown>;
  },
): Promise<void> {
  await db.insert(accountingSyncLog).values(input).onConflictDoNothing();
}

// --- Audit trail -------------------------------------------------------------

export async function audit(
  db: DbOrTx,
  actor: ActorContext,
  action: string,
  entityType: string,
  entityId: string | null,
  detail: Record<string, unknown> = {},
): Promise<void> {
  await db.insert(auditEvents).values({
    businessId: actor.businessId,
    userId: actor.userId,
    action,
    entityType,
    entityId,
    detail,
  });
}
