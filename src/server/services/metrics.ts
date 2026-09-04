import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { submissionMetrics, submissions } from "@/db/schema";
import { grossEarningsCents } from "@/lib/money";
import { commitToBudget, latestViews, lockCampaign } from "@/server/services/budget";

export type RecordMetricInput = {
  submissionId: string;
  /** `YYYY-MM-DD` */
  capturedAt: string;
  views: number;
  likes: number;
  comments: number;
};

export type RecordMetricResult = {
  /** False when a row for that submission/day already existed. */
  inserted: boolean;
  /** Extra cents committed to this submission by the new numbers. */
  committedCents: number;
  campaignCompleted: boolean;
};

export class MetricsWentBackwardsError extends Error {
  constructor(submissionId: string, previous: number, proposed: number) {
    super(
      `Refusing to write ${proposed} views for submission ${submissionId}: the last capture already had ${previous}`,
    );
    this.name = "MetricsWentBackwardsError";
  }
}

/**
 * Writes one day of metrics for a submission and reconciles the payout.
 *
 * Two invariants live here:
 *  - **Idempotent per day.** `(submission_id, captured_at)` is unique and the
 *    insert is `ON CONFLICT DO NOTHING`, so a second run for the same day is a
 *    no-op — it does not overwrite the numbers and does not move any money.
 *  - **Views only go up.** A capture below the previous one is refused rather
 *    than silently clamped, because in production that means the upstream feed
 *    is wrong and we'd rather see it.
 */
export async function recordDailyMetric(input: RecordMetricInput): Promise<RecordMetricResult> {
  return db.transaction(async (tx) => {
    const [submission] = await tx
      .select()
      .from(submissions)
      .where(eq(submissions.id, input.submissionId))
      .limit(1);

    if (!submission) {
      throw new Error(`Submission ${input.submissionId} not found`);
    }

    // Same lock order as approvals: campaign first, then submission.
    const campaign = await lockCampaign(tx, submission.campaignId);
    if (!campaign) {
      throw new Error(`Campaign ${submission.campaignId} not found`);
    }

    const existing = await tx
      .select({ id: submissionMetrics.id })
      .from(submissionMetrics)
      .where(
        and(
          eq(submissionMetrics.submissionId, input.submissionId),
          eq(submissionMetrics.capturedAt, input.capturedAt),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      return { inserted: false, committedCents: 0, campaignCompleted: campaign.status === "completed" };
    }

    const previousViews = await latestViews(tx, input.submissionId);
    if (input.views < previousViews) {
      throw new MetricsWentBackwardsError(input.submissionId, previousViews, input.views);
    }

    const inserted = await tx
      .insert(submissionMetrics)
      .values({
        submissionId: input.submissionId,
        capturedAt: input.capturedAt,
        views: input.views,
        likes: input.likes,
        comments: input.comments,
      })
      .onConflictDoNothing({
        target: [submissionMetrics.submissionId, submissionMetrics.capturedAt],
      })
      .returning({ id: submissionMetrics.id });

    if (inserted.length === 0) {
      return { inserted: false, committedCents: 0, campaignCompleted: campaign.status === "completed" };
    }

    // Only approved clips earn. Pending or rejected ones still collect metrics.
    if (submission.status !== "approved") {
      return { inserted: true, committedCents: 0, campaignCompleted: campaign.status === "completed" };
    }

    const grossCents = grossEarningsCents(input.views, campaign.payoutPer1kViews);
    const deltaCents = grossCents - submission.earningsCents;
    if (deltaCents <= 0) {
      return { inserted: true, committedCents: 0, campaignCompleted: campaign.status === "completed" };
    }

    const commit = await commitToBudget(
      tx,
      campaign,
      submission.id,
      deltaCents,
      submission.earningsCents,
    );

    return {
      inserted: true,
      committedCents: commit.committedCents,
      campaignCompleted: commit.campaignCompleted,
    };
  });
}
