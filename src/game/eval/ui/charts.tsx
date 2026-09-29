import type { CalibrationBin } from "../calibration";
import type { Interval } from "../stats";

/**
 * The evaluation page's charts: inline SVG, no library, each paired on the page
 * with a table holding the same numbers.
 *
 * Arms are rows, labelled in text, so identity never rests on color; per-arm
 * charts (reliability, latency) are small multiples of one series each. The
 * categorical slots are used only where lines share one plot (the latency
 * sweep), with a legend and direct end labels. The app is dark-only, so the
 * slots are the reference palette's dark steps; text wears text tokens, never
 * a series color. Hover titles give every mark's exact value and its n.
 */

export const VIZ = {
  series: ["#3987e5", "#d95926", "#199e70"] as const,
  grid: "#2c2c2a",
  axis: "#383835",
  muted: "#898781",
  surface: "var(--background)",
};

export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) {
    const pad = Math.abs(min) > 0 ? Math.abs(min) * 0.1 : 1;
    min -= pad;
    max += pad;
  }
  const raw = (max - min) / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? raw;
  // Round to the step's own precision, so 3 × 0.2 prints as 0.6.
  const decimals = Math.max(0, Math.ceil(-Math.log10(step)) + 1);
  // The ticks cover the range — the first at or below the minimum, the last at
  // or above the maximum — because the charts use them as the axis extent.
  const first = Math.floor(min / step + 1e-9);
  const last = Math.ceil(max / step - 1e-9);
  const ticks: number[] = [];
  for (let k = first; k <= last; k += 1) ticks.push(Number((k * step).toFixed(decimals)));
  return ticks;
}

