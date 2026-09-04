import "dotenv/config";

import { sql } from "drizzle-orm";

import { db } from "@/db";
import { campaigns, submissionMetrics, submissions, users } from "@/db/schema";
import { addDays, toDayString } from "@/lib/dates";
import { runIngest } from "@/server/services/ingest";
import { approveSubmission, rejectSubmission } from "@/server/services/submissions";

/**
 * Builds a realistic dataset by driving the same code paths the app uses:
 * creators submit, an admin approves or rejects, and then ten days of metrics
 * are ingested one day at a time. Nothing here writes payout numbers directly.
 */
async function main() {
  console.log("Resetting tables…");
  await db.execute(
    sql`truncate table submission_metric, submission, campaign, "user" restart identity cascade`,
  );

  const today = toDayString(new Date());

  const insertedUsers = await db
    .insert(users)
    .values([
      { email: "admin@clipmarket.test", name: "Avery (admin)", role: "admin" },
      { email: "ops@clipmarket.test", name: "Bo (admin)", role: "admin" },
      { email: "casey@creators.test", name: "Casey", role: "creator" },
      { email: "devon@creators.test", name: "Devon", role: "creator" },
      { email: "emin@creators.test", name: "Emin", role: "creator" },
    ])
    .returning();

  const creators = insertedUsers.filter((user) => user.role === "creator");
  const [casey, devon, emin] = creators as [
    (typeof creators)[number],
    (typeof creators)[number],
    (typeof creators)[number],
  ];

  const insertedCampaigns = await db
    .insert(campaigns)
    .values([
      {
        title: "Summer sneaker drop",
        platforms: ["tiktok", "instagram"],
        payoutPer1kViews: 250,
        totalBudget: 250_000,
        status: "active",
        startsAt: new Date(`${addDays(today, -14)}T00:00:00.000Z`),
        endsAt: new Date(`${addDays(today, 16)}T23:59:59.999Z`),
      },
      {
        title: "Energy drink launch",
        platforms: ["youtube", "tiktok"],
        payoutPer1kViews: 180,
        totalBudget: 120_000,
        status: "active",
        startsAt: new Date(`${addDays(today, -10)}T00:00:00.000Z`),
        endsAt: new Date(`${addDays(today, 20)}T23:59:59.999Z`),
      },
      {
        // Deliberately tiny, so the budget ceiling is easy to hit by hand.
        title: "Micro-budget teaser",
        platforms: ["instagram"],
        payoutPer1kViews: 500,
        totalBudget: 2_000,
        status: "active",
        startsAt: new Date(`${addDays(today, -12)}T00:00:00.000Z`),
        endsAt: new Date(`${addDays(today, 10)}T23:59:59.999Z`),
      },
      {
        title: "Winter capsule (draft)",
        platforms: ["instagram", "youtube"],
        payoutPer1kViews: 320,
        totalBudget: 400_000,
        status: "draft",
        startsAt: new Date(`${addDays(today, 5)}T00:00:00.000Z`),
        endsAt: new Date(`${addDays(today, 45)}T23:59:59.999Z`),
      },
      {
        title: "Spring sale (paused)",
        platforms: ["tiktok"],
        payoutPer1kViews: 150,
        totalBudget: 80_000,
        status: "paused",
        startsAt: new Date(`${addDays(today, -30)}T00:00:00.000Z`),
        endsAt: new Date(`${addDays(today, 5)}T23:59:59.999Z`),
      },
    ])
    .returning();

  const [sneakers, energy, micro] = insertedCampaigns as [
    (typeof insertedCampaigns)[number],
    (typeof insertedCampaigns)[number],
    (typeof insertedCampaigns)[number],
  ];

  const inserted = await db
    .insert(submissions)
    .values([
      sub(sneakers.id, casey.id, "tiktok", "https://www.tiktok.com/@casey/video/7412300000000000001"),
      sub(sneakers.id, devon.id, "tiktok", "https://www.tiktok.com/@devon/video/7412300000000000002"),
      sub(sneakers.id, emin.id, "instagram", "https://www.instagram.com/reel/Cx1sneak01/"),
      sub(sneakers.id, casey.id, "instagram", "https://www.instagram.com/reel/Cx1sneak02/"),
      sub(energy.id, devon.id, "youtube", "https://www.youtube.com/watch?v=energy0001"),
      sub(energy.id, emin.id, "youtube", "https://www.youtube.com/shorts/energy0002"),
      sub(energy.id, casey.id, "tiktok", "https://www.tiktok.com/@casey/video/7412300000000000003"),
      sub(micro.id, devon.id, "instagram", "https://www.instagram.com/reel/Cx1micro01/"),
      sub(micro.id, emin.id, "instagram", "https://www.instagram.com/reel/Cx1micro02/"),
    ])
    .returning();

  // Approve most of them, reject one, leave the rest pending for the queue.
  const approve = [0, 1, 2, 4, 5, 7];
  const reject = [3];

  for (const index of approve) {
    await approveSubmission(inserted[index]!.id);
  }
  for (const index of reject) {
    await rejectSubmission(inserted[index]!.id, "Product isn't visible in the first three seconds.");
  }

  console.log("Ingesting ten days of metrics…");
  for (let offset = 9; offset >= 0; offset -= 1) {
    const day = addDays(today, -offset);
    const summary = await runIngest({ day });
    if (summary.failures.length > 0) {
      console.warn(`  ${day}: ${summary.failures.length} failures`);
    }
  }

  // `pnpm ingest` deliberately only captures approved submissions, per the
  // brief. Pending clips still have view counts in real life, and the review
  // queue is a lot less useful without them, so the seed backfills those
  // directly — including one clip big enough to blow the micro budget.
  const stillPending = inserted.filter((row) => !approve.includes(inserted.indexOf(row)) && !reject.includes(inserted.indexOf(row)));
  for (const [index, submission] of stillPending.entries()) {
    let views = 4_000 + index * 9_000;
    for (let offset = 9; offset >= 0; offset -= 1) {
      views = Math.round(views * 1.18);
      await db
        .insert(submissionMetrics)
        .values({
          submissionId: submission.id,
          capturedAt: addDays(today, -offset),
          views,
          likes: Math.round(views * 0.04),
          comments: Math.round(views * 0.003),
        })
        .onConflictDoNothing();
    }
  }

  console.log(
    [
      "",
      "Seeded.",
      `  users:       ${insertedUsers.length}`,
      `  campaigns:   ${insertedCampaigns.length}`,
      `  submissions: ${inserted.length}`,
      "",
      "Sign in as admin@clipmarket.test or any creator from the header switcher.",
    ].join("\n"),
  );

  process.exit(0);
}

function sub(
  campaignId: string,
  creatorId: string,
  platform: "tiktok" | "instagram" | "youtube",
  postUrl: string,
) {
  return { campaignId, creatorId, platform, postUrl, status: "pending" as const };
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
