import type { Platform } from "@/db/schema";

export const PLATFORMS = ["tiktok", "instagram", "youtube"] as const;

export const PLATFORM_LABELS: Record<Platform, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  youtube: "YouTube",
};

/**
 * A post URL is accepted only if it matches the shape of a real post on that
 * platform — a profile or a homepage is rejected. Each matcher also returns a
 * canonical form, so the same clip submitted with tracking params or via a
 * short link collides on the (campaign_id, post_url) unique index instead of
 * sneaking through as a second submission.
 */
type Matcher = {
  platform: Platform;
  test: (url: URL) => string | null;
};

const hostIs = (url: URL, ...hosts: string[]) => {
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  return hosts.includes(host);
};

const MATCHERS: Matcher[] = [
  {
    platform: "tiktok",
    test: (url) => {
      if (!hostIs(url, "tiktok.com", "m.tiktok.com")) return null;
      const match = url.pathname.match(/^\/@([\w.-]{1,60})\/video\/(\d{5,30})\/?$/);
      if (!match) return null;
      return `https://www.tiktok.com/@${match[1]!.toLowerCase()}/video/${match[2]}`;
    },
  },
  {
    platform: "instagram",
    test: (url) => {
      if (!hostIs(url, "instagram.com")) return null;
      const match = url.pathname.match(/^\/(?:[\w.]{1,40}\/)?(p|reel|reels|tv)\/([\w-]{5,30})\/?$/);
      if (!match) return null;
      const kind = match[1] === "reels" ? "reel" : match[1];
      return `https://www.instagram.com/${kind}/${match[2]}/`;
    },
  },
  {
    platform: "youtube",
    test: (url) => {
      if (hostIs(url, "youtu.be")) {
        const id = url.pathname.match(/^\/([\w-]{6,20})\/?$/)?.[1];
        return id ? `https://www.youtube.com/watch?v=${id}` : null;
      }
      if (!hostIs(url, "youtube.com", "m.youtube.com")) return null;

      const shorts = url.pathname.match(/^\/shorts\/([\w-]{6,20})\/?$/);
      if (shorts) return `https://www.youtube.com/shorts/${shorts[1]}`;

      if (url.pathname === "/watch") {
        const id = url.searchParams.get("v");
        return id && /^[\w-]{6,20}$/.test(id) ? `https://www.youtube.com/watch?v=${id}` : null;
      }
      return null;
    },
  },
];

export type ParsedPostUrl = {
  platform: Platform;
  /** Canonical URL to store — strips tracking params, resolves short links. */
  canonicalUrl: string;
};

/** Returns null when the string isn't a recognisable post URL on any platform. */
export function parsePostUrl(input: string): ParsedPostUrl | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  for (const matcher of MATCHERS) {
    const canonicalUrl = matcher.test(url);
    if (canonicalUrl) return { platform: matcher.platform, canonicalUrl };
  }
  return null;
}