/** A tick label at the precision of the tick step, so an axis reads 0, 1,000, 2,000. */
export function formatTick(value: number, ticks: readonly number[]): string {
  const step = ticks.length > 1 ? Math.abs(ticks[1]! - ticks[0]!) : 1;
  const decimals = step >= 1 ? 0 : Math.min(4, Math.ceil(-Math.log10(step) - 1e-9));
  return value.toLocaleString("en", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function formatValue(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "n/a";
  const abs = Math.abs(value);
  if (abs >= 1000) return value.toLocaleString("en", { maximumFractionDigits: 0 });
  // Three significant figures at most above 10: a seed-to-seed spread in the
  // hundreds makes a third decimal noise, not precision.
  if (abs >= 100) return value.toFixed(0);
  return value.toFixed(abs >= 10 ? Math.min(digits, 1) : digits);
}

export interface StripRow {
  id: string;
  label: string;
  /** Null when the arm has nothing to plot (pending, failed, no value). */
  values: { seed: number; runId: string; value: number }[];
  mean: number | null;
  ci: Interval | null;
  note: string | null;
}

/** Per-episode values per arm, with the mean and its interval. Nothing averaged away. */
export function StripPlot({
  rows,
  unit,
  title,
}: {
  rows: StripRow[];
  unit: string;
  title: string;
}) {
  const all = rows.flatMap((r) => [
    ...r.values.map((v) => v.value),
    ...(r.ci ? [r.ci.lo, r.ci.hi] : []),
  ]);
  if (all.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No arm has a value for this metric yet.
      </p>
    );
  }
  const hi = Math.max(...all);
  const min = Math.min(...all);
  // Anchor at zero when the values sit close enough to it that a cropped axis
  // would exaggerate the differences between arms.
  const lo = min > 0 && min < hi * 0.3 ? 0 : min;
  const ticks = niceTicks(lo, hi);
  const x0 = ticks[0] ?? lo;
  const x1 = ticks[ticks.length - 1] ?? hi;
  const left = 190;
  const width = 720;
  const rowH = 30;
  const top = 12;
  const height = top + rows.length * rowH + 28;
  const x = (v: number): number =>
    left + ((v - x0) / (x1 - x0 || 1)) * (width - left - 16);
  return (
    <svg
      role="img"
      aria-label={`${title}. Each dot is one episode; the vertical bar is the arm's mean and the horizontal line its 95% interval. The table below gives every value.`}
      viewBox={`0 0 ${width} ${height}`}
      className="w-full max-w-[60rem] text-[11px]"
    >
      {ticks.map((t) => (
        <g key={t}>
          <line
            x1={x(t)}
            x2={x(t)}
            y1={top - 4}
            y2={height - 24}
            stroke={VIZ.grid}
            strokeWidth={1}
          />
          <text x={x(t)} y={height - 8} textAnchor="middle" fill={VIZ.muted}>
            {formatTick(t, ticks)}
          </text>
        </g>
      ))}
      {rows.map((row, i) => {
        const cy = top + i * rowH + rowH / 2;
        return (
          <g key={row.id}>
            <text x={left - 10} y={cy + 4} textAnchor="end" className="fill-current">
              {row.label}
            </text>
            {row.values.length === 0 ? (
              <text x={left + 4} y={cy + 4} fill={VIZ.muted}>
                {row.note ?? "no value"}
              </text>
            ) : null}
            {row.ci ? (
              <line
                x1={x(row.ci.lo)}
                x2={x(row.ci.hi)}
                y1={cy}
                y2={cy}
                stroke="currentColor"
                strokeOpacity={0.6}
                strokeWidth={2}
                strokeLinecap="round"
              >
                <title>{`${row.label}: 95% interval ${formatValue(row.ci.lo)} to ${formatValue(row.ci.hi)} ${unit}`}</title>
              </line>
            ) : null}
            {row.values.map((v) => (
              <circle
                key={v.runId}
                cx={x(v.value)}
                cy={cy}
                r={4.5}
                fill={VIZ.series[0]}
                stroke={VIZ.surface}
                strokeWidth={2}
              >
                <title>{`${row.label} · seed ${v.seed} · ${formatValue(v.value, 3)} ${unit} · run ${v.runId}`}</title>
              </circle>
            ))}
            {row.mean !== null ? (
              <line
                x1={x(row.mean)}
                x2={x(row.mean)}
                y1={cy - 9}
                y2={cy + 9}
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
              >
                <title>{`${row.label}: mean ${formatValue(row.mean, 3)} ${unit} over ${row.values.length} episodes`}</title>
              </line>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

/**
 * Reliability diagram: stated confidence against how often the declared
 * success criterion held. Hollow points are bins under n = 30.
 */
export function ReliabilityDiagram({
  bins,
  label,
}: {
  bins: CalibrationBin[];
  label: string;
}) {
  const size = 220;
  const pad = 30;
  const s = (v: number): number => pad + v * (size - pad - 8);
  const y = (v: number): number => size - pad - v * (size - pad - 8);
  return (
    <svg
      role="img"
      aria-label={`Reliability diagram for ${label}: mean stated confidence per bin on the horizontal axis, share of decisions meeting the success rule on the vertical axis, 95% Wilson intervals as whiskers. The diagonal is perfect calibration. The table beside it gives every bin.`}
      viewBox={`0 0 ${size} ${size}`}
      className="w-full max-w-[16rem] text-[10px]"
    >
      {[0, 0.25, 0.5, 0.75, 1].map((t) => (
        <g key={t}>
          <line x1={s(t)} x2={s(t)} y1={y(0)} y2={y(1)} stroke={VIZ.grid} />
          <line x1={s(0)} x2={s(1)} y1={y(t)} y2={y(t)} stroke={VIZ.grid} />
          <text x={s(t)} y={size - 12} textAnchor="middle" fill={VIZ.muted}>
            {t}
          </text>
          <text x={pad - 6} y={y(t) + 3} textAnchor="end" fill={VIZ.muted}>
            {t}
          </text>
        </g>
      ))}
      <line x1={s(0)} y1={y(0)} x2={s(1)} y2={y(1)} stroke={VIZ.axis} strokeWidth={1} />
      {bins
        .filter((b) => b.n > 0 && b.meanPredicted !== null && b.empirical !== null)
        .map((b) => (
          <g key={b.label}>
            {b.interval ? (
              <line
                x1={s(b.meanPredicted!)}
                x2={s(b.meanPredicted!)}
                y1={y(b.interval.lo)}
                y2={y(b.interval.hi)}
                stroke={VIZ.series[0]}
                strokeWidth={2}
                strokeLinecap="round"
              />
            ) : null}
            <circle
              cx={s(b.meanPredicted!)}
              cy={y(b.empirical!)}
              r={4.5}
              fill={b.sufficient ? VIZ.series[0] : VIZ.surface}
              stroke={b.sufficient ? VIZ.surface : VIZ.series[0]}
              strokeWidth={2}
            >
              <title>{`bin ${b.label}: n=${b.n}, mean stated ${formatValue(b.meanPredicted, 3)}, empirical ${formatValue(b.empirical, 3)}${b.interval ? ` [${formatValue(b.interval.lo, 3)}, ${formatValue(b.interval.hi, 3)}]` : ""}${b.sufficient ? "" : " (n < 30)"}`}</title>
            </circle>
          </g>
        ))}
    </svg>
  );
}

/** Round-trip latency of answered decisions, one bar per fixed bin. */
export function LatencyHistogram({
  edgesMs,
  counts,
  label,
}: {
  edgesMs: number[];
  counts: number[];
  label: string;
}) {
  const first = counts.findIndex((c) => c > 0);
  const last = counts.length - 1 - [...counts].reverse().findIndex((c) => c > 0);
  if (first < 0)
    return <p className="text-muted-foreground text-xs">No answered decisions.</p>;
  const shown = counts.slice(first, last + 1);
  const width = 320;
  const height = 120;
  const band = (width - 20) / shown.length;
  const bar = Math.min(24, band - 2);
  const max = Math.max(...shown);
  const edge = (i: number): string => {
    const e = edgesMs[i]!;
    return e >= 1000 ? `${e / 1000}s` : `${e}`;
  };
  return (
    <svg
      role="img"
      aria-label={`Latency distribution for ${label}: answered decisions per round-trip bin, in milliseconds.`}
      viewBox={`0 0 ${width} ${height}`}
      className="w-full max-w-[20rem] text-[9px]"
    >
      <line x1={10} x2={width - 10} y1={height - 22} y2={height - 22} stroke={VIZ.axis} />
      {shown.map((count, j) => {
        const i = first + j;
        const h = max > 0 ? (count / max) * (height - 34) : 0;
        const cx = 10 + band * j + band / 2;
        const upper = i + 1 < edgesMs.length ? `${edgesMs[i + 1]} ms` : "and above";
        return (
          <g key={i}>
            {count > 0 ? (
              <path
                d={`M${cx - bar / 2},${height - 22} v${-Math.max(0, h - 4)} q0,-4 4,-4 h${bar - 8} q4,0 4,4 v${Math.max(0, h - 4)} z`}
                fill={VIZ.series[0]}
              >
                <title>{`${edgesMs[i]} ms to ${upper}: ${count} decisions`}</title>
              </path>
            ) : null}
            {j % Math.ceil(shown.length / 6) === 0 ? (
              <text x={cx} y={height - 8} textAnchor="middle" fill={VIZ.muted}>
                {edge(i)}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

export interface SweepSeries {
  id: string;
  points: {
    value: number;
    mean: number | null;
    lo: number | null;
    hi: number | null;
    n: number;
  }[];
}

/** Outcome against injected latency, one line per base arm, with 95% interval bands. */
export function SweepChart({
  series,
  metric,
  unit,
}: {
  series: SweepSeries[];
  metric: string;
  unit: string;
}) {
  const width = 640;
  const height = 260;
  const left = 56;
  const right = 110;
  const top = 14;
  const bottom = 36;
  const xs = series.flatMap((s) => s.points.map((p) => p.value));
  const ys = series.flatMap((s) =>
    s.points.flatMap((p) => [p.mean, p.lo, p.hi].filter((v): v is number => v !== null)),
  );
  if (ys.length === 0)
    return <p className="text-muted-foreground text-sm">No sweep point has a value.</p>;
  const xt = niceTicks(Math.min(...xs), Math.max(...xs), 6);
  const yt = niceTicks(Math.min(0, ...ys), Math.max(...ys), 5);
  const X0 = xt[0]!;
  const X1 = xt[xt.length - 1]!;
  const Y0 = yt[0]!;
  const Y1 = yt[yt.length - 1]!;
  const x = (v: number): number =>
    left + ((v - X0) / (X1 - X0 || 1)) * (width - left - right);
  const y = (v: number): number =>
    height - bottom - ((v - Y0) / (Y1 - Y0 || 1)) * (height - top - bottom);
  return (
    <svg
      role="img"
      aria-label={`${metric} against injected answer latency, per policy, with 95% interval bands. The table below gives every point.`}
      viewBox={`0 0 ${width} ${height}`}
      className="w-full max-w-[48rem] text-[11px]"
    >
      {yt.map((t) => (
        <g key={`y${t}`}>
          <line x1={left} x2={width - right} y1={y(t)} y2={y(t)} stroke={VIZ.grid} />
          <text x={left - 8} y={y(t) + 4} textAnchor="end" fill={VIZ.muted}>
            {formatTick(t, yt)}
          </text>
        </g>
      ))}
      {xt.map((t) => (
        <text
          key={`x${t}`}
          x={x(t)}
          y={height - bottom + 16}
          textAnchor="middle"
          fill={VIZ.muted}
        >
          {t}
        </text>
      ))}
      <text
        x={(left + width - right) / 2}
        y={height - 4}
        textAnchor="middle"
        fill={VIZ.muted}
      >
        injected answer latency, ms
      </text>
      <line x1={left} x2={width - right} y1={y(Y0)} y2={y(Y0)} stroke={VIZ.axis} />
      {series.map((s, k) => {
        const color = VIZ.series[k % VIZ.series.length]!;
        const pts = s.points.filter((p) => p.mean !== null);
        const band = pts.filter((p) => p.lo !== null && p.hi !== null);
        const lastPoint = pts[pts.length - 1];
        return (
          <g key={s.id}>
            {band.length >= 2 ? (
              <path
                d={`M${band.map((p) => `${x(p.value)},${y(p.hi!)}`).join("L")}L${[...band]
                  .reverse()
                  .map((p) => `${x(p.value)},${y(p.lo!)}`)
                  .join("L")}Z`}
                fill={color}
                fillOpacity={0.1}
              />
            ) : null}
            <path
              d={`M${pts.map((p) => `${x(p.value)},${y(p.mean!)}`).join("L")}`}
              fill="none"
              stroke={color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {pts.map((p) => (
              <circle
                key={p.value}
                cx={x(p.value)}
                cy={y(p.mean!)}
                r={4.5}
                fill={color}
                stroke={VIZ.surface}
                strokeWidth={2}
              >
                <title>{`${s.id} at ${p.value} ms: ${formatValue(p.mean, 3)} ${unit}${p.lo !== null ? ` [${formatValue(p.lo, 3)}, ${formatValue(p.hi, 3)}]` : ""}, n=${p.n}`}</title>
              </circle>
            ))}
            {lastPoint ? (
              <text
                x={x(lastPoint.value) + 10}
                y={y(lastPoint.mean!) + 4}
                className="fill-current"
              >
                {s.id}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

/** A small legend: a swatch beside plain text, for charts with two or more series. */
export function Legend({ items }: { items: string[] }) {
  return (
    <ul className="flex flex-wrap gap-4 text-xs" aria-label="Legend">
      {items.map((item, k) => (
        <li key={item} className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="inline-block h-0.5 w-5"
            style={{ background: VIZ.series[k % VIZ.series.length] }}
          />
          {item}
        </li>
      ))}
    </ul>
  );
}
