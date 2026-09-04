"use client";

import { RequireRole } from "@/components/require-role";
import { SubmissionStatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime } from "@/lib/dates";
import { formatCents, formatNumber } from "@/lib/money";
import { PLATFORM_LABELS } from "@/lib/platforms";
import { trpc } from "@/trpc/client";

export default function MySubmissionsPage() {
  return (
    <RequireRole role="creator">
      <MySubmissions />
    </RequireRole>
  );
}

function MySubmissions() {
  const submissions = trpc.submission.mine.useQuery({});

  const totalEarned = (submissions.data ?? [])
    .filter((row) => row.status === "approved" || row.status === "paid")
    .reduce((sum, row) => sum + row.earningsCents, 0);

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">My submissions</h1>
        <p className="text-sm text-muted-foreground">
          Approved clips earn {"floor(views / 1,000)"} × the campaign rate, capped by whatever
          budget was left when they were approved.
        </p>
      </div>

      {submissions.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : submissions.error ? (
        <Alert variant="destructive">
          <AlertTitle>Couldn&apos;t load your submissions</AlertTitle>
          <AlertDescription>{submissions.error.message}</AlertDescription>
        </Alert>
      ) : submissions.data.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Nothing submitted yet. Browse the active campaigns to get started.
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardContent className="pt-5">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Earned so far
              </p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">
                {formatCents(totalEarned)}
              </p>
            </CardContent>
          </Card>

          <Card className="overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Clip</TableHead>
                  <TableHead>Campaign</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Views</TableHead>
                  <TableHead className="text-right">Earnings</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {submissions.data.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="max-w-72">
                      <a
                        href={row.postUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="block truncate text-sm underline-offset-4 hover:underline"
                      >
                        {row.postUrl}
                      </a>
                      <span className="text-xs text-muted-foreground">
                        {PLATFORM_LABELS[row.platform]} · {formatDateTime(row.createdAt)}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm">{row.campaignTitle}</TableCell>
                    <TableCell>
                      <SubmissionStatusBadge status={row.status} />
                      {row.rejectionReason ? (
                        <p className="mt-1 max-w-56 text-xs text-muted-foreground">
                          {row.rejectionReason}
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatNumber(row.views)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.status === "approved" || row.status === "paid" ? (
                        formatCents(row.earningsCents)
                      ) : row.status === "pending" ? (
                        <span className="text-muted-foreground">
                          {formatCents(row.projectedCents)} est.
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </>
      )}
    </div>
  );
}
