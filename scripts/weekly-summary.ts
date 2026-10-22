/**
 * Queues the weekly money summary for every business. Schedule it (e.g. a
 * Friday afternoon cron job) once the app is hosted.
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main() {
  const { getDb } = await import("../src/db/client");
  const { businesses } = await import("../src/db/schema");
  const { todayIso } = await import("../src/domain/dashboard");
  const { sendWeeklySummary } = await import("../src/services/dashboard");
  const db = await getDb();
  const rows = await db.select({ id: businesses.id }).from(businesses);
  let total = 0;
  for (const row of rows) total += await sendWeeklySummary(db, row.id, todayIso());
  console.log(`Queued ${total} weekly summar${total === 1 ? "y" : "ies"}.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
