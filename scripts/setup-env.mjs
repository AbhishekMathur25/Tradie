// Creates .env.local from .env.example and fills in generated secrets.
// Safe to run more than once: existing values are never overwritten.
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const EXAMPLE = ".env.example";
const TARGET = ".env.local";
const GENERATED = ["SESSION_SECRET", "PAYMENT_WEBHOOK_SECRET"];

const source = existsSync(TARGET) ? readFileSync(TARGET, "utf8") : readFileSync(EXAMPLE, "utf8");

let filled = 0;
const lines = source.split(/\r?\n/).map((line) => {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match && GENERATED.includes(match[1]) && match[2].trim() === "") {
    filled += 1;
    return `${match[1]}=${randomBytes(32).toString("hex")}`;
  }
  return line;
});

writeFileSync(TARGET, lines.join("\n"));
console.log(
  `${TARGET} ready (${filled} secret${filled === 1 ? "" : "s"} generated). ` +
    "Add AI_BASE_URL and AI_API_KEY there if you want AI drafting.",
);
