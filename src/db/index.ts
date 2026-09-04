import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

// Next.js dev server hot-reloads modules; keep one pool per process.
const globalForDb = globalThis as unknown as {
  clipmarketClient?: postgres.Sql;
};

function connect() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env and start Postgres with `docker compose up -d`.",
    );
  }

  /**
   * Connection poolers in transaction mode (Neon's pooled endpoint, Supabase's
   * 6543 pooler, PgBouncer) don't keep prepared statements across checkouts.
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

  return drizzle(client, { schema, casing: "snake_case" });
}

type DrizzleDatabase = ReturnType<typeof connect>;

let instance: DrizzleDatabase | undefined;

function getDb(): DrizzleDatabase {
  instance ??= connect();
  return instance;
}

/**
 * Connects on first use rather than on import.
 *
 * `next build` evaluates route modules while collecting page data, so an
 * eager connection would make the build itself require a live DATABASE_URL —
 * a build shouldn't depend on a runtime secret. Methods are bound to the real
 * instance so `this` still works inside drizzle.
 */
export const db = new Proxy({} as DrizzleDatabase, {
  get(_target, property, receiver) {
    const target = getDb();
    const value = Reflect.get(target, property, receiver);
    return typeof value === "function" ? value.bind(target) : value;
  },
  has(_target, property) {
    return Reflect.has(getDb(), property);
  },
});

export type Database = DrizzleDatabase;
/** What a callback gets inside `db.transaction(...)`. */
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
/** Anything the services can run queries on — the pool or an open transaction. */
export type Executor = Database | Transaction;

export { schema };
