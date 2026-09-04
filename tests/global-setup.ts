import "dotenv/config";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5435/clipmarket_test";

/**
 * Creates the test database if it isn't there and brings it up to the
 * committed migrations, so `pnpm test` works on a clean checkout with nothing
 * but `docker compose up -d` beforehand.
 */
export default async function setup() {
  const url = new URL(TEST_DATABASE_URL);
  const databaseName = url.pathname.slice(1);

  const adminUrl = new URL(TEST_DATABASE_URL);
  adminUrl.pathname = "/postgres";

  const admin = postgres(adminUrl.toString(), { max: 1, onnotice: () => {} });
  try {
    const existing = await admin`select 1 from pg_database where datname = ${databaseName}`;
    if (existing.length === 0) {
      await admin.unsafe(`create database "${databaseName}"`);
    }
  } catch (error) {
    throw new Error(
      `Couldn't reach Postgres at ${adminUrl.host}. Start it with \`docker compose up -d\`.\n${String(error)}`,
    );
  } finally {
    await admin.end();
  }

    // Postgres emits a NOTICE for the already-there migrations table; not news.
  const client = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
  } finally {
    await client.end();
  }
}
