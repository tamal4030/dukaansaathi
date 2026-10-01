# DEPLOYMENT

How to set up and deploy DukaanSaathi. **No official deployment template
existed in the workspace**, so this is a project-specific guide.

> **Status: nothing here has been executed.** No database has been provisioned,
> no service has been deployed, and no provider call has been made. Every step
> below is written from the code, not from a successful run. Treat it as
> instructions, not as a record.

## 0. Setup checklist

Nothing in this project can be verified end to end until the items below exist.
The right-hand column is what currently blocks progress.

| # | Supply | Where it goes | Blocks |
| --- | --- | --- | --- |
| 1 | Supabase **pooled** connection string (port 6543) | `DATABASE_URL` | Everything database-backed |
| 2 | Supabase **direct** connection string (port 5432), non-empty | `DIRECT_URL` | `prisma migrate deploy` (P1012 if empty) |
| 3 | Supabase project URL and anon key | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Sign-in |
| 4 | Google OAuth enabled in Supabase, with redirect URLs allow-listed | Supabase dashboard | Customer order submission |
| 5 | DeepSeek API key, and the **current official Flash model id** | `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL` | The assistant |
| 6 | Sarvam API key(s) | `SARVAM_API_KEY_1..3` | Voice input and Bengali/Hindi playback |
| 7 | Resend API key and a verified sending address | `RESEND_API_KEY`, `EMAIL_FROM` | Order notification email |
| 8 | Vercel project linked to this repository | Vercel dashboard | Frontend hosting |
| 9 | Render web service from `render.yaml` | Render dashboard | API hosting |
| 10 | Production URLs set on both sides | `FRONTEND_URL`, `CORS_ALLOWED_ORIGINS`, `VITE_API_BASE_URL` | Cross-origin calls |

**Never paste real values into a chat, an issue, or a document.** Set them in
`backend/.env` locally (git-ignored) and in the Render/Vercel environment
settings. The frontend may only ever receive the Supabase **anon** key.

## 1. Architecture

| Component | Host | Notes |
| --- | --- | --- |
| Frontend (React SPA) | Vercel | Static build from `frontend/` |
| Backend (Express API) | Render | Web service from `backend/` |
| Database + Auth | Supabase | Managed PostgreSQL, Google OAuth |
| Assistant | DeepSeek | Server-side only |
| Speech | Sarvam AI | Server-side only |
| Email | Resend | Server-side only, opt-in |

## 2. Prerequisites

- Node.js 20 or newer.
- A Supabase project.
- A Google Cloud project for OAuth (optional until customers place orders).
- Accounts with DeepSeek, Sarvam and Resend (optional; the app degrades
  gracefully without them and says so in the UI).

## 3. Local development

```bash
# 1. Install
npm run install:all          # or: npm --prefix backend install && npm --prefix frontend install

# 2. Configure the backend
cp backend/.env.example backend/.env
#    Edit backend/.env - see section 5. Never commit this file.

# 3. Generate the Prisma client and apply migrations
#    Both DATABASE_URL and DIRECT_URL must be real, non-empty values first:
#    Prisma fails with P1012 if DIRECT_URL is empty.
npm --prefix backend run db:generate
npm --prefix backend run db:migrate        # prisma migrate deploy

# 4. Optional: load clearly-marked sample shops across all seven categories
npm --prefix backend run db:demo
#    npm --prefix backend run db:demo:reset  # remove demo data and recreate it

# 5. Run both services
npm run dev:backend          # http://localhost:8080
npm run dev:frontend         # http://localhost:5173 (proxies /api to :8080)

# 6. Run the automated checks
npm --prefix backend run test          # 130 unit/integration tests (in-memory DB)
npm --prefix backend run test:e2e:local # 65 checks over real HTTP (in-memory DB)
npm --prefix frontend run test         # 47 component/contract tests
```

The Vite dev server proxies `/api` to `http://localhost:8080`, so the browser
talks to the API on one origin during development and CORS stays a deployment
concern.

### A note on `npm run` in restricted shells

In some sandboxes `npm run <script>` cannot resolve local binaries and fails
with `'tsc' is not recognized`. That is a shell/PATH limitation, not a project
problem. The equivalent direct invocations are:

```bash
node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit   # backend typecheck
node node_modules/vitest/vitest.mjs run                          # backend tests
node node_modules/typescript/bin/tsc -b                          # frontend typecheck
node node_modules/vite/bin/vite.js build                         # frontend build
node node_modules/vitest/vitest.mjs run                          # frontend tests
```

## 4. Supabase setup

1. Create a project at supabase.com and wait for provisioning.
2. **Project Settings -> Database -> Connection string.** Copy two values:
   - **Pooled** (port `6543`, `?pgbouncer=true&connection_limit=1`) -> this is
     `DATABASE_URL`. The API uses it at runtime.
   - **Direct** (port `5432`) -> this is `DIRECT_URL`. Prisma uses it for
     migrations.
