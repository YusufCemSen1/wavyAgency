import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { db } from "@/db";
import { campaigns, submissions } from "@/db/schema";
import { approveSubmission } from "@/server/services/submissions";

import { makeCampaign, makeMetric, makeSubmission, makeUser } from "./helpers";

/**
 * The scenario from the brief: two admins hit approve at the same moment on a
 * budget that only covers one of the two submissions.
 */
describe("concurrent approvals", () => {
  it("lets exactly one of two simultaneous approvals through", async () => {
    const creator = await makeUser("creator");
    const campaign = await makeCampaign({ payoutPer1kViews: 100, totalBudget: 1_000 });

    const first = await makeSubmission(campaign, creator);
    const second = await makeSubmission(campaign, creator);
    await makeMetric(first, 10_000); // each is worth exactly the whole budget
    await makeMetric(second, 10_000);

    const results = await Promise.allSettled([
      approveSubmission(first.id),
      approveSubmission(second.id),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      cause: { appCode: "BUDGET_EXCEEDED" },
    });

    const after = (await db.select().from(campaigns).where(eq(campaigns.id, campaign.id)))[0]!;
    expect(after.spentCents).toBe(1_000);
    expect(after.status).toBe("completed");

    const rows = await db.select().from(submissions).where(eq(submissions.campaignId, campaign.id));
    expect(rows.filter((row) => row.status === "approved")).toHaveLength(1);
    expect(rows.filter((row) => row.status === "pending")).toHaveLength(1);
  });

  it("never oversells the budget under a larger pile-up", async () => {
    const creator = await makeUser("creator");
    // Budget covers three submissions; eight admins race for it.
    const campaign = await makeCampaign({ payoutPer1kViews: 100, totalBudget: 3_000 });

    const created = [];
    for (let i = 0; i < 8; i += 1) {
      const submission = await makeSubmission(campaign, creator);
      await makeMetric(submission, 10_000); // 1_000 cents each
      created.push(submission);
    }

    const results = await Promise.allSettled(
      created.map((submission) => approveSubmission(submission.id)),
    );

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);

    const after = (await db.select().from(campaigns).where(eq(campaigns.id, campaign.id)))[0]!;
    expect(after.spentCents).toBe(3_000);
    expect(after.spentCents).toBeLessThanOrEqual(after.totalBudget);

    const rows = await db.select().from(submissions).where(eq(submissions.campaignId, campaign.id));
    const approvedTotal = rows
      .filter((row) => row.status === "approved")
      .reduce((sum, row) => sum + row.earningsCents, 0);
    expect(approvedTotal).toBe(after.spentCents);
  });

  it("approves the same submission only once when clicked twice", async () => {
    const creator = await makeUser("creator");
    const campaign = await makeCampaign({ payoutPer1kViews: 100, totalBudget: 10_000 });
    const submission = await makeSubmission(campaign, creator);
    await makeMetric(submission, 10_000);

    const results = await Promise.allSettled([
      approveSubmission(submission.id),
      approveSubmission(submission.id),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      (results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason,
    ).toMatchObject({ cause: { appCode: "ALREADY_REVIEWED" } });

    const after = (await db.select().from(campaigns).where(eq(campaigns.id, campaign.id)))[0]!;
    expect(after.spentCents).toBe(1_000);
  });
});
