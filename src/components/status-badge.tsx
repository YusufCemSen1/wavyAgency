import { Badge } from "@/components/ui/badge";
import type { CampaignStatus, SubmissionStatus } from "@/db/schema";

const CAMPAIGN_VARIANT: Record<CampaignStatus, "default" | "secondary" | "outline" | "success"> = {
  draft: "outline",
  active: "success",
  paused: "secondary",
  completed: "default",
};

const SUBMISSION_VARIANT: Record<
  SubmissionStatus,
  "default" | "secondary" | "outline" | "success" | "destructive"
> = {
  pending: "secondary",
  approved: "success",
  rejected: "destructive",
  paid: "default",
};

export function CampaignStatusBadge({ status }: { status: CampaignStatus }) {
  return <Badge variant={CAMPAIGN_VARIANT[status]}>{status}</Badge>;
}

export function SubmissionStatusBadge({ status }: { status: SubmissionStatus }) {
  return <Badge variant={SUBMISSION_VARIANT[status]}>{status}</Badge>;
}
