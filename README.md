# Tradie Paperwork

A web app that does the paperwork for Australian tradies, starting with NSW renovators and
small builders: quotes, NSW rule checks, contract tracking, variations, deposit and progress
claims, tax invoices, payment matching and an owner dashboard.

This is the **local prototype** of the plan in the Tradie Paperwork Blueprint (Revision B1).
Payments, email and the Xero push are **simulated**: nothing leaves your computer and no real
money moves.

## What it does

- **Jobs:** one record per job (customer, site, contract, insurance certificate). Every document
  is built from it.
- **Quotes:** price-list lines, GST worked out to the cent, a customer link to accept with name
  and date recorded, and a PDF.
- **AI drafting:** describe the job by typing or speaking (Chrome and Edge), then get draft lines
  matched to your price list. Uses any OpenAI-compatible endpoint. Customer names, addresses,
  emails and phone numbers are removed first. With no key set, an offline keyword matcher is
  used instead. A person checks every line.
- **NSW rule checks** run before anything is sent and block the risky actions:
  - licence number and exact licensee name missing
  - no written contract recorded on work over $5,000
  - deposit over 10% of the contract price
  - any payment request over $20,000 before the insurance certificate is recorded
  - claims beyond the contract plus approved variations
  - buyer details missing on tax invoices of $1,000 or more

  Cooling-off dates are shown as a guide. Every rule is listed on the Settings page with its
  source. These checks stop common mistakes; they are **not legal advice** and each needs a
  lawyer's sign-off before launch.

- **Variations:** sent to the customer for sign-off; approved amounts add to the contract.
- **Deposit, progress and final claims, and invoices:**
  - server-issued numbers, editable until a payment is recorded, then locked
  - tax invoices for GST-registered businesses, plain invoices for those who aren't
- **Payments:**
  - each invoice gets its own (simulated) PayID and reference, and payments are matched
    automatically
  - repeated provider notifications are processed once
  - unmatched payments wait on the Payments page for matching by hand
- **Owner dashboard (facts only):**
  - owed and overdue amounts
  - money coming in over 30 days (forecast)
  - a needs-you list
  - each job's contract position and quoted margin
  - the GST shown on invoices sent this quarter

  Optionally a weekly summary email. It never estimates tax owed or BAS amounts.

- **Accounts:**
  - **Sign up** at `/signup`: creates the business and its owner account in one step.
    Passwords need at least 10 characters and are stored as bcrypt hashes.
  - **Crew join by invite only.** The owner invites them from the Team page; they get a link that
    works once and expires in 7 days, and set their own password. Only a hash of the invite token
    is stored. Owners can cancel invites and remove crew.
- **Roles:** owners see everything. Crew see jobs only, with no money figures anywhere.
- **Outbox:** every email the app would send, and every accounting push, so you can see exactly
  what would leave the system.

## Run it locally

You need Node.js 22 or later. No database install is needed: the app uses PGlite, a full
Postgres that runs inside Node and stores its data in `./.data/pglite`.

```bash
npm install
npm run setup      # creates .env.local with generated secrets
npm run db:reset   # creates the local database and loads demo data
npm run dev        # http://localhost:3000
```

Demo sign-ins (local only) are at the top of [`scripts/seed.ts`](scripts/seed.ts): one owner and
one crew member. Or create your own business at http://localhost:3000/signup. Stop `npm run dev` before running `npm run db:reset`, because PGlite allows one
process at a time.

### Turning on AI drafting (optional)

Add these to `.env.local`, which git ignores. Never put keys or private URLs in tracked files.

```
AI_BASE_URL=<your OpenAI-compatible endpoint, ending in /v1>
AI_API_KEY=<your key>
AI_MODEL=gpt-5-nano
```

## Scripts

| Command                  | What it does                                               |
| ------------------------ | ---------------------------------------------------------- |
| `npm run dev`            | Start the app in development mode                          |
| `npm test`               | Unit tests and database-backed service tests (Vitest)      |
| `npm run lint`           | ESLint                                                     |
| `npm run typecheck`      | TypeScript checks                                          |
| `npm run format`         | Format with Prettier                                       |
| `npm run check:secrets`  | Fail if any tracked file looks like it contains a secret   |
| `npm run db:generate`    | Generate a SQL migration after changing `src/db/schema.ts` |
| `npm run db:migrate`     | Apply migrations (a deploy step for hosted Postgres)       |
| `npm run db:reset`       | Recreate the local database with demo data                 |
| `npm run summary:weekly` | Queue the weekly money summary (schedule it when hosted)   |

## How the code is organised

```
src/
  domain/         Pure logic, no I/O: money and GST, NSW rules, dashboard figures, AI draft parsing
  db/             Drizzle schema and the database connection (PGlite locally, Postgres when hosted)
  services/       Business operations: jobs, documents, payments, dashboard. Take a db so they're testable
  integrations/   Outside services (AI drafting). Payments and Xero are simulated in services for now
  pdf/            Quote and invoice PDFs (pdf-lib, no headless browser)
  lib/            Auth, form helpers, errors, webhook signing
  app/            Next.js pages, server actions, API routes and customer link pages
drizzle/          Generated SQL migrations
scripts/          Setup, migrate, seed, reset, weekly summary, secret scan
tests/            Vitest tests
```

Design rules the code follows:

- Money is whole cents. GST and totals are calculated by code, never by AI.
- Sending runs the rule checks, issues the number, creates the customer link and queues the email
  in one database transaction.
- Edits carry a version number, so a stale form can't overwrite newer changes.
- Payment notifications and accounting pushes are idempotent.
- Every page and server action checks the signed-in user's role on the server.

## Before hosting

- Set `DATABASE_URL` to a Postgres database in an Australian region and run `npm run db:migrate`.
- Generate fresh `SESSION_SECRET` and `PAYMENT_WEBHOOK_SECRET` values in the host's secret store.
- Set `PAYMENTS_MODE=live` to hide test-payment buttons, then connect a real PayID provider to
  `POST /api/webhooks/payments` (signed with `x-signature: sha256=<hmac>`).
- Replace the outbox with a real email provider (`queueEmail` in `src/services/support.ts`).
- Replace the simulated accounting push with Xero (`pushToAccounting` in the same file).
- Still to do before real customers:
  - passkey sign-in (replacing passwords), password reset by email, and sign-in rate limiting
  - bank-detail change protection
  - file uploads for contracts and certificates
  - credit notes
  - a lawyer's review of every rule and of the tax wording

## Licence

Private and unlicensed for now. All rights reserved.
