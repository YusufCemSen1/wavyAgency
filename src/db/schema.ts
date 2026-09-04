import { relations, sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const userRole = pgEnum("user_role", ["admin", "creator"]);
export const platform = pgEnum("platform", ["tiktok", "instagram", "youtube"]);
export const campaignStatus = pgEnum("campaign_status", [
  "draft",
  "active",
  "paused",
  "completed",
]);
export const submissionStatus = pgEnum("submission_status", [
  "pending",
  "approved",
  "rejected",
  "paid",
]);

export const users = pgTable("user", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  role: userRole("role").notNull().default("creator"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const campaigns = pgTable(
  "campaign",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    platforms: platform("platforms").array().notNull(),
    payoutPer1kViews: integer("payout_per_1k_views").notNull(),
    totalBudget: integer("total_budget").notNull(),
    /**
     * Money already committed to approved submissions, in cents. Maintained
     * transactionally under a row lock; never exceeds `total_budget`. This is
     * the single source of truth for "budget spent" / "budget left".
     */
    spentCents: integer("spent_cents").notNull().default(0),
    status: campaignStatus("status").notNull().default("draft"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("campaign_status_idx").on(t.status),
    check("campaign_payout_positive", sql`${t.payoutPer1kViews} > 0`),
    check("campaign_budget_positive", sql`${t.totalBudget} > 0`),
    check("campaign_spent_within_budget", sql`${t.spentCents} >= 0 AND ${t.spentCents} <= ${t.totalBudget}`),
    check("campaign_period_ordered", sql`${t.endsAt} > ${t.startsAt}`),
  ],
);

export const submissions = pgTable(
  "submission",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    postUrl: text("post_url").notNull(),
    platform: platform("platform").notNull(),
    status: submissionStatus("status").notNull().default("pending"),
    rejectionReason: text("rejection_reason"),
    /**
     * Payable amount in cents. Derived from the latest metric row, but capped
     * by whatever budget was left when it was committed, so the sum over a
     * campaign can never exceed `campaign.total_budget`.
     */
    earningsCents: integer("earnings_cents").notNull().default(0),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // The same clip can't land on the same campaign twice.
    uniqueIndex("submission_campaign_url_unique").on(t.campaignId, t.postUrl),
    index("submission_campaign_status_idx").on(t.campaignId, t.status),
    index("submission_creator_idx").on(t.creatorId),
    check(
      "submission_rejection_reason_present",
      sql`(${t.status} <> 'rejected') OR (${t.rejectionReason} IS NOT NULL AND length(btrim(${t.rejectionReason})) > 0)`,
    ),
    check("submission_earnings_non_negative", sql`${t.earningsCents} >= 0`),
  ],
);

export const submissionMetrics = pgTable(
  "submission_metric",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => submissions.id, { onDelete: "cascade" }),
    capturedAt: date("captured_at").notNull(),
    views: integer("views").notNull(),
    likes: integer("likes").notNull().default(0),
    comments: integer("comments").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One row per submission per day. Also what makes ingest idempotent.
    uniqueIndex("submission_metric_day_unique").on(t.submissionId, t.capturedAt),
    index("submission_metric_captured_idx").on(t.capturedAt),
    check("submission_metric_counts_non_negative", sql`${t.views} >= 0 AND ${t.likes} >= 0 AND ${t.comments} >= 0`),
  ],
);

export const usersRelations = relations(users, ({ many }) => ({
  submissions: many(submissions),
}));

export const campaignsRelations = relations(campaigns, ({ many }) => ({
  submissions: many(submissions),
}));

export const submissionsRelations = relations(submissions, ({ one, many }) => ({
  campaign: one(campaigns, {
    fields: [submissions.campaignId],
    references: [campaigns.id],
  }),
  creator: one(users, {
    fields: [submissions.creatorId],
    references: [users.id],
  }),
  metrics: many(submissionMetrics),
}));

export const submissionMetricsRelations = relations(submissionMetrics, ({ one }) => ({
  submission: one(submissions, {
    fields: [submissionMetrics.submissionId],
    references: [submissions.id],
  }),
}));

export type User = typeof users.$inferSelect;
export type Campaign = typeof campaigns.$inferSelect;
export type Submission = typeof submissions.$inferSelect;
export type SubmissionMetric = typeof submissionMetrics.$inferSelect;

export type Platform = (typeof platform.enumValues)[number];
export type CampaignStatus = (typeof campaignStatus.enumValues)[number];
export type SubmissionStatus = (typeof submissionStatus.enumValues)[number];
export type UserRole = (typeof userRole.enumValues)[number];
