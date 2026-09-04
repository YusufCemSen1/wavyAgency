import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env and start Postgres with `docker compose up -d`.",
  );
}

// Next.js dev server hot-reloads modules; keep one pool per process.
const globalForDb = globalThis as unknown as {
  clipmarketClient?: postgres.Sql;
};

/**
 * Connection poolers in transaction mode (Supabase's 6543 pooler, PgBouncer,
 * Neon's pooled endpoint) don't keep prepared statements across checkouts.
 * Detecting it here rather than relying on a deploy-time flag, because the
 * failure otherwise only shows up in production.
 */
const behindPooler = /pooler|pgbouncer|:6543/.test(connectionString);

const client =
  globalForDb.clipmarketClient ??
  postgres(connectionString, {
    max: behindPooler ? 5 : 10,
    // Serverless-friendly: idle sockets get reaped rather than pinned open.
    idle_timeout: 20,
    prepare: !behindPooler,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.clipmarketClient = client;
}

export const db = drizzle(client, { schema, casing: "snake_case" });

export type Database = typeof db;
/** What a callback gets inside `db.transaction(...)`. */
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
/** Anything the services can run queries on — the pool or an open transaction. */
export type Executor = Database | Transaction;

export { schema };
