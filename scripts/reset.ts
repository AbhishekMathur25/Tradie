/**
 * Deletes the local PGlite database, recreates it and loads the demo data.
 * Stop `npm run dev` first: PGlite allows one process at a time.
 */
import { rmSync } from "node:fs";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main() {
  if (process.env.DATABASE_URL) {
    console.error("db:reset only works on the local database. Unset DATABASE_URL.");
    process.exit(1);
  }
  const dir = process.env.PGLITE_DIR || "./.data/pglite";
  rmSync(dir, { recursive: true, force: true });
  console.log(`Removed ${dir}.`);
  const { seed } = await import("./seed");
  await seed(); // opening the database runs the migrations
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
