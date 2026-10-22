/**
 * Sign-in and sessions.
 *
 * Sessions are a signed token (HS256) in an HttpOnly cookie. On every request
 * the user is re-read from the database, so a removed user or changed role
 * takes effect immediately. Passkeys replace passwords before launch; this
 * email-and-password sign-in is for the local prototype.
 */
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { jwtVerify, SignJWT } from "jose";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import type { ActorContext } from "@/services/support";

const COOKIE_NAME = "tradie_session";
const SESSION_DAYS = 7;

export interface SessionUser {
  id: string;
  businessId: string;
  name: string;
  email: string;
  role: "owner" | "crew";
}

function sessionKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET is missing or too short. Run `npm run setup`.");
  }
  return new TextEncoder().encode(secret);
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

// A real hash to compare against when the email is unknown, so a failed
// sign-in takes the same time whether or not the account exists.
let dummyHash: Promise<string> | undefined;

export async function verifyLogin(email: string, password: string) {
  const db = await getDb();
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, email.trim().toLowerCase()))
    .limit(1);
  dummyHash ??= bcrypt.hash("no-such-account", 12);
  const ok = await bcrypt.compare(password, user?.passwordHash ?? (await dummyHash));
  return ok && user ? user : null;
}

export async function startSession(userId: string): Promise<void> {
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(sessionKey());
  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DAYS * 86_400,
  });
}

export async function endSession(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

/** The signed-in user, or null. Cached for the duration of one request. */
export const currentUser = cache(async (): Promise<SessionUser | null> => {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, sessionKey(), { algorithms: ["HS256"] });
    if (!payload.sub) return null;
    const db = await getDb();
    const [user] = await db.select().from(users).where(eq(users.id, payload.sub)).limit(1);
    if (!user) return null;
    return {
      id: user.id,
      businessId: user.businessId,
      name: user.name,
      email: user.email,
      role: user.role,
    };
  } catch {
    return null; // expired or tampered token
  }
});

/** For pages and actions that need any signed-in user. */
export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

/** For anything that shows or changes money. Crew are sent to their jobs list. */
export async function requireOwner(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "owner")
    redirect("/jobs?error=" + encodeURIComponent("Only the owner can see that."));
  return user;
}

export function actorOf(user: SessionUser): ActorContext {
  return { businessId: user.businessId, userId: user.id };
}
