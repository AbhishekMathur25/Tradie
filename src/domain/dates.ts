/**
 * Date helpers that work on calendar dates ("YYYY-MM-DD") in local time.
 * Business dates (due dates, contract dates) are calendar dates, not instants.
 */

export type IsoDate = string;

export function toIsoDate(date: Date): IsoDate {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function fromIsoDate(value: IsoDate): Date {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(value: IsoDate, days: number): IsoDate {
  const date = fromIsoDate(value);
  date.setDate(date.getDate() + days);
  return toIsoDate(date);
}

/**
 * Adds business days, skipping Saturdays and Sundays. Public holidays are
 * NOT skipped, so results are a guide only and say so wherever shown.
 */
export function addBusinessDays(value: IsoDate, businessDays: number): IsoDate {
  const date = fromIsoDate(value);
  let added = 0;
  while (added < businessDays) {
    date.setDate(date.getDate() + 1);
    const day = date.getDay();
    if (day !== 0 && day !== 6) added += 1;
  }
  return toIsoDate(date);
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  const ms = fromIsoDate(to).getTime() - fromIsoDate(from).getTime();
  return Math.round(ms / 86_400_000);
}

/** Australian financial-year quarter containing the date: Jul–Sep, Oct–Dec, ... */
export function quarterOf(value: IsoDate): { start: IsoDate; end: IsoDate; label: string } {
  const date = fromIsoDate(value);
  const quarterStartMonth = Math.floor(date.getMonth() / 3) * 3;
  const start = new Date(date.getFullYear(), quarterStartMonth, 1);
  const end = new Date(date.getFullYear(), quarterStartMonth + 3, 0);
  const label = `${start.toLocaleString("en-AU", { month: "short" })}–${end.toLocaleString("en-AU", { month: "short" })} ${end.getFullYear()}`;
  return { start: toIsoDate(start), end: toIsoDate(end), label };
}

export function monthStart(value: IsoDate): IsoDate {
  return `${value.slice(0, 7)}-01`;
}

/** "22 Oct 2026" */
export function formatDate(value: IsoDate | Date | null | undefined): string {
  if (!value) return "";
  const date = typeof value === "string" ? fromIsoDate(value) : value;
  return date.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}
