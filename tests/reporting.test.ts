import { describe, expect, it } from "vitest";

import { addDays, toDayString } from "@/lib/dates";
import { approveSubmission, rejectSubmission } from "@/server/services/submissions";

import { callerFor, makeCampaign, makeMetric, makeSubmission, makeUser } from "./helpers";

const today = toDayString(new Date());

/**
 * The list and overview numbers are correlated subqueries over three tables.
 * They are easy to get subtly wrong in a way that still returns rows — an
 * earlier version of `pendingCount` bound its correlation to the inner table
 * and returned zero for everything — so they're pinned here.
 */
describe("admin reporting numbers", () => {
  it("counts pending submissions per campaign, without bleeding across campaigns", async () => {
    const admin = await makeUser("admin");
    const creator = await makeUser("creator");

    const busy = await makeCampaign({ title: "Busy" });
    const quiet = await makeCampaign({ title: "Quiet" });

    await makeSubmission(busy, creator);
    await makeSubmission(busy, creator);
    const reviewed = await makeSubmission(busy, creator);
    await rejectSubmission(reviewed.id, "Off brief entirely.");
    await makeSubmission(quiet, creator);

    const list = await callerFor(admin).campaign.list({ perPage: 50 });
    const byTitle = new Map(list.items.map((item) => [item.title, item.pendingCount]));

    expect(byTitle.get("Busy")).toBe(2);
    expect(byTitle.get("Quiet")).toBe(1);
  });

  it("counts approved views from the latest capture only, ignoring unapproved clips", async () => {
    const admin = await makeUser("admin");
    const creator = await makeUser("creator");
    const campaign = await makeCampaign({ payoutPer1kViews: 100, totalBudget: 1_000_000 });

    const approved = await makeSubmission(campaign, creator);
    await makeMetric(approved, 10_000, addDays(today, -1));
    await makeMetric(approved, 25_000, today);
    await approveSubmission(approved.id);

    // Pending and rejected clips collect metrics but don't count as approved views.
    const pending = await makeSubmission(campaign, creator);
    await makeMetric(pending, 999_999, today);
    const rejected = await makeSubmission(campaign, creator);
    await makeMetric(rejected, 999_999, today);
    await rejectSubmission(rejected.id, "Wrong product shown.");

    const overview = await callerFor(admin).campaign.overview({ id: campaign.id });

    expect(overview.approvedViews).toBe(25_000);
    expect(overview.counts).toEqual({ pending: 1, approved: 1, rejected: 1 });
  });

  it("charts every day of the period, with zeros where nothing was captured", async () => {
    const admin = await makeUser("admin");
    const creator = await makeUser("creator");
    const campaign = await makeCampaign({
      startsAt: new Date(`${addDays(today, -4)}T00:00:00.000Z`),
      endsAt: new Date(`${addDays(today, 2)}T23:59:59.999Z`),
    });

    const submission = await makeSubmission(campaign, creator);
    await approveSubmission(submission.id);
    await makeMetric(submission, 1_000, addDays(today, -3));
    // Nothing on -2: the chart still needs a bar there.
    await makeMetric(submission, 4_000, addDays(today, -1));

    const overview = await callerFor(admin).campaign.overview({ id: campaign.id });
    const byDay = new Map(overview.series.map((point) => [point.day, point.views]));

    expect(overview.series).toHaveLength(7);
    expect(byDay.get(addDays(today, -4))).toBe(0);
    expect(byDay.get(addDays(today, -3))).toBe(1_000);
    expect(byDay.get(addDays(today, -2))).toBe(0);
    // Day-over-day delta, not the cumulative total.
    expect(byDay.get(addDays(today, -1))).toBe(3_000);
    expect(byDay.get(addDays(today, 2))).toBe(0);
  });

  it("shows each submission's current views in the review queue", async () => {
    const admin = await makeUser("admin");
    const creator = await makeUser("creator");
    const campaign = await makeCampaign({ payoutPer1kViews: 250, totalBudget: 1_000_000 });

    const submission = await makeSubmission(campaign, creator);
    await makeMetric(submission, 3_100, addDays(today, -1));
    await makeMetric(submission, 7_900, today);

    const queue = await callerFor(admin).submission.forCampaign({ campaignId: campaign.id });

    expect(queue.items).toHaveLength(1);
    expect(queue.items[0]!.views).toBe(7_900);
    // What it would earn if approved right now: floor(7900 / 1000) * 250.
    expect(queue.items[0]!.projectedCents).toBe(7 * 250);
  });

  it("paginates, searches and filters on the server", async () => {
    const admin = await makeUser("admin");
    for (const title of ["Alpha run", "Beta run", "Gamma push", "Delta push"]) {
      await makeCampaign({ title, status: title.includes("push") ? "paused" : "active" });
    }

    const caller = callerFor(admin);

    const firstPage = await caller.campaign.list({ page: 1, perPage: 2 });
    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.total).toBe(4);
    expect(firstPage.pageCount).toBe(2);

    const secondPage = await caller.campaign.list({ page: 2, perPage: 2 });
    expect(secondPage.items).toHaveLength(2);
    expect(
      new Set([...firstPage.items, ...secondPage.items].map((c) => c.id)).size,
    ).toBe(4);

    const searched = await caller.campaign.list({ search: "run" });
    expect(searched.total).toBe(2);

    const filtered = await caller.campaign.list({ status: "paused" });
    expect(filtered.total).toBe(2);

    const both = await caller.campaign.list({ search: "push", status: "active" });
    expect(both.total).toBe(0);
  });
});
