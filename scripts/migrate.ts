/**
 * Applies database migrations. For hosted Postgres (DATABASE_URL set) run
 * this as a deploy step. The local PGlite database migrates on first use too.
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main() {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { Pool } = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    const pool = new Pool({ connectionString: url });
    await migrate(drizzle(pool), { migrationsFolder: "drizzle" });
    await pool.end();
    console.log("Migrations applied to the hosted database.");
  } else {
    const { openPglite } = await import("../src/db/client");
    await openPglite(process.env.PGLITE_DIR || "./.data/pglite");
    console.log("Migrations applied to the local database.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
