import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { isSubjectDrawn } from "@/lib/drawState";
import type { EvidenceMode } from "@/lib/evidenceMode";
import {
  SNAP_TARGETS,
  distanceM,
  formatBearingDeg,
  formatDistanceM,
  gridBearingDeg,
  gridEastingNorthing,
  measurementSummary,
  pathTotalM,
  positionalStatement,
  type MeasurePoint,
  type SnapTarget,
} from "@/lib/measure";
import { useTwinStore } from "@/lib/store";

/**
 * The measurement ruler without a map.
 *
 * On the 3D route a measurement is clicked out on the minimap. Here the same
 * vertices are chosen from two lists — the ones the ruler would snap to at
 * this evidence-timeline date and in this evidence mode, and no others — and
 * the answer is the same text the ruler copies: distance, grid bearing and,
 * for each endpoint, the positional error its own evidence states (almost
 * always "not stated", which is the honest answer).
 *
 * It also reads out the ruler's current path from the shared store, so a
 * measurement restored from a bookmark is legible without WebGL.
 */

function pointOf(target: SnapTarget): MeasurePoint {
  return {
    x: target.x,
    z: target.z,
    snappedTo: target.label,
    subjectId: target.source.id,
  };
}

const GROUP_LABELS: Record<SnapTarget["kind"], string> = {
  runway: "Runway (measured)",
  "pavement-end": "Pavement ends",
  "apron-center": "Aprons",
  structure: "Structures and aircraft",
};

function groupOf(target: SnapTarget): string {
  return GROUP_LABELS[target.kind];
}

const GROUP_ORDER = [
  "Runway (measured)",
  "Pavement ends",
  "Aprons",
  "Structures and aircraft",
];

export function MeasureBetween({
  evidenceMode,
  snapshotDate,
}: {
  evidenceMode: EvidenceMode;
  snapshotDate: string | null;
}) {
  const measurePoints = useTwinStore((state) => state.measurePoints);
  const [fromIndex, setFromIndex] = useState<number | null>(null);
  const [toIndex, setToIndex] = useState<number | null>(null);

  // The same filter the ruler snaps with: a vertex the scene is not drawing
  // solid is not something to measure from.
  const groups = useMemo(() => {
    const drawn = SNAP_TARGETS.map((target, index) => ({ target, index })).filter(
      ({ target }) => isSubjectDrawn(target.source, snapshotDate, evidenceMode),
    );
    return GROUP_ORDER.map((name) => ({
      name,
      options: drawn.filter(({ target }) => groupOf(target) === name),
    })).filter((group) => group.options.length > 0);
  }, [evidenceMode, snapshotDate]);

  const available = new Set(groups.flatMap((group) => group.options.map((o) => o.index)));
  const from =
    fromIndex !== null && available.has(fromIndex) ? SNAP_TARGETS[fromIndex] : undefined;
  const to =
    toIndex !== null && available.has(toIndex) ? SNAP_TARGETS[toIndex] : undefined;
  const pair =
    from !== undefined && to !== undefined ? [pointOf(from), pointOf(to)] : null;

  const select =
    "border-border bg-secondary/60 focus-visible:ring-ring mt-1 w-full rounded border px-2 py-1.5 text-sm focus-visible:ring-2 focus-visible:outline-none";

  return (
    <div className="mt-3 space-y-5">
      <div className="grid max-w-4xl gap-4 md:grid-cols-2">
        {(
          [
            ["measure-from", "From", fromIndex, setFromIndex],
            ["measure-to", "To", toIndex, setToIndex],
          ] as const
        ).map(([id, label, value, setValue]) => (
          <div key={id}>
            <label htmlFor={id} className="text-sm font-medium">
              {label}
            </label>
            <select
              id={id}
              className={select}
              value={value === null || !available.has(value) ? "" : String(value)}
              onChange={(event) =>
                setValue(event.target.value === "" ? null : Number(event.target.value))
              }
            >
              <option value="">Choose a modeled point</option>
              {groups.map((group) => (
                <optgroup key={group.name} label={group.name}>
                  {group.options.map(({ target, index }) => (
                    <option key={index} value={index}>
                      {target.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
        ))}
      </div>

      <div role="status" aria-live="polite" className="max-w-4xl text-sm">
        {pair === null ? (
          <p className="text-muted-foreground">
            Choose two points. Only points the scene draws solid at this timeline date and
            in this evidence mode are offered, as on the ruler.
          </p>
        ) : (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt className="text-muted-foreground">Distance</dt>
            <dd className="font-mono">
              {formatDistanceM(distanceM(pair[0]!, pair[1]!))}
            </dd>
            <dt className="text-muted-foreground">Grid bearing</dt>
            <dd className="font-mono">
              {formatBearingDeg(gridBearingDeg(pair[0]!, pair[1]!))}
            </dd>
            <dt className="text-muted-foreground">From</dt>
            <dd>{positionalStatement(pair[0]!)}</dd>
            <dt className="text-muted-foreground">To</dt>
            <dd>{positionalStatement(pair[1]!)}</dd>
            <dt className="text-muted-foreground">The distance</dt>
            <dd>
              Between modeled positions: no better known than its less certain end, and
              where an end&rsquo;s error is not stated, neither is the distance&rsquo;s.
            </dd>
          </dl>
        )}
      </div>

      {pair === null ? null : (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="border-border hover:bg-accent focus-visible:ring-ring rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
            onClick={() => {
              void navigator.clipboard
                ?.writeText(measurementSummary(pair, { snapshotDate, evidenceMode }))
                .catch(() => {
                  /* clipboard unavailable: the readout above is the same text */
                });
            }}
          >
            Copy measurement
          </button>
          <Link
            to="/"
            onClick={() => {
              const store = useTwinStore.getState();
              store.clearMeasure();
              for (const point of pair) store.addMeasurePoint(point);
            }}
            className="border-border hover:bg-accent focus-visible:ring-ring rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
          >
            Show on the 3D site map
          </Link>
        </div>
      )}

      <section aria-labelledby="ruler-path-heading" className="max-w-4xl">
        <h3 id="ruler-path-heading" className="text-base font-semibold">
          The ruler&rsquo;s current path
        </h3>
        {measurePoints.length === 0 ? (
          <p className="text-muted-foreground mt-1 text-sm">
            No points. A path placed on the 3D site map, or restored from a bookmark, is
            listed here.
          </p>
        ) : (
          <>
            <ol className="mt-2 space-y-1 text-sm">
              {measurePoints.map((point, index) => {
                const grid = gridEastingNorthing(point.x, point.z);
                return (
                  <li key={index}>
                    <span className="font-mono">
                      P{index + 1} · {grid.easting.toFixed(0)} E{" "}
                      {grid.northing.toFixed(0)} N
                    </span>
                    {point.snappedTo === null ? null : ` · ${point.snappedTo}`}
                    <span className="text-muted-foreground">
                      {" "}
                      — {positionalStatement(point)}
                    </span>
                  </li>
                );
              })}
            </ol>
            {measurePoints.length < 2 ? null : (
              <p className="mt-2 font-mono text-sm">
                Path total {formatDistanceM(pathTotalM(measurePoints))}
              </p>
            )}
          </>
        )}
      </section>
    </div>
  );
}
