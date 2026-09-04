import { describe, expect, it } from "vitest";

import { parsePostUrl } from "@/lib/platforms";

/**
 * A creator picks the URL, so this is untrusted input on the money path: it
 * decides which campaign a clip can attach to and whether two submissions are
 * "the same clip".
 */
describe("parsePostUrl", () => {
  it("recognises real post URLs on each platform", () => {
    expect(parsePostUrl("https://www.tiktok.com/@casey/video/7412300000000000001")).toEqual({
      platform: "tiktok",
      canonicalUrl: "https://www.tiktok.com/@casey/video/7412300000000000001",
    });
    expect(parsePostUrl("https://www.instagram.com/reel/Cx1sneak01/")?.platform).toBe("instagram");
    expect(parsePostUrl("https://www.youtube.com/shorts/abc123def")?.platform).toBe("youtube");
  });

  it("rejects anything that isn't a specific post", () => {
    for (const input of [
      "",
      "not a url",
      "https://www.tiktok.com/@casey",
      "https://www.instagram.com/casey/",
      "https://www.youtube.com/",
      "https://example.com/@casey/video/123",
      "ftp://www.tiktok.com/@casey/video/7412300000000000001",
    ]) {
      expect(parsePostUrl(input), input).toBeNull();
    }
  });

  it("canonicalises so the same clip can't be submitted twice in disguise", () => {
    const canonical = "https://www.youtube.com/watch?v=energy0001";
    expect(parsePostUrl("https://youtu.be/energy0001")?.canonicalUrl).toBe(canonical);
    expect(parsePostUrl("https://www.youtube.com/watch?v=energy0001&t=30s")?.canonicalUrl).toBe(
      canonical,
    );
    expect(parsePostUrl("https://m.youtube.com/watch?v=energy0001")?.canonicalUrl).toBe(canonical);

    expect(
      parsePostUrl("https://www.tiktok.com/@Casey/video/7412300000000000001?is_from_webapp=1")
        ?.canonicalUrl,
    ).toBe("https://www.tiktok.com/@casey/video/7412300000000000001");
  });
});
