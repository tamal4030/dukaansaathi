# DEFENSE_QA

Anticipated questions about DukaanSaathi, with answers that state plainly what
is proven and what is not. **No official Q&A template existed in the workspace**,
so this is a project-specific document.

> **Headline honesty.** The code is written, typechecks, builds, and passes 177
> automated tests. **No PostgreSQL database has ever been connected, no
> deployment has happened, and no live call has been made to DeepSeek, Sarvam or
> Resend.** Anything below that sounds unproven is unproven.

---

## Architecture and scope

**Q: Why a separate backend instead of serverless functions?**
Three reasons. Provider keys must stay server-side; the assistant needs
timeouts and rate limiting; and order creation needs a real database
transaction with price snapshots. A long-lived Express service makes all three
straightforward.

**Q: Why PostgreSQL rather than a simpler store?**
Orders, price snapshots and status history are relational, and the product must
support many independent businesses. A document store would push tenant
isolation and referential integrity into application code, where it is easier to
get wrong. Prisma gives us foreign keys, unique constraints and typed queries.

**Q: Why is there no payment flow?**
It is deliberately out of scope. A UPI deep link or an uploaded receipt is not
proof of payment; real payment handling needs a provider verification flow.
Rather than fake it, accepted payment methods are displayed as information only
and the app states clearly that no payment is processed.

**Q: Why keyword search instead of a vector database?**
The catalogue is small and the merchant controls the vocabulary. Keyword
matching plus merchant-supplied aliases is explainable, cheap, and works well
when the aliases include Bengali and Hindi names — which is exactly the problem
that matters here. A vector store would add infrastructure without solving a
problem the aliases do not already solve.

---

## Tenant isolation and authorization

**Q: How do you stop one business reading another's data?**
Every merchant request calls `requireBusinessAccess(prisma, businessId, profile)`,
which looks up the `BusinessMember` row for the signed-in user. The business id
always comes from the route, never from the request body. A mismatch returns
**404, not 403**, so the API never confirms that another tenant's business
exists.

**Q: Prove it.**
Ten tests in `backend/tests/api.auth.test.ts` cover this, including: another
owner cannot read a business's orders, overview or products; another owner
cannot rename or add products to it; and customer A cannot read customer B's
order. All pass.

**Q: What about guests?**
A guest conversation is authorised by a `randomBytes(32)` token the server issues
at creation. The client cannot invent one, and a signed-in customer cannot read
a stranger's guest conversation. A client-supplied `businessId` on the message
endpoint is ignored — the business comes from the stored conversation.

**Q: Can the LLM pick a different business?**
No. The business is resolved from the conversation row before the model is
called, and it is placed in the prompt as data. There is a test that sends
`businessId: 'biz-0002'` in the message body and asserts the other business never
appears in the prompt.

**Q: What about public endpoints leaking private data?**
`businessToPublic()` never serialises `emailNotificationsEmail`, `ownerId` or
account fields, and public reviews exclude customer email and phone. A test
asserts the raw response body of a public business page contains none of them.

---

## The assistant

**Q: How do you stop the model inventing prices or availability?**
Three layers. Retrieval sends only matched products, each with its database id,
price and availability. The prompt instructs the model to treat those as data
and to never describe `UNKNOWN` as available. Then, critically, the model's
output is **not trusted**: any proposed items are re-validated against live
products for that business, and the price used is the database price, not
anything the model returned. A test feeds the model a proposal for another
business's product and a fabricated id; both are dropped.

**Q: What if the model claims an order was placed?**
`assistantGuard.ts` detects those phrases in English, Bengali and Hindi and
replaces the sentence with a correction in the customer's language. A test
asserts the stored reply contains "I have not placed any order" and that no order
row was created.

**Q: What if the model returns malformed JSON?**
`parseAssistantPayload` falls back to treating the response as plain text and
returns zero proposals, so a parsing failure can never become a cart or an
order.

**Q: What if DeepSeek is down?**
The customer gets a clear message in their own language, the notice is surfaced
in the UI, and the transcript stays visible. **There is no fallback provider** —
silently answering from a different model would be worse than an honest failure.
A test asserts this path and that both messages are still persisted.

**Q: How do you stop prompt injection?**
The system prompt states that customer messages are requests, not instructions,
and that product data is data. More importantly, the design does not depend on
the model obeying: the model has no database access, cannot create orders, and
its output is re-validated server-side. Injection can produce a wrong sentence,
not a wrong order.

---

## Orders and money

**Q: Where are totals calculated?**
In `services/orders.ts`, from `Prisma.Decimal` values read from PostgreSQL.
`quoteOrder` prices every line from the database; `createOrder` recomputes
inside a transaction. A test sends a client-supplied `unitPrice: '0.01'` and
asserts the server returns ₹265.00 and a ₹530.00 total.

**Q: How do you know the customer agreed?**
The create endpoint requires `confirm: true`, which is a Zod literal, so a
missing or false value is a 400. Tests cover both.

**Q: Why does the customer need Google sign-in?**
A shop needs a verified way to reach the customer about a real order. Browsing
and chat deliberately do **not** require it. The cart is stored per shop in
browser storage, so it survives the OAuth redirect. A test asserts an
email/password customer is rejected with `GOOGLE_SIGN_IN_REQUIRED` and that no
order row was written.

**Q: Are price snapshots stored?**
Yes. `OrderItem` keeps `nameSnapshot`, `unitPriceSnapshot` and `lineTotal`, so a
later price change does not rewrite history.

