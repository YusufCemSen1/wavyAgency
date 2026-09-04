import { fetchRequestHandler } from "@trpc/server/adapters/fetch";

import { db } from "@/db";
import { userFromCookieHeader } from "@/server/auth";
import { appRouter } from "@/server/trpc/routers/_app";

/**
 * The one HTTP endpoint in the app. Everything else the client needs goes
 * through tRPC procedures — there are no REST route handlers for app data.
 */
const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: async ({ resHeaders }) => ({
      db,
      user: await userFromCookieHeader(req.headers.get("cookie")),
      resHeaders,
    }),
    onError({ error, path }) {
      if (error.code === "INTERNAL_SERVER_ERROR") {
        console.error(`tRPC failed on ${path ?? "<no path>"}:`, error.cause ?? error);
      }
    },
  });

export { handler as GET, handler as POST };
