import { desc, eq } from "drizzle-orm";

import type { Executor } from "@/db";
import { campaigns, submissionMetrics, submissions, type Campaign } from "@/db/schema";
import { committableCents, grossEarningsCents } from "@/lib/money";

/**
 * Reads a campaign and holds a row lock on it for the rest of the transaction.
 *
 * This is the serialisation point for everything that touches money. Two
 * approvals on the same campaign cannot interleave: the second one blocks here
 * and, when it proceeds, sees the first one's `spentCents`. Approvals on
 * *different* campaigns don't contend at all.
 */
export async function lockCampaign(tx: Executor, campaignId: string): Promise<Campaign | null> {
  const [campaign] = await tx
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1)
    .for("update");
  return campaign ?? null;
}

/** Views on the most recent metric row, or 0 when nothing has been captured yet. */
export async function latestViews(tx: Executor, submissionId: string): Promise<number> {
  const [row] = await tx
    .select({ views: submissionMetrics.views })
    .from(submissionMetrics)
    .where(eq(submissionMetrics.submissionId, submissionId))
    .orderBy(desc(submissionMetrics.capturedAt))
    .limit(1);
  return row?.views ?? 0;
}

export type BudgetCommit = {
  /** What the payout formula says the submission is worth. */
  grossCents: number;
  /** What the campaign could actually cover — `grossCents` unless the budget ran out. */
  committedCents: number;
  spentCentsAfter: number;
  remainingCentsAfter: number;
  campaignCompleted: boolean;
};

/**
 * Moves `desiredDeltaCents` from a campaign's remaining budget onto a
 * submission, clipping at the budget ceiling, and flips the campaign to
 * `completed` when nothing is left.
 *
 * Callers must already hold the lock from `lockCampaign`.
 */
export async function commitToBudget(
  tx: Executor,
  campaign: Campaign,
  submissionId: string,
  desiredDeltaCents: number,
  currentEarningsCents: number,
): Promise<BudgetCommit> {
  const committedCents = committableCents(desiredDeltaCents, campaign.totalBudget, campaign.spentCents);
  const spentCentsAfter = campaign.spentCents + committedCents;
  const campaignCompleted = spentCentsAfter >= campaign.totalBudget;

  if (committedCents > 0) {
    await tx
      .update(submissions)
      .set({
        earningsCents: currentEarningsCents + committedCents,
        updatedAt: new Date(),
      })
      .where(eq(submissions.id, submissionId));
  }

  if (committedCents > 0 || (campaignCompleted && campaign.status !== "completed")) {
    await tx
      .update(campaigns)
      .set({
        spentCents: spentCentsAfter,
        status: campaignCompleted ? "completed" : campaign.status,
        updatedAt: new Date(),
      })
      .where(eq(campaigns.id, campaign.id));
  }

  return {
    grossCents: desiredDeltaCents + currentEarningsCents,
    committedCents,
    spentCentsAfter,
    remainingCentsAfter: Math.max(0, campaign.totalBudget - spentCentsAfter),
    campaignCompleted,
  };
}

export { grossEarningsCents };
