# ClipMarket

A cut-down clipping marketplace. Brands post paid campaigns, creators submit
short-form clips, admins review them, and approved clips earn per 1,000 views up to
the campaign budget.

See [NOTES.md](NOTES.md) for setup, the design decisions, and what was left out.

## Stack

Next.js 15 (App Router) · TypeScript strict · tRPC v11 · Drizzle ORM on Postgres ·
TailwindCSS + shadcn/ui · react-hook-form + Zod · Vitest

## Quick start

```bash
pnpm install
cp .env.example .env
docker compose up -d
pnpm db:migrate
pnpm db:seed
pnpm dev
```

## Layout

```
src/
  app/                     routes; /admin/* is the brand side, /campaigns + /submissions the creator side
    api/trpc/[trpc]/       the single HTTP endpoint — no REST handlers for app data
  server/
    services/              the money path: approvals, budget commits, metric ingestion
    trpc/                  context, role-scoped procedures, routers
  db/                      Drizzle schema, connection, migrator
  lib/                     payout math, post-URL parsing, Zod schemas shared with the client
  components/              UI
drizzle/                   generated migrations, committed
scripts/                   seed and the `pnpm ingest` daily sync
tests/                     Vitest: payout math, budget ceiling, concurrency, access control, ingest
```

## Deploying

Any host that runs Next.js against a Postgres URL. Two environment variables:

| | |
|---|---|
| `DATABASE_URL` | Postgres connection string. A pooled/PgBouncer endpoint is detected automatically and prepared statements are turned off for it. |
| `AUTH_SECRET` | 32+ random bytes. `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` |

Migrations aren't run at build time — point them at the deployed database once:

```bash
DATABASE_URL='<production url>' pnpm db:migrate
DATABASE_URL='<production url>' pnpm db:seed    # optional; resets and reseeds
```

The session cookie is `Secure` in production, so the deployed app has to be served
over HTTPS (running `pnpm build && pnpm start` over plain http will not hold a login).

## Commands

| | |
|---|---|
| `pnpm dev` | dev server |
| `pnpm test` | full suite against `clipmarket_test` |
| `pnpm ingest [YYYY-MM-DD]` | fake daily metrics sync |
| `pnpm db:generate` | new migration from a schema change |
| `pnpm db:migrate` | apply migrations |
| `pnpm db:seed` | reset and reseed |
| `pnpm typecheck` / `pnpm build` | |
