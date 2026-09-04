/** `YYYY-MM-DD` in UTC — the format the `date` columns round-trip as. */
export function toDayString(value: Date | string): string {
  if (typeof value === "string") return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

export function addDays(day: string, amount: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return toDayString(date);
}

/**
 * Every day from `start` to `end` inclusive. The chart needs this because a
 * campaign period will contain days with no metric rows at all, and those have
 * to render as zero rather than collapse out of the axis.
 */
export function eachDay(start: string, end: string, maxDays = 400): string[] {
  if (end < start) return [];
  const days: string[] = [];
  let cursor = start;
  while (cursor <= end && days.length < maxDays) {
    days.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return days;
}

export function formatDayLabel(day: string): string {
  return new Date(`${day}T00:00:00.000Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function formatDateTime(value: Date | string): string {
  return new Date(value).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
