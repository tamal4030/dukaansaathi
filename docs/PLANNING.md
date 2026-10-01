# PLANNING

This document explains what DukaanSaathi is, how it is built, and why the
architecture looks the way it does. It is a project-specific document: no
official planning template existed in the workspace.

## 1. Problem

Local shops in India have no simple way to be discoverable online, and their
customers often prefer to ask questions in Bengali or Hindi rather than English.
Existing marketplaces are heavyweight and demand commission, onboarding effort
and technical work that a single shop cannot sustain. A customer who wants to
know "do you have atta today, and what time do you close?" has no lightweight
way to ask.

## 2. What DukaanSaathi does

- **Customers** browse a directory of local shops, search and filter by
  category, open a shop page, ask questions by text or voice in their own
  language, build a cart, and send an order request.
- **Merchants** publish a catalogue (including by uploading a spreadsheet),
  manage their profile, hours, policies and FAQs, see incoming orders and
  customer questions, update order status, and read reviews.

Deliberately **out of scope**: payments, UPI links, QR codes, receipt uploads
and payment verification. Accepted payment methods are displayed as information
only. A UPI deep link or an uploaded receipt is not proof of payment.

## 3. Architecture

```
Customer browser ─┐
                  ├─► Vercel (React SPA) ─► Render (Express API) ─► Supabase PostgreSQL
Merchant browser ─┘                              │
                                                 ├─► DeepSeek Flash  (assistant)
                                                 ├─► Sarvam AI       (STT / TTS)
                                                 └─► Resend          (opt-in email)
```

Three independent deployables with clear boundaries:

- The **frontend** holds no secrets. It receives only the Supabase *anon* key,
  which is designed to be public, and a base URL for the API.
- The **backend** holds every provider credential and is the only component that
  talks to DeepSeek, Sarvam or Resend.
- The **database** is managed PostgreSQL. Render's local filesystem is never
  used for persistent data.

### Why a separate backend rather than serverless functions

Provider keys must stay server-side, the assistant needs rate limiting and
timeouts, and order creation needs a real database transaction. A long-lived
Express service makes those straightforward and keeps the deployment story
simple.

## 4. Data model

The Prisma schema (`backend/prisma/schema.prisma`) is normalised and covers:

| Model | Purpose | Notes |
| --- | --- | --- |
| `UserProfile` | Mirrors a Supabase Auth user via the `sub` claim | One row per signed-in user |
| `BusinessMember` | Links users to businesses with a role | Modelled from day one so staff roles can be added without a rewrite |
| `Business` | Profile, contact, policies, visibility, notification opt-in | Owned by exactly one user in the MVP |
| `BusinessHour` | One row per weekday | Unique on `(businessId, dayOfWeek)` |
| `BusinessFaq` | Question/answer pairs | Structured, never JSON blobs |
| `Product` | Catalogue with price, availability, aliases | Availability is a 3-value enum |
| `RecentBusiness` | Server-side "recently accessed" per customer | Guests use browser storage instead |
| `Conversation` / `Message` | Chat, tied to one business | Guests hold a server-issued `guestToken` |
| `ConversationFeedback` | Optional rating on a conversation | Works for guests |
| `Order` / `OrderItem` / `OrderStatusEvent` | Orders with price snapshots and history | Created in one transaction |
| `OrderReview` | One review per completed order | `orderId` is unique |
| `NotificationLog` | Records what email was attempted and what happened | Never claims a send that did not occur |

Indexes exist for business id, product search/filter fields, order
status/customer/business and conversation status/business.

### Why `BusinessMember` when the MVP has one owner

Adding staff later means inserting rows, not migrating every table. The
authorization check (`requireBusinessAccess`) already reads membership, so
supporting a manager role is a data change rather than a product rewrite.

## 5. Access model

| Action | Requirement |
| --- | --- |
| Browse the directory, view a shop, view products | Nobody. Public data only. |
| Ask a question in chat | Nobody. Guests get a server-issued conversation token. |
| Submit an order | Signed in with **Google** |
| View order history, order status, saved shops, review orders | Signed in as that customer |
| Manage a business | Signed in as the owner of that business |

Guests may store recently accessed businesses in browser storage. That storage
is a convenience, never a source of truth: signed-in customers get the list from
the database so it follows them across devices.

## 6. Assistant design

The assistant is the most safety-sensitive part of the product.

**Retrieval, not dumping.** A large catalogue is never sent to the model. A
query is tokenised, matched against product names, categories, descriptions and
aliases in the database, ranked in memory, and only the best matches are
included. Store hours, policies and FAQs are attached as structured facts, and
only the FAQs that match the question are selected.

**No vector database.** Keyword matching plus merchant-maintained aliases is
sufficient for an MVP and keeps the system explainable. Bengali and Hindi
aliases are exactly what makes this work for customers who search in their own
language.

**The prompt is a contract.** The system prompt is stored verbatim in
`backend/src/services/prompt.ts` so it can be diffed and reviewed. A separate
system message describes the JSON output shape, so the main prompt stays
readable.