3. **Project Settings -> API.** Copy the Project URL -> `SUPABASE_URL`, and the
   `anon` public key -> `SUPABASE_ANON_KEY` (backend) and
   `VITE_SUPABASE_ANON_KEY` (frontend).
4. **Authentication -> Providers -> Google.** Enable it and set the redirect
   URLs in section 6.

### `connection_limit` on the pooled URL

The Supabase pooler URL must include `?pgbouncer=true&connection_limit=10&pool_timeout=20`.
A limit of **1** is the standard advice for *serverless* functions, where each
invocation opens one connection. DukaanSaathi is a **long-running Express
service** and its merchant overview fires **nine parallel queries**; with a limit
of 1 those serialise and trip Prisma's 10-second pool timeout. This was observed
and fixed during live testing. Raise the limit if you scale up, remembering that
each instance opens its own pool.

### Interactive transaction timeouts

Prisma's interactive transactions default to a **5-second** timeout. Order
creation writes an order, its items and the first status event, and a managed
database adds network latency to each step, so the default fails with `P2028`
under real conditions. Every `$transaction` in this codebase passes
`{ timeout: 20000, maxWait: 10000 }`. If you deploy far from your database
region, measure and adjust.

### `DIRECT_URL` must not be empty

Prisma declares `directUrl = env("DIRECT_URL")`, and an empty value fails schema
validation with:

```
Error code: P1012
error: Error validating datasource `db`: You must provide a nonempty direct URL.
```

This blocks `prisma migrate deploy`, so a blank `DIRECT_URL` means **migrations
cannot run**. Set it to the real direct connection string. For local development
against a database without a pooler, the same value as `DATABASE_URL` is
acceptable.

`.env.example` ships a non-empty placeholder for this reason. A placeholder
validates the schema but cannot connect anywhere — never treat it as
configuration.

## 5. Environment variables

### Backend (Render dashboard -> Environment)

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes | Supabase **pooled** connection string (port 6543) |
| `DIRECT_URL` | Yes | Supabase **direct** connection string (port 5432). Must be non-empty. |
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_ANON_KEY` | Yes | Supabase anon key. Also used as the `apikey` header on the Auth-server fallback path. |
| `SUPABASE_JWT_SECRET` | **No** — optional | Read only when the token header is `HS256` (legacy projects). Modern projects verify through the JWKS endpoint, so this is not needed. Do not request it unnecessarily. |
| `PORT` | Set by Render | Render injects this; the app also defaults to 8080 |
| `NODE_ENV` | Yes | `production` |
| `FRONTEND_URL` | Yes | Vercel URL, used for links inside emails |
| `CORS_ALLOWED_ORIGINS` | Yes | Comma-separated browser origins |
| `REQUIRE_GOOGLE_FOR_ORDERS` | No | Defaults to `true` |
| `DEEPSEEK_API_KEY` | For the assistant | DeepSeek key |
| `DEEPSEEK_MODEL` | For the assistant | **Must be the current official Flash model id.** See section 8. |
| `DEEPSEEK_TIMEOUT_MS` | No | Defaults to 25000 |
| `SARVAM_API_KEY_1..3` | For voice | Sarvam keys; tried in order |
| `SARVAM_API_KEY` | No | Legacy single-key form, kept for compatibility |
| `SARVAM_STT_MODEL` / `SARVAM_TTS_MODEL` / `SARVAM_TTS_SPEAKER` | No | Override the best-effort defaults |
| `RESEND_API_KEY` / `EMAIL_FROM` | For email | Resend credentials |
| `AI_RATE_LIMIT_PER_MINUTE` | No | Defaults to 12 |
| `PUBLIC_RATE_LIMIT_PER_MINUTE` | No | Defaults to 120 |

### Frontend (Vercel dashboard -> Environment Variables)

| Variable | Required | Purpose |
| --- | --- | --- |
| `VITE_API_BASE_URL` | Yes | Render URL including `/api`, e.g. `https://your-api.onrender.com/api` |
| `VITE_SUPABASE_URL` | Yes | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Yes | Supabase **anon** key only |

**Only the anon key belongs in the frontend.** It is designed to be public.
Never put a `service_role` key, a database URL, or a provider key in any
`VITE_` variable: Vite inlines them into the browser bundle.

## 6. Google OAuth redirect URLs

In **Supabase -> Authentication -> URL Configuration**, set:

- **Site URL:** `https://your-frontend.vercel.app`
- **Redirect URLs:**
  - `https://your-frontend.vercel.app/auth/customer`
  - `http://localhost:5173/auth/customer`

The frontend sends `redirectTo = ${window.location.origin}/auth/customer`, so
both the deployed origin and localhost must be allow-listed or Google sign-in
fails with a redirect error.

