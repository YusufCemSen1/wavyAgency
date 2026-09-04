import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";

import { db } from "@/db";
import type { User } from "@/db/schema";

export type Context = {
  db: typeof db;
  user: User | null;
  /** Set on the fetch adapter so mutations can attach a Set-Cookie header. */
  resHeaders: Headers | null;
};

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        // Surfaced to the UI so it can react to a specific failure (for
        // example: budget exhausted) rather than string-matching a message.
        appCode: error.cause instanceof AppError ? error.cause.appCode : null,
      },
    };
  },
});

/**
 * Domain failures the UI is expected to handle. Attached as the `cause` of a
 * TRPCError so the code survives serialisation to the client.
 */
export type AppErrorCode =
  | "BUDGET_EXCEEDED"
  | "CAMPAIGN_NOT_ACCEPTING"
  | "DUPLICATE_SUBMISSION"
  | "PLATFORM_NOT_ALLOWED"
  | "INVALID_POST_URL"
  | "ALREADY_REVIEWED";

export class AppError extends Error {
  constructor(
    readonly appCode: AppErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function appError(
  appCode: AppErrorCode,
  message: string,
  code: "BAD_REQUEST" | "CONFLICT" | "PRECONDITION_FAILED" = "BAD_REQUEST",
): TRPCError {
  return new TRPCError({ code, message, cause: new AppError(appCode, message) });
}

export const router = t.router;
export const createCallerFactory = t.createCallerFactory;
export const publicProcedure = t.procedure;

/** Any signed-in user. */
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Pick a user first" });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});

export const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Admins only" });
  }
  return next({ ctx });
});

export const creatorProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "creator") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Creators only" });
  }
  return next({ ctx });
});
