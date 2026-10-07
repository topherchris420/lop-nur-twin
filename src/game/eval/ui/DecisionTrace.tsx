import { useEffect, useId, useMemo, useRef, useState } from "react";
import { AXES } from "../../pilot/contract";
import { readEpisodeRecords, type EpisodeRecords } from "../episodeRecords";
import type { DecisionTypeContract } from "../outcomeContracts";
import type { AxisConfidence, DecisionRecord } from "../records";
import { disjointWindows, overlapCounts, windowSpans } from "../windows";
import { VIZ, formatValue } from "./charts";
import { DecisionInspector, changedAxes } from "./DecisionInspector";
import { ScrollRegion } from "./ScrollRegion";

/**
 * One episode's decisions, row by row: what was chosen, with what stated
 * confidence, how late, whether it was still legal, what software did with
 * it, what the world did, and how the declared contract classed it. Loaded
 * from the episode's `*.eval.json` (or the archived `.gz`) — a file the user
 * chooses, or an archived episode the page fetches from this site — and
 * checked by `../episodeRecords.ts` before any of it is shown.
 *
 * Each row opens the decision inspector, which lays one decision out by the
 * record's own sections; previous and next step through the rows shown.
 *
 * Each row's outcome window overlaps its neighbours' (`../windows.ts`), and
 * the table says so row by row: how many other decisions share the window, and
 * a view that keeps only windows that share no time, so each event is counted
 * once.
 */

