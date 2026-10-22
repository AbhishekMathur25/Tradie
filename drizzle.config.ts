import { defineConfig } from "drizzle-kit";

// Generates SQL migrations from the schema. Generation needs no database
// connection; migrations are applied by scripts/migrate.ts or on first use
// of the local PGlite database.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
});
