# DukaanSaathi — Documentation

> **Your store, in every language.**

DukaanSaathi is a mobile-first web application that helps customers find local
Indian businesses, ask questions about products and shop information in
English, Bengali or Hindi, and place orders. Merchants manage their business
profile, products, orders, customer queries and reviews.

**This `docs/` directory contains all project documentation.** No official
documentation template was present in the workspace when these files were
written, so they are project-specific documents rather than a filled-in
template. They are written to be honest about what has and has not been
verified.

## Where to start

| If you want to... | Read |
| --- | --- |
| Understand the product and architecture | [PLANNING.md](./PLANNING.md) |
| Know exactly what works today | [PROGRESS.md](./PROGRESS.md) |
| Set up and deploy the project | [DEPLOYMENT.md](./DEPLOYMENT.md) |
| Prepare for a review or demo | [DEFENSE_QA.md](./DEFENSE_QA.md) |

The Render blueprint lives at [`render.yaml`](../render.yaml) and the Vercel
settings at [`frontend/vercel.json`](../frontend/vercel.json).

## Repository layout

```
.
├── backend/            Node.js + Express + TypeScript API (deploy: Render)
│   ├── prisma/         Schema, migration, seed and demo data
│   ├── src/
│   │   ├── config/     Environment parsing and feature detection
│   │   ├── db/         Prisma client
│   │   ├── lib/        Pure helpers (money, hours, availability, statuses)
│   │   ├── middleware/ Auth, errors, rate limits, uploads
│   │   ├── routes/     HTTP routes
│   │   └── services/   DeepSeek, Sarvam, Resend, orders, assistant
│   └── tests/          Vitest suites (mocked, in-memory)
├── frontend/           React + Vite + TypeScript + Tailwind (deploy: Vercel)
│   └── src/
│       ├── components/ Shared UI and layout
│       ├── hooks/      Data-loading helpers
│       ├── lib/        API client, i18n, types, speech
│       ├── pages/      Customer, auth and merchant screens
│       └── providers/  Auth, cart, features, toasts
├── docs/               These documents
├── Reference_design/   Design reference images and notes (no secrets)
└── Keys/               Local API key drop folder - git-ignored, never committed
```

## Technology

| Layer | Choice |
| --- | --- |
| Frontend | React 18, Vite 6, TypeScript, Tailwind CSS, React Router |
| Backend | Node.js, Express 4, TypeScript |
| Database | Managed PostgreSQL (Supabase) via Prisma |
| Auth | Supabase Auth — Google OAuth for customers, email/password for businesses |
| LLM | DeepSeek Flash only (no fallback provider) |
| Speech | Sarvam AI STT and TTS |
| Email | Resend, opt-in only |

## The five product rules that matter most

1. **PostgreSQL is the source of truth.** No JSON files, no SQLite, no
   in-memory production data.
2. **Unknown availability is never Available.** The three states are
   `AVAILABLE`, `OUT_OF_STOCK` and `UNKNOWN`, and only `AVAILABLE` is orderable.
3. **The server calculates money.** Prices, line totals and order totals are
   read from PostgreSQL. Neither the browser nor the model can set them.
4. **The model cannot place orders.** It may propose items; the customer reviews
   a cart and confirms, and the backend re-validates everything.
5. **Tenant isolation is enforced server-side.** Every merchant request is
   re-checked against business ownership, and a foreign business returns 404
   rather than confirming that it exists.

## Current verified status (short version)

**Verified live (real Supabase PostgreSQL + real DeepSeek + real Sarvam):**

- Migration **applied to Supabase**; 16 tables and 52 indexes confirmed by SQL.
- Demo seed **completed**: 7 businesses (one per category), 42 products, 30 orders.
- Unique constraints proven real: duplicate `Order.orderCode` and duplicate
  `OrderReview.orderId` both rejected with `P2002`.
- **31/31 real end-to-end checks pass** (`npm --prefix backend run test:e2e:postgres`)
  — real Express server, real database, real providers.
- DeepSeek and Sarvam calls succeed; the assistant quoted the real database price.

**Verified with mocks / in-memory:**

- Backend typecheck and build: **pass**; 130 tests across 11 files (in-memory double).
- Backend HTTP harness: **65/65** (`npm --prefix backend run test:e2e:local`).
- Frontend typecheck and production build: **pass**; 47 tests across 6 files.

**Still not verified:**

- **No browser session** against a running backend; the frontend has never talked
  to the live API.
- **Resend email** is unconfigured, so no email has ever been sent.
- **Deployment not attempted.** `render.yaml` and `frontend/vercel.json` exist but
  have never been applied to any account.

See [PROGRESS.md](./PROGRESS.md) for the full, itemised status.
