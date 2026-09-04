import { createHash } from "node:crypto";

import { desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { submissionMetrics, submissions } from "@/db/schema";
import { toDayString } from "@/lib/dates";
import { recordDailyMetric, type RecordMetricInput, type RecordMetricResult } from "@/server/services/metrics";

export type IngestFailure = { submissionId: string; message: string };

export type IngestSummary = {
  day: string;
  processed: number;
  created: number;
  skipped: number;
  committedCents: number;
  failures: IngestFailure[];
};

export type IngestOptions = {
  /** Day to capture, `YYYY-MM-DD`. Defaults to today (UTC). */
  day?: string;
  /** Swappable so tests can make a single submission blow up mid-run. */
  record?: (input: RecordMetricInput) => Promise<RecordMetricResult>;
  log?: (message: string) => void;
};

/**
 * Stands in for the third-party view sync we'd run on a schedule in
 * production. Every approved submission gets one row for `day`.
 *
 * Failures are per-submission: one bad clip doesn't abort the run, and the
 * caller gets every failure back rather than just the first.
 */
export async function runIngest(options: IngestOptions = {}): Promise<IngestSummary> {
  const day = options.day ?? toDayString(new Date());
  const record = options.record ?? recordDailyMetric;
  const log = options.log ?? (() => {});

  const approved = await db
    .select({ id: submissions.id })
    .from(submissions)
    .where(eq(submissions.status, "approved"))
    .orderBy(submissions.createdAt);

  const summary: IngestSummary = {
    day,
    processed: 0,
    created: 0,
    skipped: 0,
    committedCents: 0,
    failures: [],
  };

  for (const { id } of approved) {
    summary.processed += 1;
    try {
      const previous = await previousCapture(id);
      const next = syntheticCapture(id, day, previous);
      const result = await record({ submissionId: id, capturedAt: day, ...next });

      if (result.inserted) {
        summary.created += 1;
        summary.committedCents += result.committedCents;
      } else {
        summary.skipped += 1;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      summary.failures.push({ submissionId: id, message });
      log(`  ! ${id}: ${message}`);
    }
  }

  return summary;
}

type Capture = { views: number; likes: number; comments: number };

async function previousCapture(submissionId: string): Promise<Capture> {
  const [row] = await db
    .select({
      views: submissionMetrics.views,
      likes: submissionMetrics.likes,
      comments: submissionMetrics.comments,
    })
    .from(submissionMetrics)
    .where(eq(submissionMetrics.submissionId, submissionId))
    .orderBy(desc(submissionMetrics.capturedAt))
    .limit(1);

  return row ?? { views: 0, likes: 0, comments: 0 };
}

/**
 * Deterministic fake numbers: the same submission and day always produce the
 * same capture, so a re-run can't drift even if the idempotency check were
 * removed. Growth is always positive, so views only go up.
 */
function syntheticCapture(submissionId: string, day: string, previous: Capture): Capture {
  const noise = hashToUnit(`${submissionId}:${day}`);
  const seed = hashToUnit(submissionId);

  const growth =
    previous.views === 0
      ? Math.round(500 + seed * 40_000 + noise * 8_000)
      : Math.max(1, Math.round(previous.views * (0.03 + noise * 0.22)));

  const views = previous.views + growth;
  return {
    views,
    likes: previous.likes + Math.round(growth * (0.02 + noise * 0.06)),
    comments: previous.comments + Math.round(growth * (0.001 + noise * 0.004)),
  };
}

/** Stable [0, 1) from a string. */
function hashToUnit(value: string): number {
  const digest = createHash("sha256").update(value).digest();
  return digest.readUInt32BE(0) / 0x1_0000_0000;
}
