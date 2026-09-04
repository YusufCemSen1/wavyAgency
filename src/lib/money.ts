/**
 * Every amount in this codebase is an integer number of cents. Nothing here
 * touches floats, so there is no rounding drift to reason about.
 */

/**
 * What an approved submission is worth at a given view count:
 * `floor(views / 1000) * payout_per_1k_views`.
 *
 * Partial thousands pay nothing — 1,999 views on a $2.00/1k campaign is $2.00.
 */
export function grossEarningsCents(views: number, payoutPer1kViews: number): number {
  if (!Number.isFinite(views) || !Number.isFinite(payoutPer1kViews)) {
    throw new TypeError("grossEarningsCents expects finite numbers");
  }
  if (views < 0 || payoutPer1kViews < 0) {
    throw new RangeError("grossEarningsCents expects non-negative numbers");
  }
  return Math.floor(views / 1000) * payoutPer1kViews;
}

/** Budget still available on a campaign. Never negative. */
export function remainingBudgetCents(totalBudget: number, spentCents: number): number {
  return Math.max(0, totalBudget - spentCents);
}

/**
 * How much of `desiredCents` a campaign can actually commit right now.
 * Used both when approving and when a later metric row raises a submission's
 * gross earnings: growth past the budget is clipped rather than paid out.
 */
export function committableCents(
  desiredCents: number,
  totalBudget: number,
  spentCents: number,
): number {
  return Math.min(Math.max(0, desiredCents), remainingBudgetCents(totalBudget, spentCents));
}

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export function formatCents(cents: number): string {
  return usd.format(cents / 100);
}

export function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(
    value,
  );
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}
