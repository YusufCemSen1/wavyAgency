"use client";

import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/trpc/client";

/**
 * Stands in for signing in. There is no password: pick a seeded user and the
 * server writes a signed cookie. Every procedure still re-checks role and
 * ownership server-side.
 */
export default function SignInPage() {
  const router = useRouter();
  const utils = trpc.useUtils();
  const users = trpc.user.all.useQuery();

  const switchUser = trpc.user.switch.useMutation({
    async onSuccess(user) {
      await utils.invalidate();
      router.replace(user.role === "admin" ? "/admin/campaigns" : "/campaigns");
      router.refresh();
    },
  });

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="text-2xl font-semibold tracking-tight">Pick a user</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Dev-only switcher. Real auth is deliberately out of scope.
      </p>

      <div className="mt-6 grid gap-3">
        {users.isPending
          ? [0, 1, 2].map((i) => <Skeleton key={i} className="h-20 w-full" />)
          : (users.data ?? []).map((user) => (
              <Card key={user.id}>
                <CardHeader className="flex-row items-center justify-between gap-4 space-y-0 pb-5">
                  <div>
                    <CardTitle className="text-base">{user.name}</CardTitle>
                    <CardDescription>
                      {user.email} · {user.role}
                    </CardDescription>
                  </div>
                  <Button
                    onClick={() => switchUser.mutate({ userId: user.id })}
                    disabled={switchUser.isPending}
                  >
                    Continue
                  </Button>
                </CardHeader>
              </Card>
            ))}
        {users.data?.length === 0 ? (
          <Card>
            <CardContent className="pt-5 text-sm text-muted-foreground">
              No users yet. Run <code className="font-mono">pnpm db:seed</code>.
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
