import { db } from "@/db";
import {
  campaigns,
  submissionMetrics,
  submissions,
  users,
  type Campaign,
  type Platform,
  type Submission,
  type User,
} from "@/db/schema";
import { addDays, toDayString } from "@/lib/dates";
import { appRouter } from "@/server/trpc/routers/_app";
import { createCallerFactory } from "@/server/trpc/init";

let counter = 0;
const unique = () => `${Date.now().toString(36)}${(counter += 1)}`;

export async function makeUser(
  role: "admin" | "creator" = "creator",
  name: string = role,
): Promise<User> {
  const [user] = await db
    .insert(users)
    .values({ email: `${name}-${unique()}@test.local`, name, role })
    .returning();
  return user!;
}

export async function makeCampaign(overrides: Partial<typeof campaigns.$inferInsert> = {}): Promise<Campaign> {
  const today = toDayString(new Date());
  const [campaign] = await db
    .insert(campaigns)
    .values({
      title: `Campaign ${unique()}`,
      platforms: ["tiktok"],
      payoutPer1kViews: 100,
      totalBudget: 100_000,
      status: "active",
      startsAt: new Date(`${addDays(today, -5)}T00:00:00.000Z`),
      endsAt: new Date(`${addDays(today, 5)}T23:59:59.999Z`),
      ...overrides,
    })
    .returning();
  return campaign!;
}

let urlCounter = 1_000_000_000_000_000;

export async function makeSubmission(
  campaign: Campaign,
  creator: User,
  overrides: Partial<typeof submissions.$inferInsert> = {},
): Promise<Submission> {
  const platform: Platform = overrides.platform ?? campaign.platforms[0] ?? "tiktok";
  urlCounter += 1;
  const [submission] = await db
    .insert(submissions)
    .values({
      campaignId: campaign.id,
      creatorId: creator.id,
      platform,
      postUrl: `https://www.tiktok.com/@tester/video/${urlCounter}`,
      status: "pending",
      ...overrides,
    })
    .returning();
  return submission!;
}

export async function makeMetric(
  submission: Submission,
  views: number,
  day = toDayString(new Date()),
) {
  await db
    .insert(submissionMetrics)
    .values({ submissionId: submission.id, capturedAt: day, views, likes: 0, comments: 0 })
    .onConflictDoNothing();
}

export const createCaller = createCallerFactory(appRouter);

export function callerFor(user: User | null) {
  return createCaller({ db, user, resHeaders: null });
}

export { db };
