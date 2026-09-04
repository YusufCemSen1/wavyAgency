import { asc, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { users } from "@/db/schema";
import { switchUserSchema } from "@/lib/schemas";
import { sessionCookieHeader } from "@/server/auth";
import { publicProcedure, router } from "@/server/trpc/init";

export const userRouter = router({
  /** Everyone in the seed set — this is what the dev-only switcher renders. */
  all: publicProcedure.query(async () => {
    return db
      .select({ id: users.id, name: users.name, email: users.email, role: users.role })
      .from(users)
      .orderBy(asc(users.role), asc(users.name));
  }),

  me: publicProcedure.query(({ ctx }) => ctx.user),

  /**
   * Dev-only user switcher. In a real deployment this endpoint would not exist;
   * it stands in for signing in and just writes the signed session cookie.
   */
  switch: publicProcedure.input(switchUserSchema).mutation(async ({ input, ctx }) => {
    const [user] = await db.select().from(users).where(eq(users.id, input.userId)).limit(1);
    if (!user) throw new Error("No such user");

    ctx.resHeaders?.append("set-cookie", sessionCookieHeader(user.id));
    return { id: user.id, name: user.name, role: user.role };
  }),

  signOut: publicProcedure.input(z.void()).mutation(({ ctx }) => {
    ctx.resHeaders?.append("set-cookie", sessionCookieHeader(null));
    return { ok: true };
  }),
});
