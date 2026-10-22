// Fails if any file git would publish contains something that looks like a
// secret, or any value from .env.local. Prints file names only, never values.
// Run before every push: `npm run check:secrets` (CI runs it too).
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const PATTERNS = [
  { name: "API key (sk-...)", regex: /\bsk-[A-Za-z0-9_-]{16,}/ },
  { name: "private key block", regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "Azure host", regex: /[a-z0-9-]+\.azurewebsites\.net/i },
];

// Values of sensitive settings in the local env file must never appear in
// tracked files. Non-secret settings (model names, localhost) are skipped.
const SENSITIVE_KEY = /SECRET|KEY|TOKEN|PASSWORD|DATABASE_URL|BASE_URL/;
const localValues = existsSync(".env.local")
  ? readFileSync(".env.local", "utf8")
      .split(/\r?\n/)
      .map((line) => line.match(/^([A-Z0-9_]+)=(.+)$/))
      .filter((match) => match && SENSITIVE_KEY.test(match[1]))
      .map((match) => match[2].trim())
      .filter((value) => value.length >= 12)
  : [];

const files = execSync("git ls-files --cached --others --exclude-standard", { encoding: "utf8" })
  .split(/\r?\n/)
  .filter((file) => file && existsSync(file) && file !== "scripts/check-secrets.mjs");

const problems = [];
for (const file of files) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue; // unreadable or binary
  }
  for (const { name, regex } of PATTERNS) {
    if (regex.test(text)) problems.push(`${file}: looks like a ${name}`);
  }
  if (localValues.some((value) => text.includes(value))) {
    problems.push(`${file}: contains a value from .env.local`);
  }
}

if (problems.length > 0) {
  console.error("Possible secrets found. Remove them before committing:\n" + problems.join("\n"));
  process.exit(1);
}
console.log(`No secrets found in ${files.length} files.`);
