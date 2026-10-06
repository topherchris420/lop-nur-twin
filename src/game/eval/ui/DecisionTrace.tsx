import { useMemo, useState } from "react";
import { AXES } from "../../pilot/contract";
import type { DecisionTypeContract } from "../outcomeContracts";
import {
  EPISODE_DECISIONS_SCHEMA,
  type AxisConfidence,
  type DecisionRecord,
  type FailureRecord,
} from "../records";
import { VIZ, formatValue } from "./charts";
import { ScrollRegion } from "./ScrollRegion";

/**
 * One episode's decisions, row by row: what was chosen, with what stated
 * confidence, how late, whether it was still legal, what software did with
 * it, what the world did, and how the declared contract classed it. Loaded
 * from the episode's `*.eval.json` (or the archived `.gz`), in the browser,
 * from a file the user chooses — nothing is fetched.
 */

export const MAX_RECORDS_BYTES = 64 * 1024 * 1024;

export interface EpisodeRecords {
  episodeId: string;
  brain: { id: string; provider: string } | null;
  decisions: DecisionRecord[];
  failures: FailureRecord[];
}

export async function readRecordsFile(file: File): Promise<EpisodeRecords> {
  if (file.size > MAX_RECORDS_BYTES) throw new Error(`${file.name} is larger than 64 MB`);
  const text = file.name.endsWith(".gz")
    ? await new Response(
        file.stream().pipeThrough(new DecompressionStream("gzip")),
      ).text()
    : await file.text();
  const value = JSON.parse(text) as Partial<EpisodeRecords> & { schema?: unknown };
  // Archived episodes predate the schema id; anything that names one must
  // name this one.
  if (value.schema !== undefined && value.schema !== EPISODE_DECISIONS_SCHEMA) {
    throw new Error(
      `unsupported decision-records schema: ${String(value.schema).slice(0, 60)}`,
    );
  }
  if (!Array.isArray(value.decisions) || !Array.isArray(value.failures)) {
    throw new Error(
      "not an episode's decision records (expected decisions and failures)",
    );
  }
  return {
    episodeId: String(value.episodeId ?? "unknown"),
    brain: value.brain ?? null,
    decisions: value.decisions,
    failures: value.failures,
  };
}

function exposure(r: DecisionRecord): number | null {
  return r.outcome && r.outcome.exposureSamples > 0
    ? r.outcome.exposedSamples / r.outcome.exposureSamples
    : null;
}

/** What changed from the previous executed frame, so a row says what was decided. */
function changedAxes(r: DecisionRecord, previous: DecisionRecord | null): string {
  const parts = AXES.filter(
    (axis) =>
      (r.legal[axis] as readonly string[]).length >= 2 &&
      (!previous || previous.frame[axis] !== r.frame[axis]),
  ).map((axis) => `${axis}=${r.frame[axis]}`);
  return parts.length > 0 ? parts.join(" ") : "(no change)";
}

function ExposureTimeline({
  records,
  contract,
}: {
  records: DecisionRecord[];
  contract: DecisionTypeContract | null;
}) {
  const points = records
    .filter((r) => r.execution.actionStart !== null && exposure(r) !== null)
    .map((r) => ({ t: r.execution.actionStart!, e: exposure(r)!, r }));
  if (points.length < 2) return null;
  const t0 = points[0]!.t;
  const t1 = points[points.length - 1]!.t;
  const width = 720;
  const height = 140;
  const left = 40;
  const x = (t: number): number =>
    left + ((t - t0) / (t1 - t0 || 1)) * (width - left - 10);
  const y = (e: number): number => height - 24 - e * (height - 40);
  return (
    <svg
      role="img"
      aria-label="Exposure in the outcome window after each executed decision, against simulation time. Filled points are decisions the experiment's contract selected. The table below lists every decision."
      viewBox={`0 0 ${width} ${height}`}
      className="w-full max-w-[60rem] text-[10px]"
    >
      {[0, 0.5, 1].map((v) => (
        <g key={v}>
          <line x1={left} x2={width - 10} y1={y(v)} y2={y(v)} stroke={VIZ.grid} />
          <text x={left - 6} y={y(v) + 3} textAnchor="end" fill={VIZ.muted}>
            {v}
          </text>
        </g>
      ))}
      <text x={width / 2} y={height - 4} textAnchor="middle" fill={VIZ.muted}>
        simulation time, s ({formatValue(t0, 0)}–{formatValue(t1, 0)})
      </text>
      <path
        d={`M${points.map((p) => `${x(p.t)},${y(p.e)}`).join("L")}`}
        fill="none"
        stroke={VIZ.series[0]}
        strokeOpacity={0.5}
        strokeWidth={1.5}
      />
      {points
        .filter((p) => contract?.matches(p.r))
        .map((p) => (
          <circle
            key={p.r.sequence}
            cx={x(p.t)}
            cy={y(p.e)}
            r={4}
            fill={VIZ.series[0]}
            stroke={VIZ.surface}
            strokeWidth={2}
          >
            <title>{`#${p.r.sequence} at ${formatValue(p.t, 1)} s: exposure ${formatValue(p.e, 2)}, ${contract?.classify(p.r) ?? "unscored"}`}</title>
          </circle>
        ))}
    </svg>
  );
}

