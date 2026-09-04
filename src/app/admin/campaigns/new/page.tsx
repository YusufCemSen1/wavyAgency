"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { CampaignForm } from "@/components/campaign-form";
import { RequireRole } from "@/components/require-role";
import { addDays, toDayString } from "@/lib/dates";
import { trpc } from "@/trpc/client";

export default function NewCampaignPage() {
  return (
    <RequireRole role="admin">
      <NewCampaign />
    </RequireRole>
  );
}

function NewCampaign() {
  const router = useRouter();
  const utils = trpc.useUtils();
  const today = toDayString(new Date());

  const create = trpc.campaign.create.useMutation({
    async onSuccess(campaign) {
      await utils.campaign.list.invalidate();
      router.push(`/admin/campaigns/${campaign.id}`);
    },
  });

  return (
    <div className="grid gap-6">
      <div>
        <Link
          href="/admin/campaigns"
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          ← Campaigns
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">New campaign</h1>
      </div>

      <CampaignForm
        submitLabel="Create campaign"
        pending={create.isPending}
        serverError={create.error?.message ?? null}
        onSubmit={(values) => create.mutate(values)}
        defaultValues={{
          title: "",
          platforms: ["tiktok"],
          payoutPer1kViewsCents: 200,
          totalBudgetCents: 100_000,
          status: "draft",
          startsAt: today,
          endsAt: addDays(today, 30),
        }}
      />
    </div>
  );
}
