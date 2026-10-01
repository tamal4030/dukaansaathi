# PROGRESS

Status of every part of DukaanSaathi, written to be accurate rather than
flattering. "Verified" means a command was actually run in this workspace and
passed. "Written" means the code exists but has not been exercised against real
infrastructure.

**Last full check run:** all commands in the table at the end of this file.
**No official documentation template existed in the workspace**, so this is a
project-specific document.

## Summary

| Area | Code | Verified how |
| --- | --- | --- |
| Database schema and migration | **Live** | Schema validates; **migration applied to Supabase**. 16 tables, 52 indexes verified by SQL. |
| Backend API | Written | Typecheck passes; 130 mocked tests pass |
| Backend over real HTTP | Written | **65/65 integration checks pass** against a real Express server (in-memory DB) |
| Backend vs PostgreSQL | **Live** | **31/31 real end-to-end checks pass** against Supabase PostgreSQL |
| Frontend | Written | Typecheck and production build pass; 47 mocked tests pass |
| Frontend vs live backend | — | **Never run.** No browser session against a running API. |
| DeepSeek assistant | **Live** | Real calls succeed; assistant used the real database price |
| Sarvam speech | **Live** | Real STT and TTS calls succeed |
| Resend email | Written | Mocked tests only. **No live send** (credentials absent). |
| Deployment | Not done | No Render config applied; no deploy has been attempted |

## Live verification results

### Database (Supabase PostgreSQL)

- `prisma validate` — valid with real credentials.
- `prisma migrate deploy` — **applied successfully**. Migration `20260101000000_init`.
- Verified by direct SQL: **16 tables, 52 indexes**, enums with correct label
  counts (`Availability(3)`, `BusinessCategory(7)`, `OrderStatus(7)`,
  `UserRole(3)`, `BusinessRole(3)`).
- `db:demo` seed — **completed**: 7 businesses (one per category), 42 products
  spanning all three availability states, 30 orders, 6 conversations,
  49 hours rows, 21 FAQs, 20 reviews, 11 conversation-feedback rows,
  40 order items, 70 status events, 7 members.
- **Unique constraints proven to be real**: inserting a duplicate `Order.orderCode`
  and a duplicate `OrderReview.orderId` both failed with `P2002`.

### Providers

- **DeepSeek** — plain completion and JSON mode both succeed. The configured
  model is a *reasoning* model, so it returns `reasoning_content` and reasoning
  tokens count against `max_tokens`.
- **Sarvam** — STT returns 200 and auto-detects the language; TTS returns real
  audio (~50k base64 chars).
- **Resend** — not configured, so email remains unverified. Orders still save and
  the API reports the skip honestly.

### Real end-to-end run

`backend/tests/e2e.postgres.ts` boots the real Express app and drives it over
real HTTP against the real Supabase database, calling the real DeepSeek and
Sarvam APIs. **31/31 checks pass**, including order creation inside a real
transaction, price snapshots, the full status lifecycle, review constraints,
tenant isolation, and two live assistant exchanges.

Sample live assistant reply (real model, real database price):

> "Yes, we have E2E Atta 5kg. It is priced at Rs 265.00 and is currently
> available. Would you like to add it to your cart?"

And when asked about something the shop does not stock:

> "I couldn't find washing machines in this store's catalog — E2E Check Shop is
> listed under grocery and daily essentials. I can pass your request on to the
> business if you'd like."

## Bugs found by real infrastructure

These could not have been caught by the in-memory double or by mocks:

1. **Demo seed violated `Order.orderCode` UNIQUE on re-run.** The counter reset
   each run, so a second run collided. Fixed by including the business key in the
   code and deleting prior demo orders first.
2. **`bulbul:v2` is deprecated and `anushka` is not a v3 speaker.** The provider
   returned explicit 400s naming both problems. Defaults corrected to
   `bulbul:v3` / `ritu`; the valid speaker list is recorded in the code.
3. **DeepSeek token budget was a production bug.** Reasoning tokens share
   `max_tokens`, so `maxTokens: 700` could be consumed entirely by reasoning,
   producing an empty answer. Raised to 2500 and the error now distinguishes
   reasoning exhaustion from an empty reply.
