/**
 * Password hashing and rules. Kept apart from sessions so services and
 * scripts can use it without pulling in Next.js request APIs.
 */
import bcrypt from "bcryptjs";
import { z } from "zod";

export const MIN_PASSWORD_LENGTH = 10;

export const passwordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters for your password`)
  .max(200, "That password is too long");

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export function checkPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/** Emails are stored lower-case and trimmed, so sign-in isn't case-sensitive. */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}
