import "dotenv/config";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

/**
 * Applies the committed drizzle-kit migrations.
 *
 *   pnpm db:migrate                      -> DATABASE_URL
 *   DATABASE_URL=$TEST_DATABASE_URL ...  -> any other database
 */
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  const client = postgres(url, { max: 1 });
  try {
    await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
    console.log(`Migrations applied to ${redact(url)}`);
  } finally {
    await client.end();
  }
}

function redact(url: string) {
  try {
    const parsed = new URL(url);
    parsed.password = "***";
    return parsed.toString();
  } catch {
    return "the configured database";
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
