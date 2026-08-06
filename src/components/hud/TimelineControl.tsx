import { useMemo } from "react";
import { TIMELINE_BOUNDS, getVisibleDatedAdditionCount } from "@/lib/layout";
import {
  TEMPORAL_SNAPSHOT_DATES,
  compareSnapshots,
  deriveSnapshot,
  snapshotEstablishedCount,
} from "@/lib/temporal";
import { useTwinStore } from "@/lib/store";

const TOTAL_DATED_ADDITIONS = getVisibleDatedAdditionCount(TIMELINE_BOUNDS.maxYear);

/**
 * The construction timeline, plus the date-granularity snapshot and comparison
 * controls.
 *
 * The year slider is unchanged and still owns what the scene draws. The two
 * date pickers below it are a separate, finer instrument: they read the
 * temporal ledger at a specific day and report what was *established* and what
 * was *published* by then, which the year slider cannot express because those
 * two things move independently within a single year.
 *
 * Both readouts are text. The comparison is summarised here and rendered in
 * full on `/analysis`, which is the route that has room for it and the route
 * that works without WebGL.
 */
export function TimelineControl() {
  const activeTimelineYear = useTwinStore((state) => state.activeTimelineYear);
  const setActiveTimelineYear = useTwinStore((state) => state.setActiveTimelineYear);
  const snapshotDate = useTwinStore((state) => state.snapshotDate);
  const setSnapshotDate = useTwinStore((state) => state.setSnapshotDate);
  const comparisonDate = useTwinStore((state) => state.comparisonDate);
  const setComparisonDate = useTwinStore((state) => state.setComparisonDate);
  const visibleDatedAdditions = getVisibleDatedAdditionCount(activeTimelineYear);

  const snapshot = useMemo(
    () => (snapshotDate === null ? null : deriveSnapshot(snapshotDate)),
    [snapshotDate],
  );
  const comparison = useMemo(
    () =>
      snapshotDate === null || comparisonDate === null
        ? null
        : compareSnapshots(snapshotDate, comparisonDate),
    [snapshotDate, comparisonDate],
  );

  return (
    <section
      className="timeline-panel hud-panel pointer-events-auto absolute bottom-4 left-1/2 z-20 w-72 -translate-x-1/2 px-3 py-2 font-mono"
      aria-labelledby="timeline-year-label"
    >
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-muted-foreground text-[9px] tracking-[0.18em] uppercase">
            Construction timeline
          </div>
          <output
            id="timeline-year-label"
            className="text-foreground block text-xl leading-none tabular-nums"
            htmlFor="timeline-year"
          >
            {activeTimelineYear}
          </output>
        </div>
        <div className="text-muted-foreground text-right text-[9px] leading-tight tracking-[0.08em] uppercase">
          <span className="text-foreground block tabular-nums">
            {visibleDatedAdditions}/{TOTAL_DATED_ADDITIONS}
          </span>
          dated additions
        </div>
      </div>
      <label className="sr-only" htmlFor="timeline-year">
        Active construction timeline year
      </label>
      <input
        id="timeline-year"
        type="range"
        min={TIMELINE_BOUNDS.minYear}
        max={TIMELINE_BOUNDS.maxYear}
        step={1}
        value={activeTimelineYear}
        aria-valuetext={`${activeTimelineYear}; ${visibleDatedAdditions} of ${TOTAL_DATED_ADDITIONS} dated additions visible`}
        onChange={(event) => setActiveTimelineYear(Number(event.target.value))}
        className="accent-primary mt-2 h-4 w-full cursor-ew-resize touch-pan-x"
      />
      <div className="text-muted-foreground flex justify-between text-[8px] tabular-nums">
        <span>{TIMELINE_BOUNDS.minYear}</span>
        <span>{TIMELINE_BOUNDS.maxYear}</span>
      </div>

      <div className="border-border mt-2 border-t pt-2">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label
              htmlFor="snapshot-date"
              className="text-muted-foreground block text-[9px] tracking-[0.14em] uppercase"
            >
              Snapshot
            </label>
            <select
              id="snapshot-date"
              value={snapshotDate ?? ""}
              onChange={(event) => setSnapshotDate(event.target.value || null)}
              className="border-border bg-secondary/60 focus-visible:ring-ring mt-1 w-full rounded border px-1 py-0.5 text-[10px] focus-visible:ring-2 focus-visible:outline-none"
            >
              <option value="">current state</option>
              {TEMPORAL_SNAPSHOT_DATES.map((date) => (
                <option key={date} value={date}>
                  {date}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              htmlFor="comparison-date"
              className="text-muted-foreground block text-[9px] tracking-[0.14em] uppercase"
            >
              Compare with
            </label>
            <select
              id="comparison-date"
              value={comparisonDate ?? ""}
              onChange={(event) => setComparisonDate(event.target.value || null)}
              disabled={snapshotDate === null}
              className="border-border bg-secondary/60 focus-visible:ring-ring mt-1 w-full rounded border px-1 py-0.5 text-[10px] focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
            >
              <option value="">none</option>
              {TEMPORAL_SNAPSHOT_DATES.map((date) => (
                <option key={date} value={date}>
                  {date}
                </option>
              ))}
            </select>
          </div>
        </div>

        <p
          role="status"
          className="text-muted-foreground mt-1.5 text-[9px] leading-relaxed"
        >
          {snapshot === null ? (
            "Reading the model's current state. Pick a date to see what was established and what had been published by then."
          ) : comparison === null ? (
            <>
              {snapshotEstablishedCount(snapshot)} subject
              {snapshotEstablishedCount(snapshot) === 1 ? "" : "s"} established by{" "}
              {snapshot.date}; {snapshot.publishedSourceIds.length} source
              {snapshot.publishedSourceIds.length === 1 ? "" : "s"} public by then.
            </>
          ) : comparison.empty ? (
            `Nothing differs between ${comparison.from} and ${comparison.to}.`
          ) : (
            <>
              {comparison.changes.length} change
              {comparison.changes.length === 1 ? "" : "s"} between {comparison.from} and{" "}
              {comparison.to}, {comparison.addedSourceIds.length} newly published source
              {comparison.addedSourceIds.length === 1 ? "" : "s"}. Full comparison on the
              analysis page.
            </>
          )}
        </p>
      </div>
    </section>
  );
}
