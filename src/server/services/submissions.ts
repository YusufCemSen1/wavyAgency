import { and, eq } from "drizzle-orm";

import { db, type Executor } from "@/db";
import { campaigns, submissions, type Submission } from "@/db/schema";
import { formatCents, grossEarningsCents } from "@/lib/money";
import { parsePostUrl } from "@/lib/platforms";
import { appError } from "@/server/trpc/init";
import { commitToBudget, latestViews, lockCampaign } from "@/server/services/budget";

/** Statuses in which an admin may still work through the review queue. */
const REVIEWABLE_CAMPAIGN_STATUSES = ["active", "paused"] as const;

async function lockSubmission(tx: Executor, submissionId: string): Promise<Submission | null> {
  const [submission] = await tx
    .select()
    .from(submissions)
    .where(eq(submissions.id, submissionId))
    .limit(1)
    .for("update");
  return submission ?? null;
}

export type ApproveResult = {
  submissionId: string;
  earningsCents: number;
  campaignSpentCents: number;
  campaignRemainingCents: number;
  campaignCompleted: boolean;
};

/**
 * Approve a pending submission and commit its payout against the campaign
 * budget, or fail.
 *
 * Concurrency: the whole thing runs in one transaction that takes a `FOR
 * UPDATE` lock on the campaign row before it reads `spentCents`. Simultaneous
 * approvals against a budget with room for only one of them are therefore
 * ordered by the lock queue — the first to get the lock commits, the second
 * wakes up, re-reads the now-higher `spentCents` and fails with
 * `BUDGET_EXCEEDED`. First come, first served, with no retry loop and no
 * partially-approved state.
 */
export async function approveSubmission(submissionId: string): Promise<ApproveResult> {
  return db.transaction(async (tx) => {
    const preview = await tx
      .select({ campaignId: submissions.campaignId })
      .from(submissions)
      .where(eq(submissions.id, submissionId))
      .limit(1);

    const campaignId = preview[0]?.campaignId;
    if (!campaignId) {
      throw appError("ALREADY_REVIEWED", "That submission no longer exists", "BAD_REQUEST");
    }

    // Always campaign-then-submission, everywhere, so locks can't cycle.
    const campaign = await lockCampaign(tx, campaignId);
    if (!campaign) {
      throw appError("ALREADY_REVIEWED", "That campaign no longer exists", "BAD_REQUEST");
    }

    const submission = await lockSubmission(tx, submissionId);
    if (!submission) {
      throw appError("ALREADY_REVIEWED", "That submission no longer exists", "BAD_REQUEST");
    }
    if (submission.status !== "pending") {
      throw appError(
        "ALREADY_REVIEWED",
        `This submission was already ${submission.status}`,
        "CONFLICT",
      );
    }
    if (campaign.status === "draft") {
      throw appError(
        "CAMPAIGN_NOT_ACCEPTING",
        "This campaign isn't live yet",
        "PRECONDITION_FAILED",
      );
    }

    const views = await latestViews(tx, submissionId);
    const grossCents = grossEarningsCents(views, campaign.payoutPer1kViews);
    const remainingCents = campaign.totalBudget - campaign.spentCents;

    // Checked before the `completed` gate on purpose. A campaign that closed
    // itself closed *because* the budget ran out, and the loser of a race
    // deserves to be told that rather than "this campaign is closed".
    if (grossCents > remainingCents) {
      throw appError(
        "BUDGET_EXCEEDED",
        `Approving this would cost ${formatCents(grossCents)} but only ${formatCents(remainingCents)} is left in the budget`,
        "CONFLICT",
      );
    }

    if (!REVIEWABLE_CAMPAIGN_STATUSES.includes(campaign.status as "active" | "paused")) {
      throw appError(
        "CAMPAIGN_NOT_ACCEPTING",
        campaign.spentCents >= campaign.totalBudget
          ? "This campaign has spent its budget and is closed"
          : "This campaign is closed",
        "PRECONDITION_FAILED",
      );
    }

    await tx
      .update(submissions)
      .set({ status: "approved", rejectionReason: null, reviewedAt: new Date(), updatedAt: new Date() })
      .where(eq(submissions.id, submissionId));

    const commit = await commitToBudget(tx, campaign, submissionId, grossCents, 0);

    return {
      submissionId,
      earningsCents: commit.committedCents,
      campaignSpentCents: commit.spentCentsAfter,
      campaignRemainingCents: commit.remainingCentsAfter,
      campaignCompleted: commit.campaignCompleted,
    };
  });
}

export async function rejectSubmission(submissionId: string, reason: string): Promise<void> {
  await db.transaction(async (tx) => {
    const submission = await lockSubmission(tx, submissionId);
    if (!submission) {
      throw appError("ALREADY_REVIEWED", "That submission no longer exists", "BAD_REQUEST");
    }
    if (submission.status !== "pending") {
      throw appError(
        "ALREADY_REVIEWED",
        `This submission was already ${submission.status}`,
        "CONFLICT",
      );
    }

    await tx
      .update(submissions)
      .set({
        status: "rejected",
        rejectionReason: reason,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(submissions.id, submissionId));
  });
}

export type CreateSubmissionInput = {
  campaignId: string;
  creatorId: string;
  postUrl: string;
};

/**
 * Creators submit a clip URL. The URL has to parse as a real post on one of the
 * campaign's platforms, and the canonical form has to be new for that campaign.
 */
export async function createSubmission(input: CreateSubmissionInput): Promise<Submission> {
  const parsed = parsePostUrl(input.postUrl);
  if (!parsed) {
    throw appError(
      "INVALID_POST_URL",
      "That isn't a post URL we recognise. Paste a link to a specific TikTok, Instagram or YouTube post.",
    );
  }

  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, input.campaignId))
    .limit(1);

  if (!campaign) {
    throw appError("CAMPAIGN_NOT_ACCEPTING", "That campaign no longer exists");
  }
  if (campaign.status !== "active") {
    throw appError(
      "CAMPAIGN_NOT_ACCEPTING",
      "This campaign isn't accepting submissions right now",
      "PRECONDITION_FAILED",
    );
  }
  if (!campaign.platforms.includes(parsed.platform)) {
    throw appError(
      "PLATFORM_NOT_ALLOWED",
      `This campaign doesn't accept ${parsed.platform} posts`,
    );
  }

  const existing = await db
    .select({ id: submissions.id })
    .from(submissions)
    .where(
      and(
        eq(submissions.campaignId, input.campaignId),
        eq(submissions.postUrl, parsed.canonicalUrl),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    throw appError("DUPLICATE_SUBMISSION", "That clip has already been submitted to this campaign", "CONFLICT");
  }

  try {
    const [created] = await db
      .insert(submissions)
      .values({
        campaignId: input.campaignId,
        creatorId: input.creatorId,
        postUrl: parsed.canonicalUrl,
        platform: parsed.platform,
        status: "pending",
      })
      .returning();

    return created!;
  } catch (error) {
    // The check above is a nicety; this is the one that actually holds under
    // two simultaneous submissions of the same URL.
    if (isUniqueViolation(error)) {
      throw appError("DUPLICATE_SUBMISSION", "That clip has already been submitted to this campaign", "CONFLICT");
    }
    throw error;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}
