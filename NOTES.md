# NOTES

A cut-down clipping marketplace: brands post paid campaigns, creators submit clips,
admins approve them, and approved clips earn per 1,000 views until the campaign
budget runs out.

**Live: https://wavy-agency.vercel.app** — pick a user on the landing page.
`admin@clipmarket.test` for the brand side, `casey@creators.test` for a creator.
Seeded with five campaigns and ten days of metrics; "Micro-budget teaser" is there
to show a campaign that spent its budget and closed itself.

## Setup

Needs Node 20+, pnpm, and Docker.

```bash
corepack enable                 # if you don't already have pnpm
pnpm install
cp .env.example .env            # values in it work as-is
docker compose up -d            # Postgres 16 on host port 5435
pnpm db:migrate                 # applies the committed drizzle-kit migrations
pnpm db:seed                    # 5 users, 5 campaigns, 10 days of metrics
pnpm dev                        # http://localhost:3000
```

Then pick a user from the header switcher — `admin@clipmarket.test` for the admin
side, `casey@creators.test` for the creator side.

```bash
pnpm test        # creates clipmarket_test, migrates it, runs the suite
pnpm ingest      # fake daily metrics sync; pnpm ingest 2026-09-05 to backfill a day
pnpm typecheck
pnpm build
```

`pnpm test` needs the same Docker Postgres running. It creates and migrates its own
`clipmarket_test` database, so it never touches your dev data.

Host port **5435** rather than 5432, because a stray Postgres on 5432/5433 is common.
Change it in `docker-compose.yml` and `.env` together if it clashes.

## Concurrent approvals

Approval runs in one transaction that takes `SELECT … FOR UPDATE` on the **campaign
row** before it reads `spent_cents`
([`src/server/services/submissions.ts`](src/server/services/submissions.ts)). Two
admins approving at the same moment against a budget with room for one of them are
ordered by the lock queue: the first commits, the second wakes up, re-reads the now
higher `spent_cents`, and fails with a typed `BUDGET_EXCEEDED` error the UI shows as
"Not enough budget left to approve this one". First come, first served, no retry
loop, no partially-approved state.

Contention is per campaign, and only on the money path — approvals on different
campaigns never touch each other. Every path that moves money takes the locks in the
same order (campaign, then submission), so the lock graph can't cycle.

Behind it, `campaign.spent_cents <= total_budget` is a `CHECK` constraint. If the
application logic were ever wrong the transaction aborts instead of overpaying.

Covered by [`tests/concurrent-approvals.test.ts`](tests/concurrent-approvals.test.ts):
two simultaneous approvals, eight racing for a budget that fits three, and a
double-clicked approve on the same submission.

What I tried or ruled out:

- **No lock, just read-then-write.** The obvious version, and wrong: both admins read
  `spent_cents = 0` and both approve. This is what the test would catch.
- **`SERIALIZABLE` isolation.** Correct, but it pushes a retry loop on `40001` into
  every caller, and the failure a user sees ("serialization failure") no longer says
  anything about budgets. A business rule deserves a business error.
- **Optimistic concurrency (a `version` column, compare-and-swap).** Also correct, but
  the retry has to re-run the payout calculation from scratch, so it's more code for
  the same outcome, with a worst case that's harder to reason about.
- **`pg_advisory_xact_lock(campaign_id)`.** Works fine. I preferred the row lock
  because the transaction has to read the campaign row anyway — locking the thing you
  are about to read is one operation instead of two, and it's self-documenting.

## How the money is modelled

`submission.earnings_cents` and `campaign.spent_cents` are both materialised, and only
ever move inside the campaign lock. Gross earnings come from the latest metric row —
`floor(views / 1000) * payout_per_1k_views` — but the amount actually committed is
clipped to whatever budget is left.

That clip is a deliberate reconciliation of two rules in the brief. "Earnings are
`floor(views/1000) * rate` from the most recent metric" and "a campaign never pays out
more than `total_budget`" disagree as soon as an approved clip keeps growing after the
budget is gone. I let the ceiling win: growth past the budget stops accruing, the
campaign flips to `completed` on its own, and the creator's row shows the capped
amount rather than a number they'll never be paid.

Everything is integer cents end to end. The only place dollars exist is
[`MoneyInput`](src/components/money-input.tsx), which converts on the way in, so the
value Zod validates is already cents.

## A few smaller decisions

- **Post URLs are canonicalised, not just validated.**
  `https://youtu.be/x`, `https://www.youtube.com/watch?v=x&t=30s` and
  `https://m.youtube.com/watch?v=x` all store as one URL, so the
  `(campaign_id, post_url)` unique index actually means "the same clip twice" rather
  than "the same string twice".
- **The chart shows new views per day**, from the day-over-day delta of each
  submission, zero-filled across the whole campaign period. A cumulative line felt
  less useful for spotting which day a campaign landed. It's hand-rolled SVG with a
  real `<table>` behind a disclosure — one series of bars didn't justify a charting
  dependency, and the table is better for screen readers than anything a canvas
  library gives you.
- **Ingest is idempotent through the schema**, not through a flag: `(submission_id,
  captured_at)` is unique and the insert is `ON CONFLICT DO NOTHING`. A re-run for the
  same day writes nothing and moves no money. Views going *backwards* are refused
  rather than clamped — in production that means the upstream feed is wrong, and I'd
  rather see it than smooth it over. Failures are per-submission, so one bad clip
  doesn't abort the run and every failure is reported at the end (exit code 1).
- **Authorisation is on every procedure, not on the pages.** `RequireRole` only
  decides what to render; `submission.mine` scopes to `ctx.user.id` in the WHERE
  clause and `submission.create` takes the creator from the session, so there is no
  payload that reaches another creator's data.
  [`tests/access-control.test.ts`](tests/access-control.test.ts) calls the procedures
  directly with a fabricated session, which is what a hand-crafted request would do.
- **Reading another creator's submission returns `NOT_FOUND`, not `FORBIDDEN`**, so a
  creator can't probe which submission ids exist.

## Left out on purpose

- Real auth. A signed cookie plus the dev switcher, as the brief asked.
- The `paid` status. It's in the enum because the brief listed it, but nothing
  transitions to it — there's no payment rail in scope, and a status that only ever
  gets set by hand would be worse than an honest gap.
- Custom design work. shadcn/ui defaults, no theming.
- Campaign delete/archive, user management, audit log, rate limiting.
- Browser/e2e tests. The logic that can lose money is covered at the service and
  procedure level; a Playwright suite on top would have cost more than it caught here.

## Given another day

**The review queue approves at zero views.** `pnpm ingest` only captures approved
submissions, exactly as the brief specifies — which means a *pending* clip has no
metrics, so it shows 0 views and $0 projected, and approving it always passes the
budget check trivially. The budget ceiling only really bites later, as ingest raises
earnings. That's coherent, but it isn't how you'd review clips in practice: you want
to see the numbers before you approve. The seed backfills metrics for pending
submissions so the queue is usable, which is a fairly loud hint that ingest's scope
and the review UI disagree. I'd extend ingest to capture pending submissions too (they
already cost nothing — `recordDailyMetric` collects metrics for them without moving
money) and drop that bit of seed scaffolding.

After that: decide whether `paid` earns its place, and add an index on
`submission_metric (submission_id, captured_at DESC)` — the "latest capture per
submission" subquery is the one query that will get slower with real volume.

e, and I'm happy to
argue any of them on the call.
