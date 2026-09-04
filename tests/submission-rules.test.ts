import { describe, expect, it } from "vitest";

import { callerFor, makeCampaign, makeUser } from "./helpers";

describe("submitting a clip", () => {
  it("refuses a URL that isn't a real post", async () => {
    const creator = await makeUser("creator");
    const campaign = await makeCampaign({ status: "active" });

    await expect(
      callerFor(creator).submission.create({
        campaignId: campaign.id,
        postUrl: "https://www.tiktok.com/@casey",
      }),
    ).rejects.toMatchObject({ cause: { appCode: "INVALID_POST_URL" } });
  });

  it("refuses a platform the campaign doesn't run on", async () => {
    const creator = await makeUser("creator");
    const campaign = await makeCampaign({ platforms: ["youtube"], status: "active" });

    await expect(
      callerFor(creator).submission.create({
        campaignId: campaign.id,
        postUrl: "https://www.tiktok.com/@casey/video/7412300000000000010",
      }),
    ).rejects.toMatchObject({ cause: { appCode: "PLATFORM_NOT_ALLOWED" } });
  });

  it("won't take the same clip twice, even in a different URL form", async () => {
    const creator = await makeUser("creator");
    const other = await makeUser("creator", "other");
    const campaign = await makeCampaign({ platforms: ["youtube"], status: "active" });

    await callerFor(creator).submission.create({
      campaignId: campaign.id,
      postUrl: "https://www.youtube.com/watch?v=energy0001",
    });

    // Same clip, short link, different creator — still the same clip.
    await expect(
      callerFor(other).submission.create({
        campaignId: campaign.id,
        postUrl: "https://youtu.be/energy0001",
      }),
    ).rejects.toMatchObject({ cause: { appCode: "DUPLICATE_SUBMISSION" } });
  });

  it("allows the same clip on a different campaign", async () => {
    const creator = await makeUser("creator");
    const first = await makeCampaign({ platforms: ["youtube"], status: "active" });
    const second = await makeCampaign({ platforms: ["youtube"], status: "active" });

    const url = "https://www.youtube.com/watch?v=shared0001";
    await callerFor(creator).submission.create({ campaignId: first.id, postUrl: url });
    await expect(
      callerFor(creator).submission.create({ campaignId: second.id, postUrl: url }),
    ).resolves.toMatchObject({ campaignId: second.id });
  });

  it("won't take submissions on a campaign that isn't active", async () => {
    const creator = await makeUser("creator");
    const campaign = await makeCampaign({ status: "paused" });

    await expect(
      callerFor(creator).submission.create({
        campaignId: campaign.id,
        postUrl: "https://www.tiktok.com/@casey/video/7412300000000000011",
      }),
    ).rejects.toMatchObject({ cause: { appCode: "CAMPAIGN_NOT_ACCEPTING" } });
  });

  it("requires a reason to reject", async () => {
    const admin = await makeUser("admin");
    const creator = await makeUser("creator");
    const campaign = await makeCampaign({ status: "active" });
    const submission = await callerFor(creator).submission.create({
      campaignId: campaign.id,
      postUrl: "https://www.tiktok.com/@casey/video/7412300000000000012",
    });

    await expect(
      callerFor(admin).submission.reject({ submissionId: submission.id, reason: "no" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    await expect(
      callerFor(admin).submission.reject({
        submissionId: submission.id,
        reason: "Product isn't visible.",
      }),
    ).resolves.toEqual({ ok: true });
  });
});
