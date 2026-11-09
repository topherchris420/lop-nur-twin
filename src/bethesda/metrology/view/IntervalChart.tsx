/**
 * Paired-difference intervals against the zone a protocol treats as too small
 * to matter (±δ), one row per comparison. Plain positioned HTML so it stays
 * crisp and legible at phone width; every chart comes with its table.
 */
import { useId } from "react";

export interface IntervalRow {
  key: string;
  label: string;
  /** Second line under the label: which contrast, so identity never rests on colour. */
  detail?: string;
  /** A verdict worth reading without hovering, shown in words beside the label. */
  note?: string;
  series: 0 | 1;
  mean: number;
  low: number;
  high: number;
  level: number;
  verdict: string;
}

/** Categorical slots 1 and 2 of the data-viz palette, stepped for the dark surface. */
export const SERIES = ["#3987e5", "#d95926"] as const;

export const fmt = (x: number | null | undefined, d = 3) =>
  x === null || x === undefined || !Number.isFinite(x) ? "n/a" : x.toFixed(d);

function ticks(lo: number, hi: number): number[] {
  const span = hi - lo;
  const raw = span / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-12; v += step)
    out.push(Number(v.toFixed(10)));
  return out;
}

export function IntervalChart({
  rows,
  mme,
  unit,
  legend,
  caption,
}: {
  rows: IntervalRow[];
  mme: number;
  unit: string;
  legend: { series: 0 | 1; label: string }[];
  caption: string;
}) {
  const id = useId();
  const lo0 = Math.min(-mme, ...rows.map((r) => r.low));
  const hi0 = Math.max(mme, ...rows.map((r) => r.high));
  const pad = (hi0 - lo0) * 0.08 || mme;
  const lo = lo0 - pad,
    hi = hi0 + pad;
  const x = (v: number) => `${(((v - lo) / (hi - lo)) * 100).toFixed(3)}%`;
  const w = (a: number, b: number) => `${(((b - a) / (hi - lo)) * 100).toFixed(3)}%`;
  return (
    <figure className="mt-3">
      <ul
        className="text-muted-foreground mb-2 flex flex-wrap gap-x-5 gap-y-1 text-xs"
        aria-hidden="true"
      >
        {legend.map((l) => (
          <li key={l.label} className="flex items-center gap-2">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: SERIES[l.series] }}
            />
            {l.label}
          </li>
        ))}
        <li className="flex items-center gap-2">
          <span className="bg-foreground/10 inline-block h-3 w-4 rounded-sm" />
          ±δ = ±{mme} {unit}: too small to matter
        </li>
      </ul>
      <div
        role="img"
        aria-labelledby={`${id}-cap`}
        className="border-border rounded-md border p-3"
      >
        {rows.map((r) => (
          <div
            key={r.key}
            className="grid grid-cols-1 gap-x-3 gap-y-1 py-1 sm:grid-cols-[minmax(8rem,16rem)_1fr] sm:items-center"
          >
            <div className="min-w-0 text-xs leading-tight">
              <div className="truncate" title={r.label}>
                {r.label}
                {r.note ? <span className="font-semibold"> · {r.note}</span> : null}
              </div>
              {r.detail ? (
                <div
                  className="text-muted-foreground truncate text-[11px]"
                  title={r.detail}
                >
                  {r.detail}
                </div>
              ) : null}
            </div>
            {/* Hover detail for pointers; keyboard and screen readers read the table below. */}
            <div className="group relative h-6">
              <div
                className="bg-foreground/10 absolute inset-y-0"
                style={{ left: x(-mme), width: w(-mme, mme) }}
              />
              <div
                className="bg-foreground/40 absolute inset-y-0 w-px"
                style={{ left: x(0) }}
              />
              <div
                className="absolute top-1/2 h-0.5 -translate-y-1/2 rounded-full"
                style={{
                  left: x(r.low),
                  width: w(r.low, r.high),
                  background: SERIES[r.series],
                }}
              />
              <div
                className="ring-background absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2"
                style={{ left: x(r.mean), background: SERIES[r.series] }}
              />
              <div
                className="bg-card border-border pointer-events-none absolute -top-9 z-10 hidden rounded border px-2 py-1 font-mono text-[11px] whitespace-nowrap shadow group-hover:block"
                style={{ left: x(r.mean) }}
              >
                {fmt(r.mean)} {unit} ({fmt(r.level * 100, 1)}% {fmt(r.low)} to{" "}
                {fmt(r.high)}) · {r.verdict}
              </div>
            </div>
          </div>
        ))}
        <div
          className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(8rem,16rem)_1fr]"
          aria-hidden="true"
        >
          <div className="hidden sm:block" />
          <div className="text-muted-foreground relative h-5 font-mono text-[10px]">
            {ticks(lo, hi).map((t) => (
              <span key={t} className="absolute -translate-x-1/2" style={{ left: x(t) }}>
                {t}
              </span>
            ))}
          </div>
        </div>
      </div>
      <figcaption id={`${id}-cap`} className="text-muted-foreground mt-2 text-xs">
        {caption}
      </figcaption>
      <details className="mt-2 text-xs">
        <summary className="cursor-pointer">Table of this chart</summary>
        <div className="overflow-x-auto">
          <table className="mt-2 w-full min-w-[36rem] border-collapse text-left">
            <thead>
              <tr className="border-border border-b">
                <th scope="col" className="px-2 py-1">
                  comparison
                </th>
                <th scope="col" className="px-2 py-1 text-right">
                  mean ({unit})
                </th>
                <th scope="col" className="px-2 py-1">
                  interval
                </th>
                <th scope="col" className="px-2 py-1">
                  verdict
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-border border-b">
                  <th scope="row" className="px-2 py-1 font-normal">
                    {r.label}
                    {r.detail ? ` ${r.detail}` : ""}
                  </th>
                  <td className="px-2 py-1 text-right font-mono tabular-nums">
                    {fmt(r.mean)}
                  </td>
                  <td className="px-2 py-1 font-mono tabular-nums">
                    {fmt(r.level * 100, 1)}% {fmt(r.low)} to {fmt(r.high)}
                  </td>
                  <td className="px-2 py-1 font-mono">{r.verdict}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
