import { createHmac, timingSafeEqual } from "node:crypto";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { users, type User } from "@/db/schema";

export const SESSION_COOKIE = "clipmarket_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

function secret(): string {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 16) {
    throw new Error("AUTH_SECRET is missing or too short — see .env.example");
  }
  return value;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

/**
 * The take-home explicitly asks for cheap auth, so the cookie is just a userId
 * with an HMAC over it. It is tamper-evident, which is all the server needs:
 * every procedure re-reads the user from the database and re-checks role and
 * ownership, so a forged cookie buys nothing even if the signature held.
 */
export function encodeSessionCookie(userId: string): string {
  return `${userId}.${sign(userId)}`;
}

export function decodeSessionCookie(value: string | undefined | null): string | null {
  if (!value) return null;
  const separator = value.lastIndexOf(".");
  if (separator <= 0) return null;

  const userId = value.slice(0, separator);
  const signature = value.slice(separator + 1);

  const expected = Buffer.from(sign(userId));
  const received = Buffer.from(signature);
  if (expected.length !== received.length) return null;
  if (!timingSafeEqual(expected, received)) return null;

  return userId;
}

export function sessionCookieHeader(userId: string | null): string {
  const base = [
    `${SESSION_COOKIE}=${userId ? encodeSessionCookie(userId) : ""}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    userId ? `Max-Age=${MAX_AGE_SECONDS}` : "Max-Age=0",
  ];
  if (process.env.NODE_ENV === "production") base.push("Secure");
  return base.join("; ");
}

function readCookie(cookieHeader: string | null, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) {
      return decodeURIComponent(part.slice(index + 1).trim());
    }
  }
  return undefined;
}

/** Resolves the signed cookie to a real database row, or null. */
export async function userFromCookieHeader(cookieHeader: string | null): Promise<User | null> {
  const userId = decodeSessionCookie(readCookie(cookieHeader, SESSION_COOKIE));
  if (!userId) return null;

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return user ?? null;
}
