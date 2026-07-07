"use client";

import { formatNumber } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Pure-SVG chart primitives (no chart libraries). Colors flow through
 * currentColor inside token wrappers (text-primary / text-muted-foreground /
 * text-border), so light and dark themes work automatically — no hex, no
 * gradients. Every chart renders an aria-hidden svg plus a visually-hidden
 * textual summary. The app is RTL and SVG coordinates are not, so category
 * order is mirrored manually: the FIRST datum renders at the right edge.
 */

/** `value: null` = pending (e.g. ungraded exam) — drawn as a muted "—". */
type Datum = { label: string; value: number | null };
type LineDatum = { label: string; value: number };
type PairedDatum = { label: string; a: number; b: number };

function truncateLabel(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

/** How many label characters a category slot fits (≈6 units/char at 10px). */
function labelCharsFor(slotW: number): number {
  return Math.max(3, Math.min(12, Math.floor(slotW / 6)));
}

/**
 * Column with a rounded data-end and a square baseline (the cap radius never
 * exceeds half the bar, so stubs stay well-formed).
 */
function columnPath(
  centerX: number,
  barW: number,
  baseline: number,
  h: number,
): string {
  const x0 = centerX - barW / 2;
  const x1 = centerX + barW / 2;
  const top = baseline - h;
  const r = Math.min(3, barW / 2, h);
  return [
    `M${x0.toFixed(2)} ${baseline.toFixed(2)}`,
    `L${x0.toFixed(2)} ${(top + r).toFixed(2)}`,
    `A${r.toFixed(2)} ${r.toFixed(2)} 0 0 1 ${(x0 + r).toFixed(2)} ${top.toFixed(2)}`,
    `L${(x1 - r).toFixed(2)} ${top.toFixed(2)}`,
    `A${r.toFixed(2)} ${r.toFixed(2)} 0 0 1 ${x1.toFixed(2)} ${(top + r).toFixed(2)}`,
    `L${x1.toFixed(2)} ${baseline.toFixed(2)}`,
    "Z",
  ].join(" ");
}

/** Chart scale: the given max, or the data's max (≥1 so zeros still plot). */
function scaleOf(max: number | undefined, values: Array<number>): number {
  return max !== undefined && max > 0 ? max : Math.max(1, ...values);
}

/** Bar height in plot units; non-zero values keep a visible 2-unit stub. */
function barHeight(value: number, scale: number, innerH: number): number {
  const h = Math.max(0, Math.min(1, value / scale)) * innerH;
  return value > 0 ? Math.max(h, 2) : 0;
}

// ——— BarChart: vertical bars with value labels ———

export function BarChart({
  data,
  max,
  unit = "",
  className,
}: {
  data: Array<Datum>;
  /** Fixed scale top (e.g. 100 for percentages); defaults to the data max. */
  max?: number;
  /** Suffix appended to value labels (e.g. "%"). */
  unit?: string;
  className?: string;
}) {
  if (data.length === 0) return null;
  const width = 320;
  const height = 150;
  const padTop = 16;
  const padBottom = 18;
  const padX = 4;
  const innerW = width - padX * 2;
  const innerH = height - padTop - padBottom;
  const baseline = height - padBottom;
  const slotW = innerW / data.length;
  const barW = Math.min(24, slotW * 0.55);
  const maxChars = labelCharsFor(slotW);
  const scale = scaleOf(
    max,
    data.map((d) => d.value ?? 0),
  );
  return (
    <figure className={cn("w-full", className)}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full"
        aria-hidden
      >
        <line
          x1={padX}
          x2={width - padX}
          y1={baseline}
          y2={baseline}
          className="text-border"
          stroke="currentColor"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
        {data.map((d, i) => {
          // RTL: first category sits at the inline start (right edge).
          const cx = width - padX - (i + 0.5) * slotW;
          const h = d.value === null ? 0 : barHeight(d.value, scale, innerH);
          return (
            <g key={`${d.label}-${i}`}>
              {h > 0 ? (
                <path
                  d={columnPath(cx, barW, baseline, h)}
                  className="text-primary"
                  fill="currentColor"
                />
              ) : null}
              <text
                x={cx}
                y={baseline - h - 4}
                textAnchor="middle"
                fontSize="10"
                className={
                  d.value === null
                    ? "text-muted-foreground"
                    : "text-foreground tabular-nums"
                }
                fill="currentColor"
              >
                {d.value === null ? "—" : `${formatNumber(d.value)}${unit}`}
              </text>
              <text
                x={cx}
                y={baseline + 12}
                textAnchor="middle"
                fontSize="10"
                className="text-muted-foreground"
                fill="currentColor"
              >
                {truncateLabel(d.label, maxChars)}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption className="sr-only">
        {data
          .map(
            (d) =>
              `${d.label}: ${
                d.value === null ? "—" : `${formatNumber(d.value)}${unit}`
              }`,
          )
          .join("، ")}
      </figcaption>
    </figure>
  );
}

// ——— Sparkline: polyline with an area fill ———

export function Sparkline({
  data,
  max,
  className,
}: {
  data: Array<LineDatum>;
  max?: number;
  className?: string;
}) {
  if (data.length < 2) return null;
  const width = 320;
  const height = 96;
  const pad = 8;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const scale = scaleOf(
    max,
    data.map((d) => d.value),
  );
  // RTL: oldest point at the right edge, newest leftward.
  const points = data.map((d, i) => ({
    x: width - pad - (i * innerW) / (data.length - 1),
    y: height - pad - Math.max(0, Math.min(1, d.value / scale)) * innerH,
  }));
  const line = points.map((p) => `${p.x},${p.y}`).join(" ");
  const area = `${points[0].x},${height - pad} ${line} ${
    points[points.length - 1].x
  },${height - pad}`;
  const last = points[points.length - 1];
  return (
    <figure className={cn("w-full", className)}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full text-primary"
        aria-hidden
      >
        <polygon points={area} fill="currentColor" opacity="0.12" />
        <polyline
          points={line}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        {/* Newest point: filled dot with a surface ring for legibility. */}
        <circle
          cx={last.x}
          cy={last.y}
          r="4"
          fill="currentColor"
          strokeWidth="2"
          className="stroke-card"
        />
      </svg>
      <figcaption className="sr-only">
        {data.map((d) => `${d.label}: ${formatNumber(d.value)}`).join("، ")}
      </figcaption>
    </figure>
  );
}

// ——— PairedBars: two series side by side, with a legend ———

export function PairedBars({
  data,
  aLabel,
  bLabel,
  max,
  unit = "",
  className,
}: {
  data: Array<PairedDatum>;
  /** Legend label of series `a` (rendered in primary). */
  aLabel: string;
  /** Legend label of series `b` (rendered in muted-foreground). */
  bLabel: string;
  max?: number;
  unit?: string;
  className?: string;
}) {
  if (data.length === 0) return null;
  const width = 320;
  const height = 160;
  const padTop = 16;
  const padBottom = 18;
  const padX = 4;
  const innerW = width - padX * 2;
  const innerH = height - padTop - padBottom;
  const baseline = height - padBottom;
  const slotW = innerW / data.length;
  const barW = Math.min(22, slotW * 0.28);
  const pairGap = 3;
  const maxChars = labelCharsFor(slotW);
  const scale = scaleOf(
    max,
    data.flatMap((d) => [d.a, d.b]),
  );
  return (
    <figure className={cn("flex w-full flex-col gap-2", className)}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-full bg-primary" />
          {aLabel}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className="size-2.5 rounded-full bg-muted-foreground"
          />
          {bLabel}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full"
        aria-hidden
      >
        <line
          x1={padX}
          x2={width - padX}
          y1={baseline}
          y2={baseline}
          className="text-border"
          stroke="currentColor"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
        {data.map((d, i) => {
          const cx = width - padX - (i + 0.5) * slotW;
          const ha = barHeight(d.a, scale, innerH);
          const hb = barHeight(d.b, scale, innerH);
          // Series a takes the inline-start half of the pair (right in RTL).
          const aX = cx + pairGap / 2;
          const bX = cx - pairGap / 2 - barW;
          return (
            <g key={`${d.label}-${i}`}>
              {ha > 0 ? (
                <path
                  d={columnPath(aX + barW / 2, barW, baseline, ha)}
                  className="text-primary"
                  fill="currentColor"
                />
              ) : null}
              <text
                x={aX + barW / 2}
                y={baseline - ha - 4}
                textAnchor="middle"
                fontSize="9"
                className="text-foreground tabular-nums"
                fill="currentColor"
              >
                {formatNumber(d.a)}
                {unit}
              </text>
              {hb > 0 ? (
                <path
                  d={columnPath(bX + barW / 2, barW, baseline, hb)}
                  className="text-muted-foreground"
                  fill="currentColor"
                />
              ) : null}
              <text
                x={bX + barW / 2}
                y={baseline - hb - 4}
                textAnchor="middle"
                fontSize="9"
                className="text-muted-foreground tabular-nums"
                fill="currentColor"
              >
                {formatNumber(d.b)}
                {unit}
              </text>
              <text
                x={cx}
                y={baseline + 12}
                textAnchor="middle"
                fontSize="9"
                className="text-muted-foreground"
                fill="currentColor"
              >
                {truncateLabel(d.label, maxChars)}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption className="sr-only">
        {data
          .map(
            (d) =>
              `${d.label}: ${aLabel} ${formatNumber(d.a)}${unit}، ${bLabel} ${formatNumber(d.b)}${unit}`,
          )
          .join("؛ ")}
      </figcaption>
    </figure>
  );
}