4. **Interactive transactions timed out with `P2028`.** Prisma's default is 5 s;
   order creation writes an order plus items plus a status event, and each step
   costs a network round trip. Every `$transaction` now sets
   `timeout: 20000, maxWait: 10000`.
5. **`connection_limit=1` serialised the pool.** The merchant overview fires nine
   parallel queries; a limit of 1 tripped the 10 s pool timeout. Raised to 10 with
   `pool_timeout=20`. The Supabase guidance of `connection_limit=1` is for
   serverless functions, not a long-running Express service.

## Local HTTP integration harness

`backend/tests/e2e.local.ts` boots the real Express app on a real port and drives
it over real HTTP using the same paths the frontend uses. Run it with
`npm run test:e2e:local` (or `node node_modules/tsx/dist/cli.mjs tests/e2e.local.ts`).

**65 checks pass**, covering: health and capability flags; guest browsing with
search and the public-data boundary; guest chat with a server-issued token and
prompt scoping; the order sign-in gate and server-side totals; tenant isolation
returning 404 for a foreign business; the full status lifecycle and review rules;
CSV import preview/commit with row-level errors; template and export downloads;
and the speech endpoints.

**What it proves:** the HTTP contract works end to end — routing, status codes,
validation, authorization and response shapes.

**What it does NOT prove:** there is no PostgreSQL (the app runs against the
in-memory double, which enforces neither unique constraints nor transaction
rollback), no live provider is called, and no browser is involved. It is **not**
a substitute for a real database or a real end-to-end session.

Two defects in the harness itself were found and fixed while running it: the
process hung because `server.close()` waits on undici keep-alive sockets (now
`closeAllConnections()` plus an explicit exit), and the CSV template download was
being parsed as JSON (now read as text).

## Backend — complete and typechecked

Implemented and passing typecheck:

- **Config and startup** (`config/env.ts`, `index.ts`): refuses to start without
  `DATABASE_URL`, probes the database with `SELECT 1`, logs which integrations
  lack credentials, handles SIGTERM/SIGINT.
- **Schema** (`prisma/schema.prisma`): 15 models, 3 enums for availability,
  business category and order status, indexes on the fields the API filters by.
- **Migration** (`prisma/migrations/20260101000000_init/migration.sql`): 439
  lines, generated by `prisma migrate diff` from the schema. **Never applied.**
- **Auth** (`middleware/auth.ts`): Supabase token verification via legacy HS256
  secret, JWKS, or the Auth server as a fallback; upserts a `UserProfile` from
  the `sub` claim. Anonymous sessions are rejected from account routes.
- **Tenant isolation** (`services/businessAccess.ts`): every merchant request is
  re-checked against `BusinessMember`. A foreign business returns **404**, not
  403, so the API never confirms that another tenant's business exists.
- **Public browsing** (`routes/publicBusinesses.ts`): directory with search and
  category filters, recently-accessed lookup, business detail with rating
  summary, and the public product catalogue. Private fields are never serialised.
- **Chat** (`routes/conversations.ts`): guest conversations get a server-issued
  `randomBytes(32)` token; the business always comes from the stored
  conversation, never from the request body.
- **Assistant** (`services/assistantService.ts`, `deepseek.ts`, `prompt.ts`,
  `assistantGuard.ts`): keyword retrieval with alias support, structured facts,
  proposal validation against live products, and a guard that rewrites any
  "order placed" or "payment received" claim. **DeepSeek is the only provider;
  there is no fallback.**
- **Speech** (`services/sarvam.ts`, `sarvamKeys.ts`): multi-key pool with
  key-specific failover, `Retry-After` handling, bounded backoff, and redaction.
- **Orders** (`services/orders.ts`): server-side quoting, transactional creation
  with price snapshots and an initial status event, fulfilment-aware status
  transitions, and full status history.
- **Email** (`services/notifications.ts`): opt-in checks for both parties, a
  `NotificationLog` row for every attempt, and failures that never roll back an
  order.