/** The confidence cell, one label per figure, "none" when nothing was reported. */
function describeConfidence(
  source: DecisionRecord["confidence"]["source"],
  conf: AxisConfidence | undefined,
): string {
  if (source === "none" || conf === undefined) return "none";
  const parts: string[] = [];
  if (conf.probability !== null) parts.push(`p ${formatValue(conf.probability, 2)}`);
  if (conf.confidence !== null) {
    parts.push(
      `${source === "verbalized" ? "said" : "conf"} ${formatValue(conf.confidence, 2)}`,
    );
  }
  return parts.length === 0 ? "none reported" : parts.join(" · ");
}

export function DecisionTrace({
  records,
  contract,
}: {
  records: EpisodeRecords;
  contract: DecisionTypeContract | null;
}) {
  const [onlyMatched, setOnlyMatched] = useState(contract !== null);
  const sorted = useMemo(
    () => [...records.decisions].sort((a, b) => a.sequence - b.sequence),
    [records],
  );
  const rows = useMemo(() => {
    let previous: DecisionRecord | null = null;
    return sorted.map((r) => {
      const row = { r, changed: changedAxes(r, previous) };
      if (
        r.validation.status === "executed" ||
        r.validation.status === "executed_illegal"
      )
        previous = r;
      return row;
    });
  }, [sorted]);
  const shown = rows
    .filter((row) => !onlyMatched || !contract || contract.matches(row.r))
    .slice(0, 2000);
  const axis = contract?.calibrationAxis ?? null;
  return (
    <div className="mt-4">
      <p className="text-muted-foreground text-xs">
        Episode <span className="font-mono">{records.episodeId}</span> · brain{" "}
        <span className="font-mono">{records.brain?.id ?? "unknown"}</span> ·{" "}
        {records.decisions.length} decisions, {records.failures.length} failed requests
      </p>
      <ExposureTimeline records={sorted} contract={contract} />
      {contract ? (
        <label className="mt-2 flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={onlyMatched}
            onChange={(e) => setOnlyMatched(e.target.checked)}
          />
          Only decisions {contract.id} selects
        </label>
      ) : null}
      <ScrollRegion label="Decision trace" className="mt-2 max-h-[32rem] overflow-auto">
        <table className="w-full min-w-[70rem] border-collapse text-left text-[11px]">
          <caption className="text-muted-foreground pb-2 text-left text-xs">
            Decisions in sequence order
            {shown.length === 2000 ? " (first 2,000 shown)" : ""}. Confidence is on the
            contract&rsquo;s axis, as the brain stated it; &ldquo;none&rdquo; means it
            stated nothing.
          </caption>
          <thead>
            <tr className="border-border border-b">
              {[
                "#",
                "t (s)",
                "chose",
                "confidence",
                "latency",
                "age at exec",
                "validation",
                "world changed",
                "execution",
                "outcome window",
                "class",
              ].map((h) => (
                <th
                  key={h}
                  scope="col"
                  className="px-2 py-1.5 font-semibold whitespace-nowrap"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="font-mono">
            {shown.map(({ r, changed }) => {
              const conf = axis ? r.confidence.perAxis[axis] : undefined;
              const o = r.outcome;
              return (
                <tr key={r.sequence} className="border-border border-b align-top">
                  <th scope="row" className="px-2 py-1 font-medium">
                    {r.sequence}
                  </th>
                  <td className="px-2 py-1">
                    {formatValue(r.execution.actionStart ?? r.acceptedAtSim, 1)}
                  </td>
                  <td className="max-w-[18rem] px-2 py-1 break-words">{changed}</td>
                  <td className="px-2 py-1">
                    {/* Each figure under its own name: a probability is "p", a
                        provider's confidence figure is "conf", and a model's
                        own stated confidence is "said". A confidence is never
                        printed as a probability. */}
                    {describeConfidence(r.confidence.source, conf)}
                  </td>
                  <td className="px-2 py-1">
                    {formatValue(r.accounting.wallLatencyMs, 0)} ms
                  </td>
                  <td className="px-2 py-1">
                    {r.validation.ageAtExecutionMs === null
                      ? "—"
                      : `${r.validation.ageAtExecutionMs} ms`}
                  </td>
                  <td className="px-2 py-1">
                    {r.validation.status}
                    {r.validation.illegalAtExecution.length > 0
                      ? ` (${r.validation.illegalAtExecution.join(",")})`
                      : ""}
                  </td>
                  <td className="px-2 py-1">
                    {r.validation.worldChanged.join(", ") || "—"}
                  </td>
                  <td className="px-2 py-1">
                    {r.execution.targetBound === null
                      ? ""
                      : `target ${r.execution.targetBound ? "bound" : "unbound"} `}
                    {r.execution.placeBound === null
                      ? ""
                      : `place ${r.execution.placeKind ?? (r.execution.placeBound ? "bound" : "unbound")} `}
                    {r.execution.endReason ?? ""}
                  </td>
                  <td className="px-2 py-1">
                    {o
                      ? `${o.complete ? "" : "incomplete · "}dealt ${formatValue(o.damageDealt, 0)} · took ${formatValue(o.damageTaken, 0)} · exposed ${formatValue(exposure(r), 2)}${o.died ? " · died" : ""}${o.target?.killed ? " · target eliminated" : ""}${o.place?.reached ? " · reached" : ""}`
                      : "not executed"}
                  </td>
                  <td className="px-2 py-1">
                    {contract?.matches(r) ? (contract.classify(r) ?? "unscored") : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </ScrollRegion>
    </div>
  );
}
