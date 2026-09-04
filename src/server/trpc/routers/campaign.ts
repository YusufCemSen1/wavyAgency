import { TRPCError } from "@trpc/server";
import { and, count, desc, eq, ilike, sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { campaigns, submissions } from "@/db/schema";
import { eachDay, toDayString } from "@/lib/dates";
import { campaignInputSchema, campaignListInputSchema, campaignUpdateSchema } from "@/lib/schemas";
import { adminProcedure, protectedProcedure, router } from "@/server/trpc/init";

const startOfDay = (day: string) => new Date(`${day}T00:00:00.000Z`);
const endOfDay = (day: string) => new Date(`${day}T23:59:59.999Z`);

const byId = z.object({ id: z.string().uuid() });

export const campaignRouter = router({
  /** Admin campaign list. Paginated, searched and filtered on the server. */
  list: adminProcedure.input(campaignListInputSchema).query(async ({ input }) => {
    const filters: SQL[] = [];
    if (input.search) filters.push(ilike(campaigns.title, `%${input.search}%`));
    if (input.status) filters.push(eq(campaigns.status, input.status));
    const where = filters.length > 0 ? and(...filters) : undefined;

    const [totalRow] = await db.select({ total: count() }).from(campaigns).where(where);

    const items = await db
      .select({
        id: campaigns.id,
        title: campaigns.title,
        platforms: campaigns.platforms,
        status: campaigns.status,
        payoutPer1kViews: campaigns.payoutPer1kViews,
        totalBudget: campaigns.totalBudget,
        spentCents: campaigns.spentCents,
        startsAt: campaigns.startsAt,
        endsAt: campaigns.endsAt,
        // Written with explicit table qualifiers: drizzle renders interpolated
        // columns unqualified inside `sql` templates, which in a correlated
        // subquery silently binds to the inner table instead of the outer one.
        pendingCount: sql<number>`(
          select count(*)::int
          from "submission" ps
          where ps.campaign_id = "campaign"."id" and ps.status = 'pending'
        )`,
      })
      .from(campaigns)
      .where(where)
      .orderBy(desc(campaigns.createdAt))
      .limit(input.perPage)
      .offset((input.page - 1) * input.perPage);

    const totalCount = totalRow?.total ?? 0;
    return {
      items,
      page: input.page,
      perPage: input.perPage,
      total: totalCount,
      pageCount: Math.max(1, Math.ceil(totalCount / input.perPage)),
    };
  }),

  byId: adminProcedure.input(byId).query(async ({ input }) => {
    const campaign = await loadCampaign(input.id);
    return campaign;
  }),

  create: adminProcedure.input(campaignInputSchema).mutation(async ({ input }) => {
    const [created] = await db
      .insert(campaigns)
      .values({
        title: input.title,
        platforms: input.platforms,
        payoutPer1kViews: input.payoutPer1kViewsCents,
        totalBudget: input.totalBudgetCents,
        status: input.status,
        startsAt: startOfDay(input.startsAt),
        endsAt: endOfDay(input.endsAt),
      })
      .returning();

    return created!;
  }),

  update: adminProcedure.input(campaignUpdateSchema).mutation(async ({ input }) => {
    const existing = await loadCampaign(input.id);

    // Money already committed can't be un-committed by editing the budget down.
    if (input.totalBudgetCents < existing.spentCents) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `This campaign has already committed ${(existing.spentCents / 100).toFixed(2)} USD; the budget can't go below that`,
      });
    }

    const [updated] = await db
      .update(campaigns)
      .set({
        title: input.title,
        platforms: input.platforms,
        payoutPer1kViews: input.payoutPer1kViewsCents,
        totalBudget: input.totalBudgetCents,
        status: input.status,
        startsAt: startOfDay(input.startsAt),
        endsAt: endOfDay(input.endsAt),
        updatedAt: new Date(),
      })
      .where(eq(campaigns.id, input.id))
      .returning();

    return updated!;
  }),

  /**
   * Per-campaign overview: approved views, budget spent/left, and one bar per
   * day of the campaign period. Days with no captures come back as zero rather
   * than dropping out of the series.
   */
  overview: adminProcedure.input(byId).query(async ({ input }) => {
    const campaign = await loadCampaign(input.id);

    // Latest capture per approved submission — that's what "current views" means.
    const latestPerSubmission = await db.execute<{ views: number }>(sql`
      select distinct on (m.submission_id) m.views
      from submission_metric m
      join submission s on s.id = m.submission_id
      where s.campaign_id = ${campaign.id} and s.status = 'approved'
      order by m.submission_id, m.captured_at desc
    `);

    const approvedViews = Array.from(latestPerSubmission).reduce(
      (sum, row) => sum + Number(row.views),
      0,
    );

    // New views per day, from the day-over-day delta of each submission.
    const dailyRows = await db.execute<{ day: string; views: number }>(sql`
      with per_day as (
        select
          m.captured_at,
          m.views - coalesce(
            lag(m.views) over (partition by m.submission_id order by m.captured_at),
            0
          ) as delta
        from submission_metric m
        join submission s on s.id = m.submission_id
        where s.campaign_id = ${campaign.id} and s.status = 'approved'
      )
      select to_char(captured_at, 'YYYY-MM-DD') as day, sum(delta)::int as views
      from per_day
      group by captured_at
      order by captured_at
    `);

    const byDay = new Map<string, number>();
    for (const row of dailyRows) byDay.set(row.day, Number(row.views));

    const series = eachDay(toDayString(campaign.startsAt), toDayString(campaign.endsAt)).map(
      (day) => ({ day, views: byDay.get(day) ?? 0 }),
    );

    const [counts] = await db
      .select({
        pending: sql<number>`count(*) filter (where "submission"."status" = 'pending')::int`,
        approved: sql<number>`count(*) filter (where "submission"."status" = 'approved')::int`,
        rejected: sql<number>`count(*) filter (where "submission"."status" = 'rejected')::int`,
      })
      .from(submissions)
      .where(eq(submissions.campaignId, campaign.id));

    return {
      campaign,
      approvedViews,
      spentCents: campaign.spentCents,
      remainingCents: Math.max(0, campaign.totalBudget - campaign.spentCents),
      series,
      counts: counts ?? { pending: 0, approved: 0, rejected: 0 },
    };
  }),

  /** What a creator can browse and submit to. */
  browse: protectedProcedure.query(async () => {
    return db
      .select({
        id: campaigns.id,
        title: campaigns.title,
        platforms: campaigns.platforms,
        payoutPer1kViews: campaigns.payoutPer1kViews,
        totalBudget: campaigns.totalBudget,
        spentCents: campaigns.spentCents,
        startsAt: campaigns.startsAt,
        endsAt: campaigns.endsAt,
      })
      .from(campaigns)
      .where(eq(campaigns.status, "active"))
      .orderBy(desc(campaigns.createdAt));
  }),
});

async function loadCampaign(id: string) {
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1);
  if (!campaign) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Campaign not found" });
  }
  return campaign;
}
