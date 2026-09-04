"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";

import { CampaignForm } from "@/components/campaign-form";
import { RequireRole } from "@/components/require-role";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { toDayString } from "@/lib/dates";
import { trpc } from "@/trpc/client";

export default function EditCampaignPage() {
  return (
    <RequireRole role="admin">
      <EditCampaign />
    </RequireRole>
  );
}

function EditCampaign() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const utils = trpc.useUtils();

  const campaign = trpc.campaign.byId.useQuery({ id: params.id });

  const update = trpc.campaign.update.useMutation({
    async onSuccess() {
      await Promise.all([
        utils.campaign.list.invalidate(),
        utils.campaign.byId.invalidate({ id: params.id }),
        utils.campaign.overview.invalidate({ id: params.id }),
      ]);
      router.push(`/admin/campaigns/${params.id}`);
    },
  });

  if (campaign.isPending) return <Skeleton className="h-96 w-full max-w-2xl" />;
  if (campaign.error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Couldn&apos;t load this campaign</AlertTitle>
        <AlertDescription>{campaign.error.message}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="grid gap-6">
      <div>
        <Link
          href={`/admin/campaigns/${params.id}`}
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          ← {campaign.data.title}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Edit campaign</h1>
      </div>

      <CampaignForm
        submitLabel="Save changes"
        pending={update.isPending}
        serverError={update.error?.message ?? null}
        onSubmit={(values) => update.mutate({ ...values, id: params.id })}
        defaultValues={{
          title: campaign.data.title,
          platforms: campaign.data.platforms,
          payoutPer1kViewsCents: campaign.data.payoutPer1kViews,
          totalBudgetCents: campaign.data.totalBudget,
          status: campaign.data.status,
          startsAt: toDayString(campaign.data.startsAt),
          endsAt: toDayString(campaign.data.endsAt),
        }}
      />
    </div>
  );
}
