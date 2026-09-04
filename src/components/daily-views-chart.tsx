"use client";

import * as React from "react";

import { formatDayLabel } from "@/lib/dates";
import { formatCompactNumber, formatNumber } from "@/lib/money";

export type DailyViewsPoint = { day: string; views: number };

/**
 * New views per day across the campaign period.
 *
 * Hand-rolled SVG rather than a charting library: it's one series of bars, and
 * a dependency would have cost more than it saved. The same data is also
 * exposed as a real table for screen readers, which a canvas-based library
 * wouldn't give us for free.
 */
export function DailyViewsChart({ data }: { data: DailyViewsPoint[] }) {
  const [hovered, setHovered] = React.useState<number | null>(null);

  const max = Math.max(1, ...data.map((point) => point.views));
  const total = data.reduce((sum, point) => sum + point.views, 0);

  if (data.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        This campaign has no period to chart.
      </p>
    );
  }

  const width = 100;
  const height = 32;
  const gap = data.length > 60 ? 0.15 : 0.6;
  const slot = width / data.length;
  const barWidth = Math.max(0.4, slot - gap);
  const active = hovered !== null ? data[hovered] : null;

  return (
    <figure className="m-0">
      <figcaption className="sr-only">
        New views per day across the campaign period
      </figcaption>

      <div className="flex items-baseline justify-between text-sm">
        <span className="text-muted-foreground">
          {active ? formatDayLabel(active.day) : "Peak day"}
        </span>
        <span className="font-medium tabular-nums">
          {formatNumber(active ? active.views : max)} views
        </span>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="presentation"
        className="mt-2 h-40 w-full overflow-visible"
        onMouseLeave={() => setHovered(null)}
      >
        <line
          x1="0"
          y1={height}
          x2={width}
          y2={height}
          stroke="currentColor"
          strokeWidth="0.15"
          className="text-border"
          vectorEffect="non-scaling-stroke"
        />
        {data.map((point, index) => {
          const barHeight = point.views === 0 ? 0 : Math.max(0.4, (point.views / max) * height);
          return (
            <rect
              key={point.day}
              x={index * slot + (slot - barWidth) / 2}
              y={height - barHeight}
              width={barWidth}
              height={barHeight}
              rx={barWidth > 1 ? 0.3 : 0}
              className={
                hovered === index ? "fill-foreground" : "fill-chart-1 transition-colors"
              }
              onMouseEnter={() => setHovered(index)}
            />
          );
        })}
      </svg>

      <div className="mt-2 flex justify-between text-xs text-muted-foreground">
        <span>{formatDayLabel(data[0]!.day)}</span>
        <span>{formatCompactNumber(total)} views total</span>
        <span>{formatDayLabel(data[data.length - 1]!.day)}</span>
      </div>

      <details className="mt-3">
        <summary className="cursor-pointer text-xs text-muted-foreground">
          View as table
        </summary>
        <div className="mt-2 max-h-64 overflow-y-auto rounded-md border">
          <table className="w-full text-sm">
            <caption className="sr-only">New views per day</caption>
            <thead className="sticky top-0 bg-card">
              <tr className="border-b">
                <th scope="col" className="px-3 py-2 text-left text-xs font-medium uppercase text-muted-foreground">
                  Day
                </th>
                <th scope="col" className="px-3 py-2 text-right text-xs font-medium uppercase text-muted-foreground">
                  New views
                </th>
              </tr>
            </thead>
            <tbody>
              {data.map((point) => (
                <tr key={point.day} className="border-b last:border-0">
                  <th scope="row" className="px-3 py-1.5 text-left font-normal">
                    {point.day}
                  </th>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {formatNumber(point.views)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