/** Read and check a file the user chose. The error names the file and the reason. */
export async function readRecordsFile(file: File): Promise<EpisodeRecords> {
  try {
    return await readEpisodeRecords(file.stream());
  } catch (error) {
    throw new Error(
      `${file.name} was not opened: ${error instanceof Error ? error.message : "it could not be read"}.`,
    );
  }
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function exposure(r: DecisionRecord): number | null {
  return r.outcome && r.outcome.exposureSamples > 0
    ? r.outcome.exposedSamples / r.outcome.exposureSamples
    : null;
}

/**
 * The whole choice, compactly: every axis that offered more than one option,
 * with those that changed from the previous executed frame marked in text as
 * well as weight.
 */
function ChoiceCell({
  r,
  previous,
}: {
  r: DecisionRecord;
  previous: DecisionRecord | null;
}) {
  const changed = changedAxes(r, previous);
  const axes = AXES.filter((axis) => (r.legal[axis] as readonly string[]).length >= 2);
  return (
    <ul className="flex flex-wrap gap-x-2">
      {axes.map((axis) =>
        changed.has(axis) ? (
          <li key={axis} className="font-semibold">
            <span aria-hidden="true">Δ </span>
            {axis}={r.frame[axis]}
            <span className="sr-only"> (changed)</span>
          </li>
        ) : (
          <li key={axis} className="text-muted-foreground">
            {axis}={r.frame[axis]}
          </li>
        ),
      )}
    </ul>
  );
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
      aria-label="Exposure in the outcome window after each executed decision, against simulation time. Neighbouring windows overlap, so neighbouring points share most of what they measure. Filled points are decisions the experiment's contract selected. The table below lists every decision."
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

/** The rows either side of `sequence` in `order`, whether or not it is one of them. */
function neighbours(
  order: readonly number[],
  sequence: number,
): { index: number | null; previous: number | null; next: number | null } {
  const index = order.indexOf(sequence);
  if (index >= 0) {
    return {
      index,
      previous: index > 0 ? order[index - 1]! : null,
      next: index < order.length - 1 ? order[index + 1]! : null,
    };
  }
  return {
    index: null,
    previous: order.filter((s) => s < sequence).at(-1) ?? null,
    next: order.find((s) => s > sequence) ?? null,
  };
}

export function DecisionTrace({
  records,
  contract,
}: {
  records: EpisodeRecords;
  contract: DecisionTypeContract | null;
}) {
  const id = useId();
  const inspectorId = `${id}-inspector`;
  const rowButtonId = (sequence: number): string => `${id}-row-${sequence}`;
  const [onlyMatched, setOnlyMatched] = useState(contract !== null);
  const [onlyDisjoint, setOnlyDisjoint] = useState(false);
  // Tied to the records it was chosen in, so opening another file closes it.
  const [selected, setSelected] = useState<{
    records: EpisodeRecords;
    sequence: number;
  } | null>(null);
  const selectedSequence = selected?.records === records ? selected.sequence : null;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const focusOnOpen = useRef(false);
  const sorted = useMemo(
    () => [...records.decisions].sort((a, b) => a.sequence - b.sequence),
    [records],
  );
  const rows = useMemo(() => {
    let previous: DecisionRecord | null = null;
    return sorted.map((r) => {
      const row = { r, previous };
      if (
        r.validation.status === "executed" ||
        r.validation.status === "executed_illegal"
      )
        previous = r;
      return row;
    });
  }, [sorted]);
  // Every executed decision's window, whatever the contract selects: an event
  // is shared with all of them.
  const spans = useMemo(() => windowSpans(sorted), [sorted]);
  const overlaps = useMemo(() => overlapCounts(spans), [spans]);
  const windowS = sorted.find((r) => r.outcome)?.outcome?.windowS ?? null;
  const spacing = median(spans.slice(1).map((s, i) => s.start - spans[i]!.start));
  const typicalOverlap = median([...overlaps.values()]);
  const filtered = useMemo(
    () => rows.filter((row) => !onlyMatched || !contract || contract.matches(row.r)),
    [rows, onlyMatched, contract],
  );
  const disjoint = useMemo(
    () => disjointWindows(windowSpans(filtered.map((row) => row.r))),
    [filtered],
  );
  const shown = filtered
    .filter((row) => !onlyDisjoint || disjoint.has(row.r.sequence))
    .slice(0, 2000);
  const axis = contract?.calibrationAxis ?? null;

  const open = (sequence: number, focus: boolean): void => {
    focusOnOpen.current = focus;
    setSelected({ records, sequence });
  };
  // Opening from the table moves focus to the inspector, so a keyboard user
  // lands on what they opened; stepping keeps focus on the step buttons.
  useEffect(() => {
    if (selectedSequence !== null && focusOnOpen.current) {
      focusOnOpen.current = false;
      headingRef.current?.focus();
    }
  }, [selectedSequence]);

  const selectedRow =
    selectedSequence === null
      ? null
      : (rows.find((row) => row.r.sequence === selectedSequence) ?? null);
  const step = selectedRow
    ? neighbours(
        shown.map((row) => row.r.sequence),
        selectedRow.r.sequence,
      )
    : null;

  return (
    <div className="mt-4">
      <h3 className="text-base font-semibold">Decision trace</h3>
      <p className="text-muted-foreground text-xs">
        Episode <span className="font-mono">{records.episodeId}</span> · brain{" "}
        <span className="font-mono">{records.brain?.id ?? "unknown"}</span>
        {records.stale ? (
          <>
            {" "}
            · stale policy <span className="font-mono">{records.stale}</span>
          </>
        ) : null}{" "}
        · {records.decisions.length} decisions, {records.failures.length} failed requests
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
      <label className="mt-1 flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={onlyDisjoint}
          onChange={(e) => setOnlyDisjoint(e.target.checked)}
        />
        Only windows that share no time ({disjoint.size} of {filtered.length}): each event
        counted once; kept by time alone, never by outcome
      </label>
      <ScrollRegion label="Decision trace" className="mt-2 max-h-[32rem] overflow-auto">
        <table className="w-full min-w-[76rem] border-collapse text-left text-[11px]">
          <caption className="text-muted-foreground pb-2 text-left text-xs">
            Decisions in sequence order
            {shown.length === 2000 ? " (first 2,000 shown)" : ""}. Choose a
            decision&rsquo;s number to inspect it. &ldquo;Chose&rdquo; lists every axis
            that offered more than one option; Δ and bold mark an axis whose choice
            differs from the previous executed decision. Confidence is on the
            contract&rsquo;s axis, as the brain stated it; &ldquo;none&rdquo; means it
            stated nothing
            {axis === null
              ? ", and with no contract there is no axis to show: the inspector shows every axis"
              : ""}
            . Each outcome window is the{" "}
            {windowS === null ? "" : `${formatValue(windowS, 0)} s `}after the decision
            began executing
            {spacing === null
              ? ""
              : `; decisions here began every ${formatValue(spacing, 2)} s (median), so a window typically shares its time with ${formatValue(typicalOverlap, 0)} others`}
            . An event — a hit, a kill, a death — is counted in every window it falls in,
            so the rows are not independent outcomes of their decisions.
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
                "window shared with",
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
            {shown.map(({ r, previous }) => {
              const conf = axis ? r.confidence.perAxis[axis] : undefined;
              const o = r.outcome;
              const isOpen = r.sequence === selectedSequence;
              return (
                <tr
                  key={r.sequence}
                  aria-current={isOpen ? "true" : undefined}
                  className={`border-border border-b align-top ${isOpen ? "bg-accent" : ""}`}
                >
                  <th scope="row" className="px-1 py-0.5 font-medium">
                    <button
                      type="button"
                      id={rowButtonId(r.sequence)}
                      aria-controls={isOpen ? inspectorId : undefined}
                      aria-label={`Inspect decision ${r.sequence}${isOpen ? " (open)" : ""}`}
                      onClick={() => open(r.sequence, true)}
                      className="hover:bg-accent focus-visible:ring-ring w-full cursor-pointer rounded px-1 py-0.5 text-left underline decoration-dotted underline-offset-2 focus-visible:ring-2 focus-visible:outline-none"
                    >
                      {isOpen ? <span aria-hidden="true">▶ </span> : null}
                      {r.sequence}
                    </button>
                  </th>
                  <td className="px-2 py-1">
                    {formatValue(r.execution.actionStart ?? r.acceptedAtSim, 1)}
                  </td>
                  <td className="max-w-[22rem] px-2 py-1 break-words">
                    <ChoiceCell r={r} previous={previous} />
                  </td>
                  <td className="px-2 py-1">
                    {/* Each figure under its own name: a probability is "p", a
                        provider's confidence figure is "conf", and a model's
                        own stated confidence is "said". A confidence is never
                        printed as a probability, and without a contract axis
                        nothing is picked to stand for the rest. */}
                    {axis === null ? "—" : describeConfidence(r.confidence.source, conf)}
                  </td>
                  <td className="px-2 py-1 whitespace-nowrap">
                    {r.accounting.wallLatencyMs === null
                      ? "not reported"
                      : `${formatValue(r.accounting.wallLatencyMs, 0)} ms`}
                  </td>
                  <td className="px-2 py-1 whitespace-nowrap">
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
                    {overlaps.has(r.sequence)
                      ? `${overlaps.get(r.sequence)} other${overlaps.get(r.sequence) === 1 ? "" : "s"}`
                      : "—"}
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
      {selectedRow && step ? (
        <DecisionInspector
          id={inspectorId}
          headingRef={headingRef}
          record={selectedRow.r}
          previous={selectedRow.previous}
          overlap={overlaps.get(selectedRow.r.sequence) ?? null}
          contract={contract}
          position={
            step.index === null ? null : { index: step.index, total: shown.length }
          }
          onPrevious={step.previous === null ? null : () => open(step.previous!, false)}
          onNext={step.next === null ? null : () => open(step.next!, false)}
          onClose={() => {
            const sequence = selectedRow.r.sequence;
            setSelected(null);
            // Back to the row it was opened from, when that row is shown.
            document.getElementById(rowButtonId(sequence))?.focus();
          }}
        />
      ) : null}
    </div>
  );
}
