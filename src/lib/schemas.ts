import { z } from "zod";

import { PLATFORMS } from "@/lib/platforms";

/**
 * These are the schemas the forms validate against and the schemas the tRPC
 * procedures validate against — same object, imported by both sides, so the
 * client can never send a shape the server hasn't agreed to.
 */

export const CAMPAIGN_STATUSES = ["draft", "active", "paused", "completed"] as const;
export const SUBMISSION_STATUSES = ["pending", "approved", "rejected", "paid"] as const;

const dayString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date");

const campaignFields = z.object({
  title: z.string().trim().min(3, "Give the campaign a title").max(120, "Keep the title under 120 characters"),
  platforms: z
    .array(z.enum(PLATFORMS))
    .min(1, "Pick at least one platform")
    .max(PLATFORMS.length),
  // Cents. The form renders dollars and converts on the way in.
  payoutPer1kViewsCents: z
    .number()
    .int("Payout must be a whole number of cents")
    .positive("Payout must be more than zero")
    .max(1_000_000, "That payout looks like a typo"),
  totalBudgetCents: z
    .number()
    .int("Budget must be a whole number of cents")
    .positive("Budget must be more than zero")
    .max(2_000_000_000, "That budget looks like a typo"),
  status: z.enum(CAMPAIGN_STATUSES),
  startsAt: dayString,
  endsAt: dayString,
});

const periodOrdered = <T extends { startsAt: string; endsAt: string }>(value: T, ctx: z.RefinementCtx) => {
  if (value.endsAt <= value.startsAt) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["endsAt"],
      message: "End date has to be after the start date",
    });
  }
};

export const campaignInputSchema = campaignFields.superRefine(periodOrdered);
export const campaignUpdateSchema = campaignFields
  .extend({ id: z.string().uuid() })
  .superRefine(periodOrdered);

export type CampaignInput = z.infer<typeof campaignInputSchema>;
export type CampaignUpdateInput = z.infer<typeof campaignUpdateSchema>;

export const campaignListInputSchema = z.object({
  page: z.number().int().min(1).default(1),
  perPage: z.number().int().min(1).max(50).default(10),
  search: z.string().trim().max(120).default(""),
  status: z.enum(CAMPAIGN_STATUSES).nullish(),
});

export type CampaignListInput = z.input<typeof campaignListInputSchema>;

export const submissionCreateSchema = z.object({
  campaignId: z.string().uuid(),
  postUrl: z
    .string()
    .trim()
    .min(1, "Paste the URL of your clip")
    .max(500, "That URL is too long")
    .url("That doesn't look like a URL"),
});

export type SubmissionCreateInput = z.infer<typeof submissionCreateSchema>;

export const submissionApproveSchema = z.object({
  submissionId: z.string().uuid(),
});

export const submissionRejectSchema = z.object({
  submissionId: z.string().uuid(),
  reason: z
    .string()
    .trim()
    .min(5, "Tell the creator why in at least a few words")
    .max(500, "Keep the reason under 500 characters"),
});

export const submissionListInputSchema = z.object({
  campaignId: z.string().uuid().nullish(),
  status: z.enum(SUBMISSION_STATUSES).nullish(),
  page: z.number().int().min(1).default(1),
  perPage: z.number().int().min(1).max(50).default(10),
});

export const switchUserSchema = z.object({
  userId: z.string().uuid(),
});
