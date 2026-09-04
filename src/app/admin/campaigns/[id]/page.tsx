"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import * as React from "react";

import { DailyViewsChart } from "@/components/daily-views-chart";
import { Pagination } from "@/components/pagination";
import { RequireRole } from "@/components/require-role";
import { CampaignStatusBadge, SubmissionStatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime, toDayString } from "@/lib/dates";
import { formatCents, formatNumber } from "@/lib/money";
import { PLATFORM_LABELS } from "@/lib/platforms";
import { SUBMISSION_STATUSES } from "@/lib/schemas";
import { appCodeOf, trpc } from "@/trpc/client";

export default function CampaignDetailPage() {
  return (
    <RequireRole role="admin">
      <CampaignDetail />
    </RequireRole>
  );
}

function CampaignDetail() {
  const params = useParams<{ id: string }>();
  const overview = trpc.campaign.overview.useQuery({ id: params.id });

  if (overview.isPending) {
    return (
      <div className="grid gap-4" aria-busy="true">
        <Skeleton className="h-10 w-80" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (overview.error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Couldn&apos;t load this campaign</AlertTitle>
        <AlertDescription>{overview.error.message}</AlertDescription>
      </Alert>
    );
  }

  const { campaign, approvedViews, spentCents, remainingCents, series, counts } = overview.data;

  return (
    <div className="grid gap-6">
      <div>
        <Link
          href="/admin/campaigns"
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          ← Campaigns
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{campaign.title}</h1>
          <CampaignStatusBadge status={campaign.status} />
          <div className="flex gap-1">
            {campaign.platforms.map((platform) => (
              <Badge key={platform} variant="outline">
                {PLATFORM_LABELS[platform]}
              </Badge>
            ))}
          </div>
          <Button asChild variant="outline" size="sm" className="ml-auto">
            <Link href={`/admin/campaigns/${campaign.id}/edit`}>Edit</Link>
          </Button>
        </div>
        <p className="mt-1 text-sm text-muted-foreground tabular-nums">
          {toDayString(campaign.startsAt)} → {toDayString(campaign.endsAt)} ·{" "}
          {formatCents(campaign.payoutPer1kViews)} per 1,000 views
        </p>
      </div>

      {campaign.status === "completed" ? (
        <Alert>
          <AlertTitle>Budget spent</AlertTitle>
          <AlertDescription>
            This campaign committed its full budget and closed itself. Pending submissions can no
            longer be approved.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Approved views" value={formatNumber(approvedViews)} />
        <Stat label="Budget spent" value={formatCents(spentCents)} />
        <Stat label="Budget left" value={formatCents(remainingCents)} />
        <Stat
          label="Submissions"
          value={`${counts.approved} approved`}
          hint={`${counts.pending} pending · ${counts.rejected} rejected`}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Daily views</CardTitle>
        </CardHeader>
        <CardContent>
          <DailyViewsChart data={series} />
        </CardContent>
      </Card>

      <ReviewQueue campaignId={campaign.id} />
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="pt-5">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
        {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

const ALL = "all";

function ReviewQueue({ campaignId }: { campaignId: string }) {
  const [status, setStatus] = React.useState<string>("pending");
  const [page, setPage] = React.useState(1);
  const [rejecting, setRejecting] = React.useState<{ id: string; url: string } | null>(null);
  const [reason, setReason] = React.useState("");
  const [banner, setBanner] = React.useState<{ tone: "error" | "ok"; message: string } | null>(null);

  const utils = trpc.useUtils();
  const queue = trpc.submission.forCampaign.useQuery({
    campaignId,
    status: status === ALL ? null : (status as (typeof SUBMISSION_STATUSES)[number]),
    page,
    perPage: 10,
  });

  const refresh = async () => {
    await Promise.all([
      utils.submission.forCampaign.invalidate({ campaignId }),
      utils.campaign.overview.invalidate({ id: campaignId }),
      utils.campaign.list.invalidate(),
    ]);
  };

  const approve = trpc.submission.approve.useMutation({
    async onSuccess(result) {
      setBanner({
        tone: "ok",
        message: `Approved for ${formatCents(result.earningsCents)}. ${formatCents(
          result.campaignRemainingCents,
        )} left in the budget.`,
      });
      await refresh();
    },
    onError(error) {
      // The server tags domain failures so the UI doesn't string-match messages.
      const code = appCodeOf(error);
      setBanner({
        tone: "error",
        message:
          code === "BUDGET_EXCEEDED"
            ? `Not enough budget left to approve this one. ${error.message}`
            : error.message,
      });
      void refresh();
    },
  });

  const reject = trpc.submission.reject.useMutation({
    async onSuccess() {
      setRejecting(null);
      setReason("");
      setBanner({ tone: "ok", message: "Submission rejected." });
      await refresh();
    },
    onError(error) {
      setBanner({ tone: "error", message: error.message });
    },
  });

  const reasonError =
    reason.trim().length > 0 && reason.trim().length < 5
      ? "Tell the creator why in at least a few words"
      : null;

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex-row items-center justify-between gap-4 space-y-0">
        <CardTitle className="text-base">Review queue</CardTitle>
        <div className="w-44">
          <label htmlFor="queue-status" className="sr-only">
            Filter submissions by status
          </label>
          <Select
            value={status}
            onValueChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
          >
            <SelectTrigger id="queue-status" className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All statuses</SelectItem>
              {SUBMISSION_STATUSES.map((value) => (
                <SelectItem key={value} value={value}>
                  {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>

      {banner ? (
        <div className="px-5 pb-3">
          <Alert variant={banner.tone === "error" ? "destructive" : "default"}>
            <AlertDescription>{banner.message}</AlertDescription>
          </Alert>
        </div>
      ) : null}

      {queue.isPending ? (
        <div className="grid gap-2 p-4" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : queue.error ? (
        <div className="p-4">
          <Alert variant="destructive">
            <AlertDescription>{queue.error.message}</AlertDescription>
          </Alert>
        </div>
      ) : queue.data.items.length === 0 ? (
        <p className="p-8 text-center text-sm text-muted-foreground">
          {status === "pending" ? "Nothing waiting for review." : "No submissions with that status."}
        </p>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Clip</TableHead>
                <TableHead>Creator</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Views</TableHead>
                <TableHead className="text-right">Earns</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {queue.data.items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="max-w-72">
                    <a
                      href={item.postUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="block truncate text-sm underline-offset-4 hover:underline"
                    >
                      {item.postUrl}
                    </a>
                    <span className="text-xs text-muted-foreground">
                      {PLATFORM_LABELS[item.platform]} · {formatDateTime(item.createdAt)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm">{item.creatorName}</span>
                  </TableCell>
                  <TableCell>
                    <SubmissionStatusBadge status={item.status} />
                    {item.rejectionReason ? (
                      <p className="mt-1 max-w-48 text-xs text-muted-foreground">
                        {item.rejectionReason}
                      </p>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatNumber(item.views)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {item.status === "approved"
                      ? formatCents(item.earningsCents)
                      : item.status === "pending"
                        ? formatCents(item.projectedCents)
                        : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    {item.status === "pending" ? (
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          disabled={approve.isPending}
                          onClick={() => approve.mutate({ submissionId: item.id })}
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setRejecting({ id: item.id, url: item.postUrl });
                            setReason("");
                          }}
                        >
                          Reject
                        </Button>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {item.reviewedAt ? formatDateTime(item.reviewedAt) : "—"}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pagination
            page={queue.data.page}
            pageCount={queue.data.pageCount}
            total={queue.data.total}
            onPageChange={setPage}
          />
        </>
      )}

      <Dialog open={rejecting !== null} onOpenChange={(open) => !open && setRejecting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject this submission</DialogTitle>
            <DialogDescription className="truncate">{rejecting?.url}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-1.5">
            <label htmlFor="rejection-reason" className="text-sm font-medium">
              Reason (shown to the creator)
            </label>
            <Textarea
              id="rejection-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              aria-invalid={Boolean(reasonError)}
              aria-describedby={reasonError ? "rejection-reason-error" : undefined}
              placeholder="Doesn't feature the product…"
            />
            {reasonError ? (
              <p id="rejection-reason-error" className="text-xs font-medium text-destructive">
                {reasonError}
              </p>
            ) : null}
            {reject.error ? (
              <p className="text-xs font-medium text-destructive">{reject.error.message}</p>
            ) : null}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setRejecting(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={reject.isPending || reason.trim().length < 5}
              onClick={() =>
                rejecting && reject.mutate({ submissionId: rejecting.id, reason: reason.trim() })
              }
            >
              {reject.isPending ? "Rejecting…" : "Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