**The model cannot spend money or change state.** The assistant may return
`proposed_items`, which the backend validates against that business's live
products. The model's proposed price is ignored; the database price is used. A
proposal becomes a cart line in the browser, and an order exists only after the
customer reviews it and confirms, at which point the backend re-validates
everything inside a transaction.

**Claims are rewritten.** If the model says an order was placed or a payment
was received, `assistantGuard.ts` replaces that sentence with a correction in
the customer's language, because those statements are never true.

**Uncertainty is an answer.** If no product matches, the model is told so
explicitly. If availability is `UNKNOWN`, the model is told it cannot confirm
availability. If store hours are missing, the model is told it cannot confirm
opening times.

**No fallback provider.** If DeepSeek is unavailable, the customer sees a clear
message in their language and the transcript stays visible. Switching providers
silently would be worse than an honest failure.

## 7. Speech design

1. The browser records audio with `MediaRecorder`.
2. The audio is posted to the backend, which calls Sarvam STT with
   `language_code` of `en-IN`, `bn-IN` or `hi-IN` — or `unknown` when the
   customer has not chosen a language, for automatic detection.
3. The transcript is shown in an editable box. The customer sends it through the
   same text path as a typed message, so there is exactly one code path to
   secure and test.
4. Answers to voice questions are spoken automatically. English uses the device
   voice via `speechSynthesis` when a suitable voice exists; Bengali and Hindi
   use Sarvam TTS.
5. Recordings are not stored. Only the transcript and the interaction are kept.

## 8. Order lifecycle

```
NEW ──► ACCEPTED ──► PREPARING ──┬──► READY_FOR_PICKUP ──► COMPLETED
                                 └──► OUT_FOR_DELIVERY ──► COMPLETED
  └────────┴───────────┴──────────┴──► CANCELLED
```

Transitions are validated server-side and are **fulfilment aware**: a pickup
order can never be marked "out for delivery", and a delivery order can never be
marked "ready for pickup". Every change writes an `OrderStatusEvent` row, so
history is preserved rather than overwritten.

Customers see fresh status from the database whenever they open the order page
and can refresh manually. There is no websocket or real-time infrastructure,
because polling on visit is sufficient for this MVP.

## 9. Email design

Email is **supplementary**. The database and the app are the source of truth.

- The business is emailed about a new order only if it opted in.
- The customer is emailed about a status change only if they opted in.
- A failed or skipped email is recorded in `NotificationLog` and reported
  honestly in the API response. It never rolls back an order, and the UI never
  claims an email was sent when it was not.
- With no Resend credentials, orders still work end to end and the UI says
  delivery is not configured.

## 10. Phased delivery

| Phase | Scope | State |
| --- | --- | --- |
| 1 | Schema, auth, core helpers | Code complete; schema validates. **Never applied to a database.** |
| 2 | Landing, discovery, business setup, products | Code complete; frontend typechecks, builds and is tested |
| 3 | Chat, STT, TTS | Code complete; **no live provider call has ever been made** |
| 4 | Orders, status history, email | Code complete; **no database run, no live send** |
| 5 | Reviews, dashboard | Code complete |
| 6 | Tests, docs, deployment config | Done: 130 backend + 47 frontend tests, all five `docs/` files, `render.yaml`. **Nothing deployed.** |

## 11. Known limitations

**Unverified — read this first**

- **No PostgreSQL has ever been connected.** `prisma migrate deploy`, `db:seed`
  and `db:demo` have never run. Every database-backed behaviour is unproven.
  The 130 backend tests use an in-memory Prisma double that does not enforce
  unique constraints and does not roll back transactions, so the duplicate-
  review rule and order-creation atomicity are not proven.
- **No live provider call has ever been made** to DeepSeek, Sarvam or Resend.
  Those integrations are covered by mocked tests only.
- **No end-to-end session.** The frontend has never talked to a running backend.
- **No deployment.** `render.yaml` and `frontend/vercel.json` exist but have
  never been applied, and no Vercel deploy has been attempted.
- **Provider identifiers are unverified.** `DEEPSEEK_MODEL` is deliberately
  empty; Sarvam's base URL, paths and model ids are best-effort and fully
  env-configurable. See `DEPLOYMENT.md` section 8 for what must be supplied.
- **`DIRECT_URL` must be non-empty.** Prisma fails schema validation with P1012
  otherwise, which blocks migrations. It cannot be replaced with a placeholder
  for real work.

**Design limitations**

- Rate limiting is in-memory, which is correct for a single Render instance and
  wrong for a horizontally scaled one. A shared store is needed to scale.
- Product search is keyword-based. No embeddings, no typo tolerance beyond
  aliases the merchant supplies.
- The MVP has one owner per business and no staff invitations, though
  `BusinessMember` exists so roles can be added without a rewrite.
- The frontend bundle is a single ~593 kB chunk; code splitting is an obvious
  improvement but not a correctness issue.
- No payment flow, by design. Accepted payment methods are displayed as
  information only; a UPI link or uploaded receipt is not proof of payment.
- **`Keys/` still holds redundant key copies** and should be deleted once
  `backend/.env` is confirmed working. The DeepSeek key has not been confirmed
  rotated.