## 7. Render deployment

### Service settings

| Setting | Value |
| --- | --- |
| Type | Web Service |
| Root directory | `backend` |
| Runtime | Node |
| Build command | `npm install && npx prisma generate && npm run build` |
| Start command | `npm run start` |
| Health check path | `/api/health` |
| Auto-deploy | On, from the main branch |

`render.yaml` in the repository root encodes these settings. **It has not been
applied to a real Render account.**

### Migrations

Migrations are **not** run automatically on start, so a deploy cannot silently
alter production data. Run them deliberately:

```bash
# From the Render Shell, or locally against the Supabase direct URL:
npm --prefix backend run db:migrate      # prisma migrate deploy
```

Because `migrate deploy` needs `DIRECT_URL`, confirm it is set before deploying.

### Demo data

```bash
npm --prefix backend run db:demo
```

This writes clearly-marked sample businesses (slugs starting with `demo-`, auth
ids starting with `demo-`, emails under `.invalid`) across all seven categories,
with products, hours, FAQs, conversations, orders and reviews. It creates **no
passwords**. To attach an existing signed-in account as owner:

```bash
npm --prefix backend run db:demo -- --owner-email=you@example.com
```

**Do not seed demo data into a production database** unless you intend to show
sample shops to real customers. Use `db:demo:reset` to remove it.

### Render's filesystem

Render's local disk is ephemeral. DukaanSaathi stores nothing there: PostgreSQL
holds all state. No persistent disk is required.

## 8. Provider configuration

### DeepSeek (the only LLM)

`DEEPSEEK_MODEL` **must be set to the current official DeepSeek Flash model
identifier**. It is deliberately left blank in `.env.example` because it could
not be verified from the environment where this was built (documentation hosts
were unreachable). Do not guess it and do not substitute another provider.

How to find it: open the official DeepSeek API documentation, read the current
model list, and put the Flash identifier in `DEEPSEEK_MODEL`. If the value is
wrong, the API returns an explicit error naming the variable rather than
silently calling something else. There is no fallback provider by design.

### Sarvam (speech)

`SARVAM_BASE_URL`, `SARVAM_STT_PATH`, `SARVAM_TTS_PATH`, `SARVAM_STT_MODEL`,
`SARVAM_TTS_MODEL` and `SARVAM_TTS_SPEAKER` are **best-effort and unverified**;
the documentation could not be reached. They are all environment variables so
they can be corrected without a code change. Verify them against the official
Sarvam API reference before relying on voice features.

Multiple keys are supported. `SARVAM_API_KEY_1..3` are tried in order, and the
legacy `SARVAM_API_KEY` still works. Rules:

- Blank and duplicate keys are ignored.
- A key is only skipped on **401/403**, which means the provider rejected that
  specific key.
- On **429** the code waits for `Retry-After` and retries the **same** key.
  Keys are never rotated to sidestep a shared account quota.
- Transient failures use bounded exponential backoff, then fail gracefully.

### Resend (email)

Set `RESEND_API_KEY` and `EMAIL_FROM` (for example
`DukaanSaathi <no-reply@yourdomain.com>`). The sending domain must be verified
in Resend. Without these variables the app still works end to end; orders are
saved, and the UI states that email delivery is not configured. A skipped or
failed email is recorded in `NotificationLog` and never reported as sent.

## 9. CORS

Set `CORS_ALLOWED_ORIGINS` to a comma-separated list of browser origins, for
example:

```
https://your-frontend.vercel.app,http://localhost:5173
```

`FRONTEND_URL` is always allowed in addition. Requests from any other origin are
rejected with `CORS_BLOCKED`. Note that preview deployments get unique URLs; add
them explicitly or they will be blocked.

## 10. Post-deploy checklist

1. `GET https://your-api.onrender.com/api/health` returns `{"status":"ok"}`.
2. `GET https://your-api.onrender.com/api/health/features` reports which
   integrations have credentials. Anything `false` is genuinely unavailable.
3. `npm --prefix backend run db:migrate` has been run against production.
4. The frontend loads `/explore` and lists businesses.
5. A guest can open a shop and send a chat message.
6. Business sign-up, login and business setup work.
7. Google sign-in works and an order can be placed.
8. Voice input works if `SARVAM_API_KEY_*` is set.

## 12. Free-plan deployment walkthrough (Vercel Hobby + Render Free)

This is the exact order to deploy on free plans. The order matters: Render's URL
is needed by Vercel, and Vercel's URL is needed back on Render.

### Before you start

- `render.yaml` uses `plan: free`. The `starter` plan is paid, so do not change it
  back unless you intend to be billed.
- **`DIRECT_URL` must be set on Render before the first build.** Render runs
  `npx prisma generate` during the build, and Prisma refuses to load the schema
  when the direct URL is empty (error P1012). A missing `DIRECT_URL` fails the
  build, not just the migration step.
