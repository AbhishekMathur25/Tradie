/**
 * Helpers for server actions: read typed values out of FormData, and turn
 * expected errors into a redirect with a message the page shows.
 */
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { parseDollars } from "@/domain/money";
import { UserFacingError } from "./errors";

export function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export function checkbox(form: FormData, name: string): boolean {
  return form.get(name) === "on" || form.get(name) === "true";
}

/** Dollars typed in a form, as cents. Empty is null when `optional`. */
export function dollars(
  form: FormData,
  name: string,
  label: string,
  optional = false,
): number | null {
  const raw = text(form, name);
  if (!raw && optional) return null;
  const cents = parseDollars(raw);
  if (cents === null) throw new UserFacingError(`${label}: enter an amount like 1250.00`);
  return cents;
}

export function optionalDate(form: FormData, name: string): string | null {
  const raw = text(form, name);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

export function integer(form: FormData, name: string): number {
  const value = Number(text(form, name));
  if (!Number.isInteger(value))
    throw new UserFacingError("Something on the form was invalid. Reload and try again.");
  return value;
}

/** The line items a document editor posts as JSON. Validated by the service schema. */
export function jsonField(form: FormData, name: string): unknown {
  try {
    return JSON.parse(text(form, name) || "null");
  } catch {
    throw new UserFacingError("The line items couldn't be read. Reload and try again.");
  }
}

export function withQuery(path: string, params: Record<string, string>): string {
  const [base, existing] = path.split("?");
  const query = new URLSearchParams(existing);
  for (const [key, value] of Object.entries(params)) query.set(key, value);
  return `${base}?${query.toString()}`;
}

/**
 * Runs an action body. On success, redirects to the path it returns. Expected
 * problems (rule blocks, validation) redirect back with `?error=`; anything
 * else is a bug and is re-thrown so it gets logged.
 */
export async function act(errorPath: string, body: () => Promise<string>): Promise<never> {
  let target: string;
  try {
    target = await body();
  } catch (error) {
    if (error instanceof UserFacingError) redirect(withQuery(errorPath, { error: error.message }));
    if (error instanceof ZodError) {
      redirect(
        withQuery(errorPath, {
          error: error.issues[0]?.message ?? "Check the form and try again.",
        }),
      );
    }
    throw error;
  }
  redirect(target);
}