- **Products** (`services/products/*`): XLSX and CSV import with row-level
  errors and preview-before-commit, plus export and a documented template.

### Backend test suites — 130 tests, all mocked

| File | Tests | What it covers |
| --- | --- | --- |
| `availability.test.ts` | 6 | Unknown is never Available; exported labels re-import correctly |
| `orderStatus.test.ts` | 7 | Transitions, pickup vs delivery, terminal states |
| `hours.test.ts` | 7 | Open/closed/unknown in IST, overnight windows |
| `search.test.ts` | 5 | Alias matching, ranking, no-match |
| `api.public.test.ts` | 9 | Guest browsing, filters, no private data leaked |
| `api.auth.test.ts` | 10 | Tenant isolation, guest tokens, cross-customer access |
| `api.orders.test.ts` | 17 | Server totals, confirmation gate, Google gate, transitions |
| `api.notifications.test.ts` | 6 | Opt-in only; failures never roll back |
| `api.assistant.test.ts` | 17 | Prompt scoping, guardrails, no order from a proposal |
| `api.products.test.ts` | 16 | Import validation, round-trip, CRUD, archive |
| `sarvamKeys.test.ts` | 30 | Key selection, 401 failover, 429 Retry-After, redaction |

**Important limitation.** These run against `tests/fakePrisma.ts`, an in-memory
Prisma double, because no PostgreSQL server is available in this environment.
The double implements the query API the routes use, but it does **not** enforce
unique constraints and does **not** roll back failed transactions. So:

- The duplicate-review rule rests on the schema's `orderId @unique` plus a route
  check — it has **not** been proven by a real database constraint.
- Transactional atomicity of order creation is **not** proven.
- Index behaviour and query plans are **not** proven.

## Frontend — complete, builds, tested

Implemented: landing with language selector, guest discovery with search,
category, All and Recently accessed views, business profile with hours/policies/
FAQs/catalogue, per-business chat with voice input, cart, checkout with the
Google sign-in gate, order history and detail with reviews, account page, and the
merchant dashboard (overview, orders, products with import/export, business
profile, conversations, reviews).

### Frontend test suites — 47 tests, all mocked

| File | Tests | What it covers |
| --- | --- | --- |
| `lib/api.contract.test.ts` | 11 | Every path the UI calls, compared against the Express routes |
| `lib/availability.test.tsx` | 5 | Unknown never renders as Available; not orderable |
| `lib/i18n.test.tsx` | 8 | en/bn/hi selector drives every label, persistence, status keys |
| `providers/CartProvider.test.tsx` | 7 | Add/increment/remove/clear, persistence across sign-in |
| `pages/customer/ExplorePage.test.tsx` | 9 | Guest browsing, states, filters, `/meta` labels |
| `pages/merchant/ProductsPage.test.tsx` | 7 | Listing, availability change, import preview gating |

All frontend tests stub `fetch`; nothing reaches the network.

## Fixed during development

Bugs found by actually running the checks, not by reading the code:

1. `assistantService.ts` used `Prisma` without importing it — every chat reply
   that proposed a cart item returned HTTP 500. Plain-text replies hid it.
2. Exported XLSX files could not be re-imported: the exporter wrote
   "Availability unknown" but the parser only accepted "unknown".
3. Two `fakePrisma` fidelity gaps: `undefined` did not mean "leave unchanged"
   (wiping `fullName` during auth upsert), and Decimal columns were returned as
   strings, breaking `.mul()`.
4. `npm run build` was broken: `tsc -b` failed with `TS2688: Cannot find type
   definition file for 'node'` because `@types/node` was never installed in the
   frontend. **This would have failed on Vercel too.**
5. `prisma validate` failed with P1012 because `DIRECT_URL` was empty. Fixed in
   `.env.example`; the local `.env` still needs a real value from the operator.
6. `BusinessPage` recorded a visit inside `useMemo` — a side effect during
   render, which React may repeat or discard, duplicating a `POST /account/recent`.
7. The Explore category filter derived labels from loaded results, so an empty
   list showed raw enums like `GROCERY_DAILY_ESSENTIALS`. Now uses `/api/meta`.

