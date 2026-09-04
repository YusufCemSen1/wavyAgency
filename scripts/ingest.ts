import "dotenv/config";

import { runIngest } from "@/server/services/ingest";

/**
 * pnpm ingest              -> capture today (UTC)
 * pnpm ingest 2026-09-01   -> backfill a specific day
 */
async function main() {
  const day = process.argv[2];
  if (day && !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    console.error(`Usage: pnpm ingest [YYYY-MM-DD]  (got "${day}")`);
    process.exit(2);
  }

  const summary = await runIngest({ day, log: (message) => console.log(message) });

  console.log(
    [
      `Ingest for ${summary.day}`,
      `  approved submissions: ${summary.processed}`,
      `  metric rows written:  ${summary.created}`,
      `  already captured:     ${summary.skipped}`,
      `  budget committed:     ${(summary.committedCents / 100).toFixed(2)} USD`,
      `  failures:             ${summary.failures.length}`,
    ].join("\n"),
  );

  for (const failure of summary.failures) {
    console.error(`  FAILED ${failure.submissionId}: ${failure.message}`);
  }

  process.exit(summary.failures.length > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