- The database is already migrated. Migrations are deliberately not run
  automatically on deploy, so a deploy cannot alter production data.

### Step 1 - Render (the API)

1. render.com -> **New +** -> **Blueprint** -> connect the GitHub repo.
   Render reads `render.yaml` and shows the service it will create.
2. It will prompt for every variable marked `sync: false`. Supply:

   | Variable | Value |
   | --- | --- |
   | `DATABASE_URL` | Supabase -> Settings -> Database -> **Pooled** (port 6543), keep `?pgbouncer=true&connection_limit=10&pool_timeout=20` |
   | `DIRECT_URL` | Supabase -> Settings -> Database -> **Direct** (port 5432). Must be non-empty. |
   | `SUPABASE_URL` | Supabase -> Settings -> API -> Project URL |
   | `SUPABASE_ANON_KEY` | Supabase -> Settings -> API -> anon public |
   | `FRONTEND_URL` | put a placeholder for now, e.g. `https://example.com`. Corrected in step 3. |
   | `CORS_ALLOWED_ORIGINS` | same placeholder for now |
   | `DEEPSEEK_API_KEY` | platform.deepseek.com |
   | `DEEPSEEK_MODEL` | `deepseek-flash` |
   | `SARVAM_API_KEY_1..3` | dashboard.sarvam.ai |
   | `RESEND_API_KEY`, `EMAIL_FROM` | optional; leave blank to disable email |

3. Wait for the deploy. Then check `https://<your-service>.onrender.com/api/health`
   returns `{"status":"ok"}`.

   The first request after ~15 minutes of inactivity takes about **50 seconds**
   because free instances spin down. This is normal on the free plan.

### Step 2 - Vercel (the web app)

1. vercel.com -> **Add New** -> **Project** -> import the same GitHub repo.
2. **Set Root Directory to `frontend`.** This is essential; the repo root is a
   monorepo and Vercel must build only the frontend.
3. Framework preset: **Vite** (detected automatically from `frontend/vercel.json`).
4. Add environment variables:

   | Variable | Value |
   | --- | --- |
   | `VITE_API_BASE_URL` | `https://<your-service>.onrender.com/api` - include `/api` |
   | `VITE_SUPABASE_URL` | Supabase -> Settings -> API -> Project URL |
   | `VITE_SUPABASE_ANON_KEY` | Supabase -> Settings -> API -> **anon public** key only |

   `VITE_` variables are inlined into the browser bundle at build time. Only the
   anon key may appear here - never a service_role key, a database URL, or a
   provider key.

5. Deploy and note the URL, e.g. `https://dukaansaathi.vercel.app`.

### Step 3 - Close the loop

1. **Render** -> your service -> Environment: set
   `FRONTEND_URL` to the Vercel URL and
   `CORS_ALLOWED_ORIGINS` to that same URL.
   Save; Render redeploys automatically.
2. **Supabase** -> Authentication -> URL Configuration:
   - Site URL: the Vercel URL
   - Redirect URLs: add `https://<vercel-url>/auth/customer` and
     `http://localhost:5173/auth/customer`
3. **Google Cloud Console** -> APIs & Services -> Credentials -> your OAuth client:
   add `https://<vercel-url>/auth/customer` to the authorised redirect URIs if you
   manage the client there. If Supabase owns the Google client, only step 2 applies.

### Step 4 - Smoke test

1. `https://<your-service>.onrender.com/api/health` -> `{"status":"ok"}`
2. `https://<your-service>.onrender.com/api/health/features` -> shows which
   integrations are configured. Anything `false` genuinely has no credentials.
3. Open the Vercel URL. The directory should list the demo shops.
4. Open a shop, send a chat message, and confirm a reply arrives.
5. Sign in with Google and place a test order.

### Free-plan limitations to expect

- **Cold starts.** Render free instances sleep after ~15 minutes idle and take
  ~50 seconds to wake. The first request after a quiet period feels broken but
  is not.
- **Shared CPU and 512 MB RAM.** The assistant call already takes tens of
  seconds; on a cold free instance it will be slower.
- **In-memory rate limiting.** Correct for the single free instance. If you ever
  scale to more than one, the effective limit multiplies and you need a shared
  store.
- **No automatic migrations.** Run `npm --prefix backend run db:migrate` from
  your machine against the Supabase direct URL whenever the schema changes.

## 11. Known deployment limitations

- **Rate limiting is in-memory.** Correct for one Render instance; if you scale
  horizontally each instance gets its own counters and the effective limit
  multiplies. A shared store is required.
- **Migrations are manual.** Deliberate, so a deploy cannot alter production
  data unexpectedly.
- **No CI pipeline.** Checks are run locally.
- **Nothing in this document has been executed.** No deploy has been attempted,
  and no live provider call has been made.
