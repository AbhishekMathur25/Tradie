/**
 * Database connection.
 *
 * - Local (no DATABASE_URL): PGlite, a full Postgres compiled to WebAssembly,
 *   stored in PGLITE_DIR. No install needed. Migrations run on first use.
 * - Hosted (DATABASE_URL set): a normal Postgres pool. Run `npm run db:migrate`
 *   as a deploy step; the app does not migrate a shared database by itself.
 *
 * Both drivers expose the same Drizzle query API, so the rest of the code
 * only sees the `Db` type.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { drizzle as drizzlePostgres } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type Db = PgliteDatabase<typeof schema>;
/** A transaction handle; services accept either a Db or a Tx. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;

export const MIGRATIONS_FOLDER = path.join(process.cwd(), "drizzle");

/** Opens a PGlite database (in memory when `dataDir` is omitted) and migrates it. */
export async function openPglite(dataDir?: string): Promise<Db> {
  if (dataDir) mkdirSync(dataDir, { recursive: true });
  const client = dataDir ? new PGlite(dataDir) : new PGlite();
  const db = drizzlePglite(client, { schema });
  await migratePglite(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db;
}

function openPostgres(url: string): Db {
  const pool = new Pool({ connectionString: url, max: 10 });
  // Same query builder API; the cast keeps one Db type across the codebase.
  return drizzlePostgres(pool, { schema }) as unknown as Db;
}

// Reuse one connection across hot reloads in development.
const globalForDb = globalThis as unknown as { __tradieDb?: Promise<Db> };

export function getDb(): Promise<Db> {
  if (!globalForDb.__tradieDb) {
    const url = process.env.DATABASE_URL;
    globalForDb.__tradieDb = url
      ? Promise.resolve(openPostgres(url))
      : openPglite(process.env.PGLITE_DIR || "./.data/pglite");
  }
  return globalForDb.__tradieDb;
}
