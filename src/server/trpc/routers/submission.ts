import { TRPCError } from "@trpc/server";
import { and, count, desc, eq, sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { campaigns, submissions, users } from "@/db/schema";
import { grossEarningsCents } from "@/lib/money";
import {
  submissionApproveSchema,
  submissionCreateSchema,
  submissionListInputSchema,
  submissionRejectSchema,
} from "@/lib/schemas";
import {
  approveSubmission,
  createSubmission,
  rejectSubmission,
} from "@/server/services/submissions";
import { adminProcedure, creatorProcedure, protectedProcedure, router } from "@/server/trpc/init";

/**
 * Latest capture per submission, as a correlated subquery.
 *
 * Table qualifiers are written out rather than interpolated: drizzle renders an
 * interpolated column unqualified, which inside this subquery would resolve
 * `id` against `submission_metric` instead of `submission` and quietly return
 * zero for every row.
 */
const latestViewsSql = sql<number>`coalesce((
  select m.views
  from "submission_metric" m
  where m.submission_id = "submission"."id"
  order by m.captured_at desc
  limit 1
), 0)::int`;

export const submissionRouter = router({
  /** Admin review queue for one campaign. */
  forCampaign: adminProcedure.input(submissionListInputSchema).query(async ({ input }) => {
    if (!input.campaignId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "campaignId is required" });
    }

    const filters: SQL[] = [eq(submissions.campaignId, input.campaignId)];
    if (input.status) filters.push(eq(submissions.status, input.status));
    const where = and(...filters);

    const [totalRow] = await db.select({ total: count() }).from(submissions).where(where);

    const items = await db
      .select({
        id: submissions.id,
        postUrl: submissions.postUrl,
        platform: submissions.platform,
        status: submissions.status,
        rejectionReason: submissions.rejectionReason,
        earningsCents: submissions.earningsCents,
        createdAt: submissions.createdAt,
        reviewedAt: submissions.reviewedAt,
        creatorName: users.name,
        creatorEmail: users.email,
        payoutPer1kViews: campaigns.payoutPer1kViews,
        views: latestViewsSql,
      })
      .from(submissions)
      .innerJoin(users, eq(users.id, submissions.creatorId))
      .innerJoin(campaigns, eq(campaigns.id, submissions.campaignId))
      .where(where)
      .orderBy(desc(submissions.createdAt))
      .limit(input.perPage)
      .offset((input.page - 1) * input.perPage);

    const totalCount = totalRow?.total ?? 0;
    return {
      items: items.map((item) => ({
        ...item,
        projectedCents: grossEarningsCents(item.views, item.payoutPer1kViews),
      })),
      page: input.page,
      perPage: input.perPage,
      total: totalCount,
      pageCount: Math.max(1, Math.ceil(totalCount / input.perPage)),
    };
  }),

  approve: adminProcedure.input(submissionApproveSchema).mutation(async ({ input }) => {
    return approveSubmission(input.submissionId);
  }),

  reject: adminProcedure.input(submissionRejectSchema).mutation(async ({ input }) => {
    await rejectSubmission(input.submissionId, input.reason);
    return { ok: true };
  }),

  create: creatorProcedure.input(submissionCreateSchema).mutation(async ({ input, ctx }) => {
    // creatorId comes from the session, never from the input — a creator can't
    // submit on someone else's behalf by editing the payload.
    return createSubmission({
      campaignId: input.campaignId,
      creatorId: ctx.user.id,
      postUrl: input.postUrl,
    });
  }),

  /**
   * "My submissions". Scoped to the session user in the WHERE clause, so there
   * is no input a creator could craft to read someone else's rows.
   */
  mine: creatorProcedure
    .input(z.object({ campaignId: z.string().uuid().nullish() }).default({}))
    .query(async ({ input, ctx }) => {
      const filters: SQL[] = [eq(submissions.creatorId, ctx.user.id)];
      if (input.campaignId) filters.push(eq(submissions.campaignId, input.campaignId));

      const rows = await db
        .select({
          id: submissions.id,
          postUrl: submissions.postUrl,
          platform: submissions.platform,
          status: submissions.status,
          rejectionReason: submissions.rejectionReason,
          earningsCents: submissions.earningsCents,
          createdAt: submissions.createdAt,
          campaignId: campaigns.id,
          campaignTitle: campaigns.title,
          payoutPer1kViews: campaigns.payoutPer1kViews,
          views: latestViewsSql,
        })
        .from(submissions)
        .innerJoin(campaigns, eq(campaigns.id, submissions.campaignId))
        .where(and(...filters))
        .orderBy(desc(submissions.createdAt));

      return rows.map((row) => ({
        ...row,
        projectedCents: grossEarningsCents(row.views, row.payoutPer1kViews),
      }));
    }),

  /** Single submission. Admins see any; creators only see their own. */
  byId: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      const [row] = await db
        .select()
        .from(submissions)
        .where(eq(submissions.id, input.id))
        .limit(1);

      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Submission not found" });

      if (ctx.user.role !== "admin" && row.creatorId !== ctx.user.id) {
        // Deliberately NOT_FOUND: a creator shouldn't be able to probe which
        // submission ids exist.
        throw new TRPCError({ code: "NOT_FOUND", message: "Submission not found" });
      }

      return row;
    }),
});