## Current local configuration state

A snapshot of which backend variables are present in `backend/.env`. **Names
only — no values are recorded here or anywhere else.** "Missing" means the
variable is empty or absent.

| Present | Missing |
| --- | --- |
| `PORT`, `NODE_ENV`, `FRONTEND_URL`, `CORS_ALLOWED_ORIGINS` | `DATABASE_URL`, `DIRECT_URL` |
| `REQUIRE_GOOGLE_FOR_ORDERS`, `DEEPSEEK_TIMEOUT_MS` | `SUPABASE_URL`, `SUPABASE_ANON_KEY` |
| `DEEPSEEK_API_KEY` (not confirmed rotated) | `DEEPSEEK_MODEL` |
| `SARVAM_API_KEY_1`, `SARVAM_API_KEY_2`, `SARVAM_API_KEY_3` | `RESEND_API_KEY`, `EMAIL_FROM` |
| `SARVAM_STT_MODEL`, `SARVAM_TTS_MODEL`, `SARVAM_TTS_SPEAKER` | `SUPABASE_JWT_SECRET` *(optional — see note)* |
| `AI_RATE_LIMIT_PER_MINUTE`, `PUBLIC_RATE_LIMIT_PER_MINUTE` | |

**`SUPABASE_JWT_SECRET` is genuinely optional.** The auth verifier
(`backend/src/middleware/auth.ts`) reads it only when the incoming token header
says `alg: HS256`. Otherwise it verifies through the project JWKS endpoint, and
falls back to the Supabase Auth server using `SUPABASE_ANON_KEY`. Modern
Supabase projects sign with asymmetric keys, so this variable is not needed.
**`SUPABASE_ANON_KEY` is required**, because the Auth-server fallback uses it as
the `apikey` header.

Consequences: migrations cannot run (no `DATABASE_URL`/`DIRECT_URL`), sign-in
cannot work (no Supabase values), the assistant cannot start (no
`DEEPSEEK_MODEL`), and no email can be sent. Voice features have keys, but their
endpoints and model ids are unverified, so they have not been exercised.

## Not verified — read this before trusting anything

1. **No PostgreSQL has ever been reached.** `prisma migrate deploy`, `db:seed`
   and `db:demo` have **never run**. Every database behaviour claim in this repo
   is unproven against a real database.
2. **No live provider call has ever been made** to DeepSeek, Sarvam or Resend.
3. **No end-to-end session.** The frontend has never talked to a running backend.
4. **Provider identifiers are unverified.** `DEEPSEEK_MODEL` is deliberately
   empty. Sarvam's base URL, paths and model ids are best-effort and env-
   configurable. Documentation hosts were unreachable from this environment.
5. **No deployment.** No Render configuration exists and nothing has been
   deployed. No Vercel deploy has been attempted from here either.
6. **Rate limiting is in-memory**, which is correct for one Render instance and
   wrong for several. A shared store is required to scale.
7. **Frontend bundle is one ~593 kB chunk.** Code splitting is an obvious
   improvement, not a correctness problem.
8. **`Keys/` still holds key copies.** Delete them once `backend/.env` is
   confirmed working.
9. **The DeepSeek key has not been confirmed rotated.** A 6-character prefix
   appeared in an earlier transcript. Do not use it until rotation is confirmed.

## Commands and results

Run from the repository root. Note: `npm run <script>` cannot resolve local
binaries in the development sandbox used here, so the underlying binaries were
invoked directly. The commands are equivalent.

| Command | Result |
| --- | --- |
| `cd backend && tsc -p tsconfig.json --noEmit` | Pass |
| `cd backend && vitest run` | 11 files, 130 tests pass |
| `cd frontend && tsc -b` | Pass |
| `cd frontend && vite build` | Pass (592.98 kB JS, gzip 158.46 kB) |
| `cd frontend && vitest run` | 6 files, 47 tests pass |
| `prisma validate` (placeholder URLs) | Pass |
| `prisma generate` | Pass |
| `prisma migrate deploy` | **Not run** — no database |
| `npm run db:demo` | **Not run** — no database |
