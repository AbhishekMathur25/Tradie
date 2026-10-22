/**
 * Accounts: signing up a new business, and inviting crew.
 *
 * Sign-up creates the business and its owner in one transaction. Crew join
 * only by invitation from an owner: the owner enters their name and email,
 * the crew member gets a one-time link (valid 7 days) and sets a password.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import type { Db, DbOrTx } from "@/db/client";
import { businesses, invites, users, type User } from "@/db/schema";
import { UserFacingError } from "@/lib/errors";
import { hashPassword, normaliseEmail, passwordSchema } from "@/lib/passwords";
import { getBusiness } from "./directory";
import { audit, queueEmail, type ActorContext } from "./support";

const INVITE_DAYS = 7;

const emailSchema = z.string().trim().email("Enter a valid email address").max(200);
const nameSchema = (label: string) => z.string().trim().min(1, `${label} is required`).max(120);

export const signUpSchema = z.object({
  businessName: nameSchema("Business name"),
  name: nameSchema("Your name"),
  email: emailSchema,
  password: passwordSchema,
});

async function emailTaken(db: DbOrTx, email: string): Promise<boolean> {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  return Boolean(row);
}

// The same message whether or not the email exists elsewhere would leak less,
// but people need to know to sign in instead. Kept short and neutral.
const EMAIL_IN_USE = "An account with that email already exists. Sign in instead.";

/** Creates a business and its owner. Returns the new owner. */
export async function signUp(db: Db, input: z.infer<typeof signUpSchema>): Promise<User> {
  const email = normaliseEmail(input.email);
  const passwordHash = await hashPassword(input.password);
  return db.transaction(async (tx) => {
    if (await emailTaken(tx, email)) throw new UserFacingError(EMAIL_IN_USE);
    const [business] = await tx
      .insert(businesses)
      .values({ name: input.businessName, email })
      .returning();
    const [owner] = await tx
      .insert(users)
      .values({ businessId: business.id, email, name: input.name, passwordHash, role: "owner" })
      .returning();
    await audit(
      tx,
      { businessId: business.id, userId: owner.id },
      "business.signed_up",
      "business",
      business.id,
    );
    return owner;
  });
}

// --- Crew invites ---------------------------------------------------------------

export const inviteSchema = z.object({ name: nameSchema("Name"), email: emailSchema });

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/**
 * Creates an invite and queues the email with the link. Returns the token so
 * the owner can also copy the link (the prototype doesn't send real email).
 */
export async function inviteCrew(
  db: Db,
  actor: ActorContext,
  input: z.infer<typeof inviteSchema>,
  appUrl: string,
): Promise<{ token: string }> {
  const email = normaliseEmail(input.email);
  return db.transaction(async (tx) => {
    if (await emailTaken(tx, email))
      throw new UserFacingError("Someone with that email already has an account.");
    // A fresh invite replaces any earlier unused one for the same person.
    await tx
      .update(invites)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(invites.businessId, actor.businessId),
          eq(invites.email, email),
          isNull(invites.acceptedAt),
          isNull(invites.revokedAt),
        ),
      );
    const token = randomBytes(32).toString("base64url");
    const [invite] = await tx
      .insert(invites)
      .values({
        businessId: actor.businessId,
        email,
        name: input.name,
        tokenHash: hashToken(token),
        invitedBy: actor.userId,
        expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000),
      })
      .returning();
    const business = await getBusiness(tx, actor.businessId);
    await queueEmail(tx, {
      businessId: actor.businessId,
      to: email,
      kind: "document",
      subject: `${business.name} invited you to their jobs`,
      body:
        `Hi ${input.name},\n\n${business.name} has added you to their team. ` +
        `Set your password here (the link works once and expires in ${INVITE_DAYS} days):\n` +
        `${appUrl.replace(/\/$/, "")}/invite/${token}\n`,
    });
    await audit(tx, actor, "invite.created", "invite", invite.id, { email });
    return { token };
  });
}

/** Finds a live invite by its token, or null if it's unknown, used, revoked or expired. */
export async function findInvite(db: DbOrTx, token: string) {
  if (!/^[A-Za-z0-9_-]{40,}$/.test(token)) return null;
  const [invite] = await db
    .select()
    .from(invites)
    .where(
      and(
        eq(invites.tokenHash, hashToken(token)),
        isNull(invites.acceptedAt),
        isNull(invites.revokedAt),
        gt(invites.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return invite ?? null;
}

/** The invited person sets a password; their crew account is created. */
export async function acceptInvite(db: Db, token: string, password: string): Promise<User> {
  const parsedPassword = passwordSchema.parse(password);
  const passwordHash = await hashPassword(parsedPassword);
  return db.transaction(async (tx) => {
    const invite = await findInvite(tx, token);
    if (!invite)
      throw new UserFacingError(
        "This invite link has expired or was already used. Ask for a new one.",
      );
    // Mark it used first, guarded on still being unused, so a double submit can't create two accounts.
    const claimed = await tx
      .update(invites)
      .set({ acceptedAt: new Date() })
      .where(and(eq(invites.id, invite.id), isNull(invites.acceptedAt)))
      .returning({ id: invites.id });
    if (claimed.length === 0) throw new UserFacingError("This invite link was already used.");
    if (await emailTaken(tx, invite.email)) throw new UserFacingError(EMAIL_IN_USE);
    const [user] = await tx
      .insert(users)
      .values({
        businessId: invite.businessId,
        email: invite.email,
        name: invite.name,
        passwordHash,
        role: invite.role,
      })
      .returning();
    await audit(
      tx,
      { businessId: invite.businessId, userId: user.id },
      "invite.accepted",
      "invite",
      invite.id,
    );
    return user;
  });
}

export async function listTeam(db: DbOrTx, businessId: string) {
  const [members, pending] = await Promise.all([
    db.select().from(users).where(eq(users.businessId, businessId)).orderBy(users.createdAt),
    db
      .select()
      .from(invites)
      .where(
        and(
          eq(invites.businessId, businessId),
          isNull(invites.acceptedAt),
          isNull(invites.revokedAt),
          gt(invites.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(invites.createdAt)),
  ]);
  return { members, pending };
}

export async function revokeInvite(db: Db, actor: ActorContext, inviteId: string): Promise<void> {
  await db
    .update(invites)
    .set({ revokedAt: new Date() })
    .where(and(eq(invites.id, inviteId), eq(invites.businessId, actor.businessId)));
  await audit(db, actor, "invite.revoked", "invite", inviteId);
}

/** Removes a crew member. Owners can't be removed here, so a business is never left without one. */
export async function removeCrew(db: Db, actor: ActorContext, userId: string): Promise<void> {
  const [member] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, userId), eq(users.businessId, actor.businessId)))
    .limit(1);
  if (!member) throw new UserFacingError("Team member not found.");
  if (member.role !== "crew") throw new UserFacingError("Only crew members can be removed.");
  await db.delete(users).where(eq(users.id, member.id));
  await audit(db, actor, "crew.removed", "user", member.id, { email: member.email });
}
