"use client";

import Link from "next/link";
import * as React from "react";

import { Pagination } from "@/components/pagination";
import { RequireRole } from "@/components/require-role";
import { CampaignStatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toDayString } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { PLATFORM_LABELS } from "@/lib/platforms";
import { CAMPAIGN_STATUSES } from "@/lib/schemas";
import { trpc } from "@/trpc/client";

const ALL = "all";

export default function AdminCampaignsPage() {
  return (
    <RequireRole role="admin">
      <CampaignList />
    </RequireRole>
  );
}

function CampaignList() {
  const [searchInput, setSearchInput] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [status, setStatus] = React.useState<string>(ALL);
  const [page, setPage] = React.useState(1);

  // Debounce so typing doesn't fire a query per keystroke.
  React.useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const list = trpc.campaign.list.useQuery({
    page,
    perPage: 10,
    search,
    status: status === ALL ? null : (status as (typeof CAMPAIGN_STATUSES)[number]),
  });

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Campaigns</h1>
          <p className="text-sm text-muted-foreground">
            Review queues, budgets and payouts across every campaign.
          </p>
        </div>
        <Button asChild>
          <Link href="/admin/campaigns/new">New campaign</Link>
        </Button>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="min-w-56 flex-1">
          <label htmlFor="campaign-search" className="sr-only">
            Search campaigns by title
          </label>
          <Input
            id="campaign-search"
            type="search"
            placeholder="Search by title…"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
        </div>
        <div className="w-44">
          <label htmlFor="campaign-status" className="sr-only">
            Filter by status
          </label>
          <Select
            value={status}
            onValueChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
          >
            <SelectTrigger id="campaign-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All statuses</SelectItem>
              {CAMPAIGN_STATUSES.map((value) => (
                <SelectItem key={value} value={value}>
                  {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card className="overflow-hidden">
        {list.isPending ? (
          <div className="grid gap-2 p-4" aria-busy="true">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : list.error ? (
          <div className="p-4">
            <Alert variant="destructive">
              <AlertTitle>Couldn&apos;t load campaigns</AlertTitle>
              <AlertDescription>{list.error.message}</AlertDescription>
            </Alert>
          </div>
        ) : list.data.items.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            {search || status !== ALL
              ? "No campaigns match those filters."
              : "No campaigns yet. Create the first one."}
          </p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Campaign</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Payout / 1k</TableHead>
                  <TableHead>Budget</TableHead>
                  <TableHead>Pending</TableHead>
                  <TableHead className="text-right">Period</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.data.items.map((campaign) => (
                  <TableRow key={campaign.id}>
                    <TableCell>
                      <Link
                        href={`/admin/campaigns/${campaign.id}`}
                        className="font-medium underline-offset-4 hover:underline"
                      >
                        {campaign.title}
                      </Link>
                      <div className="mt-1 flex gap-1">
                        {campaign.platforms.map((platform) => (
                          <Badge key={platform} variant="outline" className="text-[10px]">
                            {PLATFORM_LABELS[platform]}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      <CampaignStatusBadge status={campaign.status} />
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {formatCents(campaign.payoutPer1kViews)}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {formatCents(campaign.spentCents)}{" "}
                      <span className="text-muted-foreground">
                        / {formatCents(campaign.totalBudget)}
                      </span>
                    </TableCell>
                    <TableCell>
                      {campaign.pendingCount > 0 ? (
                        <Badge variant="secondary">{campaign.pendingCount}</Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground tabular-nums">
                      {toDayString(campaign.startsAt)} → {toDayString(campaign.endsAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Pagination
              page={list.data.page}
              pageCount={list.data.pageCount}
              total={list.data.total}
              onPageChange={setPage}
            />
          </>
        )}
      </Card>
    </div>
  );
}
