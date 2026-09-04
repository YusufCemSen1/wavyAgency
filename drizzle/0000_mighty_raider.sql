CREATE TYPE "public"."campaign_status" AS ENUM('draft', 'active', 'paused', 'completed');--> statement-breakpoint
CREATE TYPE "public"."platform" AS ENUM('tiktok', 'instagram', 'youtube');--> statement-breakpoint
CREATE TYPE "public"."submission_status" AS ENUM('pending', 'approved', 'rejected', 'paid');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'creator');--> statement-breakpoint
CREATE TABLE "campaign" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"platforms" "platform"[] NOT NULL,
	"payout_per_1k_views" integer NOT NULL,
	"total_budget" integer NOT NULL,
	"spent_cents" integer DEFAULT 0 NOT NULL,
	"status" "campaign_status" DEFAULT 'draft' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_payout_positive" CHECK ("campaign"."payout_per_1k_views" > 0),
	CONSTRAINT "campaign_budget_positive" CHECK ("campaign"."total_budget" > 0),
	CONSTRAINT "campaign_spent_within_budget" CHECK ("campaign"."spent_cents" >= 0 AND "campaign"."spent_cents" <= "campaign"."total_budget"),
	CONSTRAINT "campaign_period_ordered" CHECK ("campaign"."ends_at" > "campaign"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "submission_metric" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"captured_at" date NOT NULL,
	"views" integer NOT NULL,
	"likes" integer DEFAULT 0 NOT NULL,
	"comments" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "submission_metric_counts_non_negative" CHECK ("submission_metric"."views" >= 0 AND "submission_metric"."likes" >= 0 AND "submission_metric"."comments" >= 0)
);
--> statement-breakpoint
CREATE TABLE "submission" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"creator_id" uuid NOT NULL,
	"post_url" text NOT NULL,
	"platform" "platform" NOT NULL,
	"status" "submission_status" DEFAULT 'pending' NOT NULL,
	"rejection_reason" text,
	"earnings_cents" integer DEFAULT 0 NOT NULL,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "submission_rejection_reason_present" CHECK (("submission"."status" <> 'rejected') OR ("submission"."rejection_reason" IS NOT NULL AND length(btrim("submission"."rejection_reason")) > 0)),
	CONSTRAINT "submission_earnings_non_negative" CHECK ("submission"."earnings_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" "user_role" DEFAULT 'creator' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "submission_metric" ADD CONSTRAINT "submission_metric_submission_id_submission_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submission"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission" ADD CONSTRAINT "submission_campaign_id_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaign"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission" ADD CONSTRAINT "submission_creator_id_user_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaign_status_idx" ON "campaign" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "submission_metric_day_unique" ON "submission_metric" USING btree ("submission_id","captured_at");--> statement-breakpoint
CREATE INDEX "submission_metric_captured_idx" ON "submission_metric" USING btree ("captured_at");--> statement-breakpoint
CREATE UNIQUE INDEX "submission_campaign_url_unique" ON "submission" USING btree ("campaign_id","post_url");--> statement-breakpoint
CREATE INDEX "submission_campaign_status_idx" ON "submission" USING btree ("campaign_id","status");--> statement-breakpoint
CREATE INDEX "submission_creator_idx" ON "submission" USING btree ("creator_id");