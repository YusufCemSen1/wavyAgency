"use client";

import Link from "next/link";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import type { UserRole } from "@/db/schema";
import { trpc } from "@/trpc/client";

/**
 * Purely a UX affordance — it decides what to *render*. Authorisation itself
 * lives on every procedure; this component can be bypassed and nothing leaks.
 */
export function RequireRole({ role, children }: { role: UserRole; children: React.ReactNode }) {
  const me = trpc.user.me.useQuery();

  if (me.isPending) {
    return (
      <div className="grid gap-3" aria-busy="true">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!me.data) {
    return (
      <Alert>
        <AlertTitle>Pick a user first</AlertTitle>
        <AlertDescription>
          <Link href="/sign-in" className="underline underline-offset-4">
            Go to the user switcher
          </Link>
        </AlertDescription>
      </Alert>
    );
  }

  if (me.data.role !== role) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Not available for {me.data.role}s</AlertTitle>
        <AlertDescription>
          This area is for {role}s. Switch users from the header to continue.
        </AlertDescription>
      </Alert>
    );
  }

  return <>{children}</>;
}
