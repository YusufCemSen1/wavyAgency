import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { db } from "@/db";
import { campaigns, submissionMetrics, submissions } from "@/db/schema";
import { addDays, toDayString } from "@/lib/dates";
import { runIngest } from "@/server/services/ingest";
import { MetricsWentBackwardsError, recordDailyMetric } from "@/server/services/metrics";
import { approveSubmission } from "@/server/services/submissions";

import { makeCampaign, makeMetric, makeSubmission, makeUser } from "./helpers";

const today = toDayString(new Date());

async function approvedSubmission(overrides: Parameters<typeof makeCampaign>[0] = {}) {
  const creator = await makeUser("creator");
  const campaign = await makeCampaign({ payoutPer1kViews: 100, totalBudget: 1_000_000, ...overrides });
  const submission = await makeSubmission(campaign, creator);
  await approveSubmission(submission.id);
  return { campaign, submission, creator };
}

describe("metrics ingestion", () => {
  it("writes one row per approved submission per day", async () => {
    const { campaign } = await approvedSubmission();
    await approvedSubmission();

    const summary = await runIngest({ day: today });

    expect(summary.processed).toBe(2);
    expect(summary.created).toBe(2);
    expect(summary.failures).toEqual([]);

    const rows = await db.select().from(submissionMetrics);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.capturedAt === today)).toBe(true);
    expect(campaign.id).toBeDefined();
  });

  it("leaves everything untouched when run twice for the same day", async () => {
    await approvedSubmission();
    await approvedSubmission();

    await runIngest({ day: today });
    const firstPass = {
      metrics: await db.select().from(submissionMetrics),
      submissions: await db.select().from(submissions),
      campaigns: await db.select().from(campaigns),
    };

    const second = await runIngest({ day: today });

    expect(second.created).toBe(0);
    expect(second.skipped).toBe(2);
    expect(second.committedCents).toBe(0);
    expect(second.failures).toEqual([]);

    expect(await db.select().from(submissionMetrics)).toEqual(firstPass.metrics);
    expect((await db.select().from(submissions)).map((s) => s.earningsCents)).toEqual(
      firstPass.submissions.map((s) => s.earningsCents),
    );
    expect((await db.select().from(campaigns)).map((c) => c.spentCents)).toEqual(
      firstPass.campaigns.map((c) => c.spentCents),
    );
  });

  it("only ever moves views up", async () => {
    const { submission } = await approvedSubmission();
    await makeMetric(submission, 50_000, addDays(today, -1));

    await expect(
      recordDailyMetric({
        submissionId: submission.id,
        capturedAt: today,
        views: 40_000,
        likes: 0,
        comments: 0,
      }),
    ).rejects.toBeInstanceOf(MetricsWentBackwardsError);

    const rows = await db
      .select()
      .from(submissionMetrics)
      .where(eq(submissionMetrics.submissionId, submission.id));
    expect(rows).toHaveLength(1);
  });

  it("finishes the run and reports the failure when one submission blows up", async () => {
    const good = await approvedSubmission();
    const bad = await approvedSubmission();
    const alsoGood = await approvedSubmission();

    const summary = await runIngest({
      day: today,
      record: async (input) => {
        if (input.submissionId === bad.submission.id) {
          throw new Error("upstream API returned 500");
        }
        return recordDailyMetric(input);
      },
    });

    expect(summary.processed).toBe(3);
    expect(summary.created).toBe(2);
    expect(summary.failures).toEqual([
      { submissionId: bad.submission.id, message: "upstream API returned 500" },
    ]);

    // The other two still landed.
    for (const { submission } of [good, alsoGood]) {
      const rows = await db
        .select()
        .from(submissionMetrics)
        .where(eq(submissionMetrics.submissionId, submission.id));
      expect(rows).toHaveLength(1);
    }
  });

  it("raises earnings as views grow, and stops at the budget", async () => {
    const creator = await makeUser("creator");
    const campaign = await makeCampaign({ payoutPer1kViews: 100, totalBudget: 5_000 });
    const submission = await makeSubmission(campaign, creator);
    await approveSubmission(submission.id);

    await recordDailyMetric({
      submissionId: submission.id,
      capturedAt: addDays(today, -1),
      views: 20_000,
      likes: 0,
      comments: 0,
    });

    let campaignRow = (await db.select().from(campaigns).where(eq(campaigns.id, campaign.id)))[0]!;
    expect(campaignRow.spentCents).toBe(2_000);
    expect(campaignRow.status).toBe("active");

    await recordDailyMetric({
      submissionId: submission.id,
      capturedAt: today,
      views: 200_000,
      likes: 0,
      comments: 0,
    });

    campaignRow = (await db.select().from(campaigns).where(eq(campaigns.id, campaign.id)))[0]!;
    expect(campaignRow.spentCents).toBe(5_000);
    expect(campaignRow.status).toBe("completed");
  });

  it("collects metrics for pending clips without paying for them", async () => {
    const creator = await makeUser("creator");
    const campaign = await makeCampaign({ payoutPer1kViews: 100, totalBudget: 100_000 });
    const submission = await makeSubmission(campaign, creator);

    const result = await recordDailyMetric({
      submissionId: submission.id,
      capturedAt: today,
      views: 50_000,
      likes: 10,
      comments: 2,
    });

    expect(result.inserted).toBe(true);
    expect(result.committedCents).toBe(0);
    expect(
      (await db.select().from(campaigns).where(eq(campaigns.id, campaign.id)))[0]!.spentCents,
    ).toBe(0);
  });
});
