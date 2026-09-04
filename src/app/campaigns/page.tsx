"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import * as React from "react";
import { useForm } from "react-hook-form";

import { RequireRole } from "@/components/require-role";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { toDayString } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { PLATFORM_LABELS } from "@/lib/platforms";
import { submissionCreateSchema, type SubmissionCreateInput } from "@/lib/schemas";
import { trpc } from "@/trpc/client";

export default function BrowseCampaignsPage() {
  return (
    <RequireRole role="creator">
      <BrowseCampaigns />
    </RequireRole>
  );
}

type OpenCampaign = { id: string; title: string; platforms: readonly string[] };

function BrowseCampaigns() {
  const [submitting, setSubmitting] = React.useState<OpenCampaign | null>(null);
  const campaigns = trpc.campaign.browse.useQuery();

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Active campaigns</h1>
        <p className="text-sm text-muted-foreground">
          Submit a clip and get paid per 1,000 views, up to the campaign budget.
        </p>
      </div>

      {campaigns.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-44 w-full" />
          ))}
        </div>
      ) : campaigns.error ? (
        <Alert variant="destructive">
          <AlertTitle>Couldn&apos;t load campaigns</AlertTitle>
          <AlertDescription>{campaigns.error.message}</AlertDescription>
        </Alert>
      ) : campaigns.data.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            No campaigns are running right now. Check back later.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {campaigns.data.map((campaign) => {
            const remaining = Math.max(0, campaign.totalBudget - campaign.spentCents);
            const pctLeft = Math.round((remaining / campaign.totalBudget) * 100);
            return (
              <Card key={campaign.id} className="flex flex-col">
                <CardHeader>
                  <CardTitle className="text-base">{campaign.title}</CardTitle>
                  <CardDescription className="tabular-nums">
                    {toDayString(campaign.startsAt)} → {toDayString(campaign.endsAt)}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-1 flex-col gap-3">
                  <div className="flex flex-wrap gap-1">
                    {campaign.platforms.map((platform) => (
                      <Badge key={platform} variant="outline">
                        {PLATFORM_LABELS[platform]}
                      </Badge>
                    ))}
                  </div>

                  <dl className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                        Per 1,000 views
                      </dt>
                      <dd className="font-medium tabular-nums">
                        {formatCents(campaign.payoutPer1kViews)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                        Budget left
                      </dt>
                      <dd className="font-medium tabular-nums">{formatCents(remaining)}</dd>
                    </div>
                  </dl>

                  <div
                    className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
                    role="img"
                    aria-label={`${pctLeft}% of the budget is left`}
                  >
                    <div className="h-full bg-chart-1" style={{ width: `${pctLeft}%` }} />
                  </div>

                  <Button
                    className="mt-auto w-fit"
                    onClick={() =>
                      setSubmitting({
                        id: campaign.id,
                        title: campaign.title,
                        platforms: campaign.platforms,
                      })
                    }
                  >
                    Submit a clip
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <SubmitClipDialog campaign={submitting} onClose={() => setSubmitting(null)} />
    </div>
  );
}

function SubmitClipDialog({
  campaign,
  onClose,
}: {
  campaign: OpenCampaign | null;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const [done, setDone] = React.useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<SubmissionCreateInput>({
    resolver: zodResolver(submissionCreateSchema),
    defaultValues: { campaignId: campaign?.id ?? "", postUrl: "" },
  });

  React.useEffect(() => {
    reset({ campaignId: campaign?.id ?? "", postUrl: "" });
    setDone(false);
  }, [campaign, reset]);

  const create = trpc.submission.create.useMutation({
    async onSuccess() {
      setDone(true);
      await utils.submission.mine.invalidate();
    },
  });

  const allowed = campaign?.platforms
    .map((platform) => PLATFORM_LABELS[platform as keyof typeof PLATFORM_LABELS])
    .join(", ");

  return (
    <Dialog open={campaign !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Submit a clip</DialogTitle>
          <DialogDescription>{campaign?.title}</DialogDescription>
        </DialogHeader>

        {done ? (
          <Alert>
            <AlertTitle>Submitted</AlertTitle>
            <AlertDescription>
              It&apos;s in the review queue. You&apos;ll see it under My submissions.
            </AlertDescription>
          </Alert>
        ) : (
          <form
            id="submit-clip"
            onSubmit={handleSubmit((values) =>
              create.mutate({ ...values, campaignId: campaign?.id ?? "" }),
            )}
            noValidate
            className="grid gap-3"
          >
            {create.error ? (
              <Alert variant="destructive">
                <AlertDescription>{create.error.message}</AlertDescription>
              </Alert>
            ) : null}

            <Field
              id="postUrl"
              label="Post URL"
              hint={`Accepted on this campaign: ${allowed ?? ""}`}
              error={errors.postUrl?.message}
            >
              {(props) => (
                <Input
                  {...props}
                  {...register("postUrl")}
                  type="url"
                  placeholder="https://www.tiktok.com/@you/video/1234567890123456789"
                />
              )}
            </Field>
          </form>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {done ? "Close" : "Cancel"}
          </Button>
          {done ? null : (
            <Button type="submit" form="submit-clip" disabled={create.isPending}>
              {create.isPending ? "Submitting…" : "Submit"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
