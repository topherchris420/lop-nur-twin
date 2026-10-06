import { useMemo } from "react";
import { PUBLIC_SOURCES } from "@/lib/siteData";
import {
  DATED_SUBJECT_COUNT,
  TEMPORAL_SNAPSHOT_DATES,
  TIMELINE_STOPS,
  compareSnapshots,
  deriveSnapshot,
  snapshotPubliclyEstablishedCount,
} from "@/lib/temporal";
import { useTwinStore } from "@/lib/store";

/** The slider's last position is "now"; every other position is a ledger date. */
const NOW_INDEX = TEMPORAL_SNAPSHOT_DATES.length;

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * The evidence timeline.
 *
 * One control, and the scene's only notion of time. Its stops are the dates
 * the temporal ledger holds — a source becoming public, a feature first seen
 * in imagery — and at each one the scene, the minimap, the index and the ruler
 * draw what someone reading public sources could have drawn that day: solid
 * where a subject was established on evidence already public, an outline where
 * today's model holds something that was not yet established. The last stop is
 * "now", the model's current state.
 *
 * It replaced a year slider labelled "construction timeline", which was wrong
 * twice over: the dates are when things were first *seen*, never built, and it
 * drew twenty-three buildings in 2021 that no cited evidence placed there.
 *
 * Everything here is text as well as picture. The full snapshot, the change
 * comparison and the event ledger are on `/analysis`.
 */
export function TimelineControl() {
  const snapshotDate = useTwinStore((state) => state.snapshotDate);
  const setSnapshotDate = useTwinStore((state) => state.setSnapshotDate);
  const comparisonDate = useTwinStore((state) => state.comparisonDate);
  const setComparisonDate = useTwinStore((state) => state.setComparisonDate);

  const index =
    snapshotDate === null ? NOW_INDEX : TEMPORAL_SNAPSHOT_DATES.indexOf(snapshotDate);
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
  const stop = snapshotDate === null ? undefined : TIMELINE_STOPS[index];

  const established =
    snapshot === null ? null : snapshotPubliclyEstablishedCount(snapshot);
  const publicSources = snapshot === null ? null : snapshot.publishedSourceIds.length;
  const positionText =
    snapshot === null || established === null || publicSources === null
      ? "Now: the model's current state"
      : `${snapshot.date}: ${established} of ${DATED_SUBJECT_COUNT} dated claims publicly established; ${publicSources} of ${PUBLIC_SOURCES.length} sources public`;

  return (
    <section
      className="timeline-panel hud-panel pointer-events-auto absolute bottom-4 left-1/2 z-20 w-80 max-w-[calc(100vw-2rem)] -translate-x-1/2 px-3 py-2 font-mono"
      aria-labelledby="timeline-heading"
    >
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2
            id="timeline-heading"
            className="text-muted-foreground text-[9px] font-normal tracking-[0.18em] uppercase"
          >
            Evidence timeline
          </h2>
          <output
            className="text-foreground block text-lg leading-tight tabular-nums"
            htmlFor="timeline-position"
          >
            {snapshotDate ?? "Now"}
          </output>
        </div>
        <div className="text-muted-foreground text-right text-[9px] leading-tight tracking-[0.08em] uppercase">
          {established === null ? (
            <>
              <span className="text-foreground block">all claims</span>
              model today
            </>
          ) : (
            <>
              <span className="text-foreground block tabular-nums">
                {established}/{DATED_SUBJECT_COUNT}
              </span>
              publicly established
            </>
          )}
        </div>
      </div>
      <label className="sr-only" htmlFor="timeline-position">
        Evidence timeline position
      </label>
      <input
        id="timeline-position"
        type="range"
        min={0}
        max={NOW_INDEX}
        step={1}
        value={index < 0 ? NOW_INDEX : index}
        aria-valuetext={positionText}
        onChange={(event) => {
          const next = Number(event.target.value);
          setSnapshotDate(
            next >= NOW_INDEX ? null : (TEMPORAL_SNAPSHOT_DATES[next] ?? null),
          );
        }}
        className="accent-primary mt-2 h-4 w-full cursor-ew-resize touch-pan-x"
      />
      <div className="text-muted-foreground flex justify-between text-[8px] tabular-nums">
        <span>{TEMPORAL_SNAPSHOT_DATES[0]?.slice(0, 4)}</span>
        <span>now</span>
      </div>

      <p
        role="status"
        className="text-muted-foreground mt-1.5 text-[9px] leading-relaxed"
      >
        {stop === undefined ? (
          "Every claim the model holds today. Step back to see what public sources could support on a given date."
        ) : (
          <>
            {stop.publishedSourceIds.length + stop.firstSeenSubjectIds.length === 0
              ? null
              : `On this date: ${[
                  stop.publishedSourceIds.length > 0
                    ? `${plural(stop.publishedSourceIds.length, "source")} published`
                    : null,
                  stop.firstSeenSubjectIds.length > 0
                    ? `${plural(stop.firstSeenSubjectIds.length, "feature")} first seen in imagery`
                    : null,
                ]
                  .filter((part) => part !== null)
                  .join(", ")}. `}
            Solid: established on evidence public by then. Outline: in today&rsquo;s
            model, not established by then &mdash; absence of evidence, not evidence of
            absence.
          </>
        )}
      </p>

      {snapshotDate === null ? null : (
        <div className="border-border mt-2 border-t pt-2">
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
            className="border-border bg-secondary/60 focus-visible:ring-ring mt-1 w-full rounded border px-1 py-0.5 text-[10px] focus-visible:ring-2 focus-visible:outline-none"
          >
            <option value="">none</option>
            {TEMPORAL_SNAPSHOT_DATES.map((date) => (
              <option key={date} value={date}>
                {date}
              </option>
            ))}
          </select>
          {comparison === null ? null : (
            <p className="text-muted-foreground mt-1 text-[9px] leading-relaxed">
              {comparison.empty
                ? `Nothing differs between ${comparison.from} and ${comparison.to}.`
                : `${plural(comparison.changes.length, "change")} between ${comparison.from} and ${comparison.to}, ${plural(comparison.addedSourceIds.length, "newly published source")}. Full comparison on the analysis page.`}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
