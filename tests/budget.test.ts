import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { db } from "@/db";
import { campaigns, submissions } from "@/db/schema";
import { approveSubmission } from "@/server/services/submissions";
import { recordDailyMetric } from "@/server/services/metrics";
import { addDays, toDayString } from "@/lib/dates";

import { makeCampaign, makeMetric, makeSubmission, makeUser } from "./helpers";

const reload = {
  campaign: async (id: string) =>
    (await db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1))[0]!,
  submission: async (id: string) =>
    (await db.select().from(submissions).where(eq(submissions.id, id)).limit(1))[0]!,
};

describe("budget ceiling", () => {
  it("commits exactly the payout the formula produces", async () => {
    const creator = await makeUser("creator");
    const campaign = await makeCampaign({ payoutPer1kViews: 250, totalBudget: 100_000 });
    const submission = await makeSubmission(campaign, creator);
    await makeMetric(submission, 73_785);

    const result = await approveSubmission(submission.id);

    // floor(73785 / 1000) * 250
    expect(result.earningsCents).toBe(73 * 250);
    expect((await reload.campaign(campaign.id)).spentCents).toBe(73 * 250);
    expect((await reload.submission(submission.id)).status).toBe("approved");
  });

  it("refuses an approval that would go over budget, and changes nothing", async () => {
    const creator = await makeUser("creator");
    const campaign = await makeCampaign({ payoutPer1kViews: 500, totalBudget: 2_000 });
    const submission = await makeSubmission(campaign, creator);
    await makeMetric(submission, 118_454); // worth 59_000 cents, budget is 2_000

    await expect(approveSubmission(submission.id)).rejects.toMatchObject({
      cause: { appCode: "BUDGET_EXCEEDED" },
    });

    expect((await reload.campaign(campaign.id)).spentCents).toBe(0);
    const after = await reload.submission(submission.id);
    expect(after.status).toBe("pending");
    expect(after.earningsCents).toBe(0);
  });

  it("closes the campaign once the budget is exactly consumed", async () => {
    const creator = await makeUser("creator");
    const campaign = await makeCampaign({ payoutPer1kViews: 100, totalBudget: 1_000 });
    const submission = await makeSubmission(campaign, creator);
    await makeMetric(submission, 10_000); // 10 * 100 = 1_000 == budget

    await approveSubmission(submission.id);

    const after = await reload.campaign(campaign.id);
    expect(after.spentCents).toBe(1_000);
    expect(after.status).toBe("completed");
  });

  it("caps view growth after approval instead of paying past the budget", async () => {
    const creator = await makeUser("creator");
    const campaign = await makeCampaign({ payoutPer1kViews: 100, totalBudget: 1_500 });
    const submission = await makeSubmission(campaign, creator);

    const yesterday = addDays(toDayString(new Date()), -1);
    await makeMetric(submission, 10_000, yesterday);
    await approveSubmission(submission.id); // commits 1_000

    // Views triple; the formula says 3_000 cents, the budget allows 500 more.
    const result = await recordDailyMetric({
      submissionId: submission.id,
      capturedAt: toDayString(new Date()),
      views: 30_000,
      likes: 0,
      comments: 0,
    });

    expect(result.committedCents).toBe(500);
    const campaignAfter = await reload.campaign(campaign.id);
    expect(campaignAfter.spentCents).toBe(1_500);
    expect(campaignAfter.status).toBe("completed");
    expect((await reload.submission(submission.id)).earningsCents).toBe(1_500);
  });

  it("won't approve against a campaign that already closed", async () => {
    const creator = await makeUser("creator");
    const campaign = await makeCampaign({
      payoutPer1kViews: 100,
      totalBudget: 1_000,
      status: "completed",
      spentCents: 1_000,
    });
    const submission = await makeSubmission(campaign, creator);

    await expect(approveSubmission(submission.id)).rejects.toMatchObject({
      cause: { appCode: "CAMPAIGN_NOT_ACCEPTING" },
    });
  });
});
