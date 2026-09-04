import { router } from "@/server/trpc/init";
import { campaignRouter } from "@/server/trpc/routers/campaign";
import { submissionRouter } from "@/server/trpc/routers/submission";
import { userRouter } from "@/server/trpc/routers/user";

export const appRouter = router({
  user: userRouter,
  campaign: campaignRouter,
  submission: submissionRouter,
});

export type AppRouter = typeof appRouter;
