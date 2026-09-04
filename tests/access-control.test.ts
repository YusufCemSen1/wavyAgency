import { TRPCError } from "@trpc/server";
import { describe, expect, it } from "vitest";

import { callerFor, makeCampaign, makeSubmission, makeUser } from "./helpers";

/**
 * The client is not trusted. These call the procedures directly with a
 * fabricated session, which is the same thing a hand-crafted request would do.
 */
describe("access control", () => {
  it("keeps one creator out of another creator's submission", async () => {
    const owner = await makeUser("creator", "owner");
    const stranger = await makeUser("creator", "stranger");
    const campaign = await makeCampaign();
    const submission = await makeSubmission(campaign, owner);

    await expect(
      callerFor(stranger).submission.byId({ id: submission.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    // The owner still sees it.
    await expect(callerFor(owner).submission.byId({ id: submission.id })).resolves.toMatchObject({
      id: submission.id,
    });
  });

  it("scopes 'my submissions' to the session user, not to any input", async () => {
    const owner = await makeUser("creator", "owner");
    const stranger = await makeUser("creator", "stranger");
    const campaign = await makeCampaign();
    await makeSubmission(campaign, owner);
    await makeSubmission(campaign, stranger);

    const mine = await callerFor(owner).submission.mine({ campaignId: campaign.id });
    expect(mine).toHaveLength(1);
    expect(mine[0]!.id).toBeDefined();

    const theirs = await callerFor(stranger).submission.mine({ campaignId: campaign.id });
    expect(theirs).toHaveLength(1);
    expect(theirs[0]!.id).not.toBe(mine[0]!.id);
  });

  it("records the creator from the session, so a payload can't impersonate", async () => {
    const owner = await makeUser("creator", "owner");
    const victim = await makeUser("creator", "victim");
    const campaign = await makeCampaign({ platforms: ["tiktok"], status: "active" });

    const created = await callerFor(owner).submission.create({
      campaignId: campaign.id,
      postUrl: "https://www.tiktok.com/@owner/video/7412300000000000099",
      // There is no creatorId in the input schema at all — this is the point.
    });

    expect(created.creatorId).toBe(owner.id);
    expect(created.creatorId).not.toBe(victim.id);
  });

  it("blocks creators from every admin procedure", async () => {
    const creator = await makeUser("creator");
    const admin = await makeUser("admin");
    const campaign = await makeCampaign();
    const submission = await makeSubmission(campaign, creator);

    const asCreator = callerFor(creator);

    await expect(asCreator.campaign.list({})).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(asCreator.campaign.byId({ id: campaign.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(asCreator.campaign.overview({ id: campaign.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(asCreator.submission.approve({ submissionId: submission.id })).rejects.toMatchObject(
      { code: "FORBIDDEN" },
    );
    await expect(
      asCreator.submission.reject({ submissionId: submission.id, reason: "no good" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    // And the admin genuinely can.
    await expect(callerFor(admin).campaign.byId({ id: campaign.id })).resolves.toMatchObject({
      id: campaign.id,
    });
  });

  it("blocks admins from creator-only procedures", async () => {
    const admin = await makeUser("admin");
    const campaign = await makeCampaign({ status: "active" });

    await expect(
      callerFor(admin).submission.create({
        campaignId: campaign.id,
        postUrl: "https://www.tiktok.com/@admin/video/7412300000000000098",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects anonymous callers", async () => {
    const campaign = await makeCampaign();
    const anonymous = callerFor(null);

    await expect(anonymous.campaign.list({})).rejects.toBeInstanceOf(TRPCError);
    await expect(anonymous.campaign.list({})).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(anonymous.campaign.browse()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(anonymous.campaign.overview({ id: campaign.id })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
});