**Q: What about status transitions?**
They are validated server-side and are fulfilment-aware: a pickup order cannot go
"out for delivery", and a delivery order cannot be marked "ready for pickup".
Every change writes an `OrderStatusEvent`, so history is append-only. Tests cover
the valid flows, the pickup/delivery rejections, skipping steps, and re-setting
the same status.

---

## Availability

**Q: What are the availability states?**
Exactly three: `AVAILABLE`, `OUT_OF_STOCK`, `UNKNOWN`. That is an enum in the
database, not a free string.

**Q: How do you guarantee Unknown never becomes Available?**
The importer maps unrecognised or blank cells to `UNKNOWN`, never to
`AVAILABLE`; `isOrderable()` returns true only for `AVAILABLE`; the UI renders
"Availability unknown" and disables the add button; the assistant prompt is told
it cannot confirm availability; and the order endpoint rejects `UNKNOWN` lines
with a 409. Tests cover the importer, the UI label, the quote and the order
path. One test asserts that `availabilityLabel()` output re-parses to the same
value, which is what makes exported files re-importable.

---

## Email

**Q: Does a failed email lose the order?**
No. Email is supplementary. The order is committed first; the notification is a
separate step whose failure is logged in `NotificationLog` and reported honestly
in the API response. A test forces a provider failure and asserts the order and
its items still exist and the response says delivery failed.

**Q: Could the app claim an email was sent when it was not?**
No. The sender returns `SENT`, `FAILED` or `SKIPPED`, and the response note
distinguishes them. With no Resend credentials, sends are `SKIPPED` and the UI
says so.

**Q: Who gets emailed?**
Only opted-in recipients. The business needs `emailNotificationsOptIn` and an
address; the customer needs their own flag. Tests cover both opt-in and opt-out.

---

## Testing

**Q: How many tests, and what kind?**
177 total: 130 backend, 47 frontend. **All are mocked.** The backend API tests
run against an in-memory Prisma double; the frontend tests stub `fetch`.

**Q: Why not test against real PostgreSQL?**
No PostgreSQL server was reachable in the environment where this was built.

**Q: So what is NOT proven?**
Being precise matters here:
- The duplicate-review rule rests on `orderId @unique` plus a route check. The
  double does not enforce unique constraints, so a **real constraint violation
  has never been triggered**.
- Transactional rollback of order creation is **not proven** — the double does
  not roll back.
- Index behaviour and query plans are **not proven**.
- Every database-backed behaviour is unproven end to end.

**Q: Anything else not proven?**
No live DeepSeek, Sarvam or Resend call has ever been made. The frontend has
never talked to a running backend. No deployment has happened.

**Q: Did testing find real bugs?**
Yes, several, and they are listed in PROGRESS.md. The most serious: the
assistant service used `Prisma` without importing it, so every chat reply that
proposed a cart item would have returned HTTP 500 — plain-text replies hid it.
Also, `npm run build` was broken by a missing `@types/node`, which would have
failed on Vercel too.

---

## Security and secrets

**Q: Where do API keys live?**
Only in `backend/.env` (git-ignored) locally and in Render's environment settings
in production. The frontend receives only the Supabase **anon** key, which is
designed to be public. No provider key is ever placed in a `VITE_` variable,
because Vite inlines those into the browser bundle.

**Q: How do you stop keys leaking into logs?**
The logger redacts known sensitive keys, and the Sarvam pool logs only the
environment variable name and a masked key (`maskKey`). Tests assert that
serialised pool diagnostics and execution notes never contain a key value.

**Q: Is key rotation a way to dodge rate limits?**
No, and the code refuses to do it. Only 401/403 — the provider rejecting a
specific key — moves to the next key. On 429 the code waits for `Retry-After`
and retries the **same** key, because a rate limit belongs to the account and
rotating keys to escape it would be circumventing the provider's quota. Tests
assert that only the first key is ever used across a 429 retry.

**Q: Are there unsupported security claims in the UI?**
No. The landing page deliberately avoids words like "encrypted" or "secure".
`Reference_design/notes.txt` asked for this explicitly, and it is honoured.

---

## Known limitations

1. **No database has been connected.** Migrations and seed have never run.
2. **No live provider calls.** Assistant, speech and email are mocked-only.
3. **No end-to-end session** and no deployment.
4. **Provider identifiers unverified.** `DEEPSEEK_MODEL` is empty by design;
   Sarvam's URL, paths and model ids are best-effort and env-configurable.
5. **In-memory rate limiting** — correct for one Render instance, wrong for
   several.
6. **Single ~593 kB frontend chunk.** Code splitting is an obvious improvement.
7. **One owner per business.** `BusinessMember` exists so staff roles can be
   added later without a rewrite, but no invitations are implemented.
8. **`Keys/` still holds key copies** and should be deleted once `backend/.env`
   is confirmed working.
9. **The DeepSeek key has not been confirmed rotated.** A 6-character prefix
   appeared in an earlier transcript; do not use the key until rotation is
   confirmed.

---

## Quick reference

| Question | Short answer |
| --- | --- |
| Who calculates totals? | The backend, from PostgreSQL `Decimal` values |
| Can the LLM place an order? | No. It can only propose; the customer confirms |
| Can a merchant see another shop's data? | No. 404, enforced server-side |
| Is Unknown ever shown as Available? | No, at any layer |
| Does a failed email lose the order? | No |
| Is there a fallback LLM? | No, by design |
| How many tests pass? | 177, all mocked |
| Has a database been connected? | No |
| Has anything been deployed? | No |
