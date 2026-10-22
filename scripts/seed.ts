/**
 * Loads a demo business so the app has something to show locally.
 * All data is invented. Refuses to run against a hosted database unless
 * ALLOW_DEMO_SEED=true, so demo accounts never reach production by accident.
 *
 * Demo sign-ins (local only):
 *   owner@demo.test / tradie-demo-2026   (owner: sees money)
 *   crew@demo.test  / tradie-demo-2026   (crew: jobs only)
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

export const DEMO_PASSWORD = "tradie-demo-2026";

export async function seed() {
  const { eq } = await import("drizzle-orm");
  const { getDb } = await import("../src/db/client");
  const schema = await import("../src/db/schema");
  const { addDays, toIsoDate } = await import("../src/domain/dates");
  const { hashPassword } = await import("../src/lib/auth");
  const { createCustomer, createPriceItem } = await import("../src/services/directory");
  const { createJob, updateContract, setJobStatus } = await import("../src/services/jobs");
  const docs = await import("../src/services/documents");
  const { recordPaymentEvent } = await import("../src/services/payments");

  const db = await getDb();
  const existing = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, "owner@demo.test"));
  if (existing.length > 0) {
    console.log("Demo data already loaded. Use `npm run db:reset` to start again.");
    return;
  }

  const today = toIsoDate(new Date());
  const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000);

  const [business] = await db
    .insert(schema.businesses)
    .values({
      name: "Harbour Renos",
      abn: "11 222 333 444",
      licenceNumber: "123456C",
      licenseeName: "Harbour Renos Pty Ltd",
      email: "owner@demo.test",
      phone: "0400 000 000",
      bankAccountName: "Harbour Renos Pty Ltd",
      bankBsb: "000-000",
      bankAccountNumber: "12345678",
    })
    .returning();
  const actor = { businessId: business.id, userId: null };
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  await db.insert(schema.users).values([
    {
      businessId: business.id,
      email: "owner@demo.test",
      name: "Sam Owner",
      passwordHash,
      role: "owner",
    },
    {
      businessId: business.id,
      email: "crew@demo.test",
      name: "Alex Crew",
      passwordHash,
      role: "crew",
    },
  ]);

  // Price list (excl. GST). Costs give the quoted margin.
  const items = [
    {
      name: "Carpenter labour",
      unit: "hour",
      category: "labour" as const,
      costCents: 5500,
      priceCents: 9500,
    },
    {
      name: "Tiler labour",
      unit: "hour",
      category: "labour" as const,
      costCents: 5000,
      priceCents: 8500,
    },
    {
      name: "Wall tiling",
      unit: "m2",
      category: "labour" as const,
      costCents: 4000,
      priceCents: 8500,
    },
    {
      name: "Floor tiling",
      unit: "m2",
      category: "labour" as const,
      costCents: 4200,
      priceCents: 9000,
    },
    {
      name: "Waterproofing membrane",
      unit: "m2",
      category: "material" as const,
      costCents: 2500,
      priceCents: 4500,
    },
    {
      name: "Vanity unit 900mm",
      unit: "each",
      category: "material" as const,
      costCents: 80000,
      priceCents: 120000,
    },
    {
      name: "Toilet suite",
      unit: "each",
      category: "material" as const,
      costCents: 45000,
      priceCents: 65000,
    },
    {
      name: "Skip bin 4m3",
      unit: "each",
      category: "other" as const,
      costCents: 38000,
      priceCents: 45000,
    },
    {
      name: "Plasterboard sheet",
      unit: "each",
      category: "material" as const,
      costCents: 2800,
      priceCents: 4800,
    },
  ];
  const priceItems: Awaited<ReturnType<typeof createPriceItem>>[] = [];
  for (const item of items)
    priceItems.push(await createPriceItem(db, actor, { ...item, taxable: true }));
  const byName = (name: string) => priceItems.find((item) => item.name === name)!;
  const lineFor = (name: string, quantity: number) => {
    const item = byName(name);
    return {
      description: item.name,
      quantityMilli: quantity * 1000,
      unitPriceCents: item.priceCents,
      unitCostCents: item.costCents,
      taxable: true,
      priceItemId: item.id,
    };
  };

  /** A custom line with a known cost, so quoted margins stay realistic. */
  const allowance = (description: string, priceCents: number, costCents: number) => ({
    ...docs.stageLine(description, priceCents),
    unitCostCents: costCents,
  });

  const customer = (name: string, suburb: string) =>
    createCustomer(db, actor, {
      name,
      email: `${name.split(" ")[0].toLowerCase()}@example.com`,
      phone: "",
      address: `${suburb} NSW`,
      abn: "",
    });
  const lee = await customer("Jordan Lee", "Ryde");
  const ng = await customer("Casey Nguyen", "Marrickville");
  const park = await customer("Morgan Park", "Penrith");
  const ali = await customer("Riley Ali", "Castle Hill");

  /** Sends a document now, then backdates it so the demo has history. */
  const backdateInvoice = async (id: string, sentDaysAgo: number, termsDays = 14) => {
    const sentAt = daysAgo(sentDaysAgo);
    await db
      .update(schema.invoices)
      .set({ sentAt, dueOn: addDays(toIsoDate(sentAt), termsDays) })
      .where(eq(schema.invoices.id, id));
  };

  // --- Kitchen · Ryde: in progress, deposit and claim 1 paid, claim 2 planned
  const kitchen = await createJob(db, actor, {
    customerId: lee.id,
    title: "Kitchen · Ryde",
    siteAddress: "Ryde NSW",
    residentialBuildingWork: true,
  });
  const kq = await docs.createQuoteDraft(db, actor, kitchen.id, {
    lines: [
      lineFor("Carpenter labour", 120),
      lineFor("Plasterboard sheet", 40),
      lineFor("Floor tiling", 18),
      lineFor("Skip bin 4m3", 2),
      allowance("Cabinetry supply and install (allowance)", 2_400_000, 1_900_000),
    ],
    notes: "Includes cabinetry allowance. Appliances by owner.",
  });
  await docs.sendQuote(db, actor, kq.id, today);
  await docs.respondToQuote(db, business.id, kq.id, "accept", "Jordan Lee");
  await updateContract(db, actor, kitchen.id, {
    contractPriceCents: kq.totalCents,
    contractKind: "hia",
    contractSignedOn: addDays(today, -60),
    insuranceCertificateNumber: "HBCF-2026-0417",
    insuranceCertificateOn: addDays(today, -59),
  });
  const v1 = await docs.createVariation(db, actor, kitchen.id, {
    description: "Extra pantry pull-out and soft-close upgrade",
    amountCents: 190_909,
  });
  await docs.sendVariation(db, actor, v1.id);
  await docs.respondToVariation(db, business.id, v1.id, "approve", "Jordan Lee");
  const exGst = (inclusive: number) => Math.floor((inclusive * 10) / 11);
  const kDeposit = await docs.createInvoiceDraft(db, actor, kitchen.id, {
    kind: "deposit",
    stageLabel: "Deposit",
    lines: [
      docs.stageLine("Deposit (10% of contract price)", exGst(Math.floor(kq.totalCents / 10))),
    ],
    notes: "",
    plannedOn: null,
  });
  await docs.sendInvoice(db, actor, kDeposit.id, today);
  await backdateInvoice(kDeposit.id, 55);
  const kClaim1 = await docs.createInvoiceDraft(db, actor, kitchen.id, {
    kind: "progress",
    stageLabel: "Demolition and rough-in",
    lines: [
      docs.stageLine(
        "Progress claim: demolition and rough-in",
        exGst(Math.floor(kq.totalCents * 0.35)),
      ),
    ],
    notes: "",
    plannedOn: null,
  });
  await docs.sendInvoice(db, actor, kClaim1.id, today);
  await backdateInvoice(kClaim1.id, 25);
  for (const [invoice, days] of [
    [kDeposit, 50],
    [kClaim1, 12],
  ] as const) {
    const [fresh] = await db
      .select()
      .from(schema.invoices)
      .where(eq(schema.invoices.id, invoice.id));
    await recordPaymentEvent(db, {
      eventId: `seed-${fresh.id}`,
      businessId: business.id,
      amountCents: fresh.totalCents,
      receivedAt: daysAgo(days).toISOString(),
      method: "payid",
      payId: fresh.payId ?? undefined,
      reference: fresh.paymentReference ?? "",
      payerName: "Jordan Lee",
    });
  }
  await docs.createInvoiceDraft(db, actor, kitchen.id, {
    kind: "progress",
    stageLabel: "Cabinets installed",
    lines: [
      docs.stageLine("Progress claim: cabinets installed", exGst(Math.floor(kq.totalCents * 0.25))),
    ],
    notes: "",
    plannedOn: addDays(today, 2),
  });

  // --- Bathroom · Marrickville: claim overdue, variation waiting 9 days
  const bathroom = await createJob(db, actor, {
    customerId: ng.id,
    title: "Bathroom · Marrickville",
    siteAddress: "Marrickville NSW",
    residentialBuildingWork: true,
  });
  const bq = await docs.createQuoteDraft(db, actor, bathroom.id, {
    lines: [
      lineFor("Tiler labour", 40),
      lineFor("Wall tiling", 24),
      lineFor("Floor tiling", 6),
      lineFor("Waterproofing membrane", 12),
      lineFor("Vanity unit 900mm", 1),
      lineFor("Toilet suite", 1),
      lineFor("Skip bin 4m3", 1),
      allowance("Plumbing and electrical (subcontracted)", 1_100_000, 900_000),
    ],
    notes: "",
  });
  await docs.sendQuote(db, actor, bq.id, today);
  await docs.respondToQuote(db, business.id, bq.id, "accept", "Casey Nguyen");
  await updateContract(db, actor, bathroom.id, {
    contractPriceCents: bq.totalCents,
    contractKind: "fair_trading",
    contractSignedOn: addDays(today, -40),
    insuranceCertificateNumber: "HBCF-2026-0388",
    insuranceCertificateOn: addDays(today, -39),
  });
  const bDeposit = await docs.createInvoiceDraft(db, actor, bathroom.id, {
    kind: "deposit",
    stageLabel: "Deposit",
    lines: [
      docs.stageLine("Deposit (10% of contract price)", exGst(Math.floor(bq.totalCents / 10))),
    ],
    notes: "",
    plannedOn: null,
  });
  await docs.sendInvoice(db, actor, bDeposit.id, today);
  await backdateInvoice(bDeposit.id, 38);
  const [bDepositFresh] = await db
    .select()
    .from(schema.invoices)
    .where(eq(schema.invoices.id, bDeposit.id));
  await recordPaymentEvent(db, {
    eventId: `seed-${bDeposit.id}`,
    businessId: business.id,
    amountCents: bDepositFresh.totalCents,
    receivedAt: daysAgo(30).toISOString(),
    method: "bank",
    reference: bDepositFresh.paymentReference ?? "",
    payerName: "C Nguyen",
  });
  const bClaim = await docs.createInvoiceDraft(db, actor, bathroom.id, {
    kind: "progress",
    stageLabel: "Waterproofing and tiling",
    lines: [
      docs.stageLine(
        "Progress claim: waterproofing and tiling",
        exGst(Math.floor(bq.totalCents * 0.3)),
      ),
    ],
    notes: "",
    plannedOn: null,
  });
  await docs.sendInvoice(db, actor, bClaim.id, today);
  await backdateInvoice(bClaim.id, 26); // due 12 days ago: overdue
  const v2 = await docs.createVariation(db, actor, bathroom.id, {
    description: "Move toilet waste 600mm and add niche",
    amountCents: 168_182,
  });
  await docs.sendVariation(db, actor, v2.id);
  await db
    .update(schema.variations)
    .set({ sentAt: daysAgo(9) })
    .where(eq(schema.variations.id, v2.id));

  // --- Extension · Penrith: contract signed, insurance missing: payments blocked
  const extension = await createJob(db, actor, {
    customerId: park.id,
    title: "Extension · Penrith",
    siteAddress: "Penrith NSW",
    residentialBuildingWork: true,
  });
  await updateContract(db, actor, extension.id, {
    contractPriceCents: 9_600_000,
    contractKind: "master_builders",
    contractSignedOn: addDays(today, -3),
    insuranceCertificateNumber: null,
    insuranceCertificateOn: null,
  });
  await docs.createInvoiceDraft(db, actor, extension.id, {
    kind: "deposit",
    stageLabel: "Deposit",
    lines: [docs.stageLine("Deposit (10% of contract price)", exGst(960_000))],
    notes: "",
    plannedOn: addDays(today, 1),
  });

  // --- Deck · Castle Hill: quote sent 6 days ago, waiting
  const deck = await createJob(db, actor, {
    customerId: ali.id,
    title: "Deck · Castle Hill",
    siteAddress: "Castle Hill NSW",
    residentialBuildingWork: true,
  });
  const dq = await docs.createQuoteDraft(db, actor, deck.id, {
    lines: [
      lineFor("Carpenter labour", 60),
      allowance("Merbau decking and framing (supply)", 780_000, 560_000),
    ],
    notes: "",
  });
  await docs.sendQuote(db, actor, dq.id, today);
  await db
    .update(schema.quotes)
    .set({ sentAt: daysAgo(6) })
    .where(eq(schema.quotes.id, dq.id));

  // --- A finished small job and an unmatched bank transfer
  const fence = await createJob(db, actor, {
    customerId: lee.id,
    title: "Side gate repair · Ryde",
    siteAddress: "Ryde NSW",
    residentialBuildingWork: false,
  });
  const fInvoice = await docs.createInvoiceDraft(db, actor, fence.id, {
    kind: "standard",
    stageLabel: "",
    lines: [lineFor("Carpenter labour", 3)],
    notes: "",
    plannedOn: null,
  });
  await docs.sendInvoice(db, actor, fInvoice.id, today);
  await setJobStatus(db, actor, fence.id, "completed", addDays(today, -1));
  await recordPaymentEvent(db, {
    eventId: "seed-unmatched",
    businessId: business.id,
    amountCents: 330_000,
    receivedAt: daysAgo(1).toISOString(),
    method: "bank",
    reference: "bathroom payment",
    payerName: "C NGUYEN",
  });

  console.log(
    "Demo data loaded: Harbour Renos, 5 jobs. Sign-in details are at the top of scripts/seed.ts.",
  );
}

// Run directly (npm run db:seed), not when imported by reset.ts.
if (process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/seed.ts")) {
  if (process.env.DATABASE_URL && process.env.ALLOW_DEMO_SEED !== "true") {
    console.error(
      "Refusing to load demo data into a hosted database. Set ALLOW_DEMO_SEED=true if you really mean it.",
    );
    process.exit(1);
  }
  seed()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
