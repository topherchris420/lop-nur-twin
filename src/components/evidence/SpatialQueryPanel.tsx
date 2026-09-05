import { Link } from "@tanstack/react-router";
import {
  EVIDENCE_CLASSIFICATIONS,
  EVIDENCE_CLASSIFICATION_META,
  type EvidenceClassification,
} from "@/lib/evidence";
import { formatDistanceM } from "@/lib/measure";
import { SPATIAL_SUBJECTS, type SpatialSubjectKind } from "@/lib/spatialCatalog";
import {
  spatialResultsToCsv,
  spatialResultsToGeoJson,
  spatialResultsToJson,
  type SpatialExportIdentity,
} from "@/lib/spatialExport";
import {
  SOURCE_SUPPORT_VALUES,
  SPATIAL_SUBJECT_KINDS,
  SUBJECT_PRESENCE_VALUES,
  runSpatialQuery,
  type SourceSupport,
} from "@/lib/spatialQuery";
import { TEMPORAL_SNAPSHOT_DATES, type SubjectPresence } from "@/lib/temporal";

export interface SpatialQuerySearchState {
  kinds?: string;
  classes?: string;
  support?: SourceSupport;
  uncertainty?: number;
  includeUnknown?: true;
  spatialDate?: string;
  presence?: string;
  anchor?: string;
  distance?: number;
}

interface SpatialQueryPanelProps {
  search: SpatialQuerySearchState;
  onChange: (next: SpatialQuerySearchState) => void;
  identity?: SpatialExportIdentity;
}

const KIND_LABELS: Record<SpatialSubjectKind, string> = {
  aircraft: "Aircraft",
  apron: "Aprons",
  pavement: "Pavements",
  structure: "Structures",
};

const PRESENCE_LABELS: Record<SubjectPresence, string> = {
  established: "Established by date",
  "not-yet-evidenced": "Not yet evidenced",
  undated: "Undated",
};

function selectedValues<T extends string>(
  value: string | undefined,
  all: readonly T[],
): Set<T> {
  return new Set(value === undefined ? all : (value.split(",") as T[]));
}

function encodedSelection<T extends string>(
  selected: Set<T>,
  all: readonly T[],
): string | undefined {
  const ordered = all.filter((value) => selected.has(value));
  return ordered.length === all.length ? undefined : ordered.join(",");
}

function download(filename: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function SpatialQueryPanel({
  search,
  onChange,
  identity,
}: SpatialQueryPanelProps) {
  const kinds = selectedValues(search.kinds, SPATIAL_SUBJECT_KINDS);
  const classes = selectedValues(search.classes, EVIDENCE_CLASSIFICATIONS);
  const presence = selectedValues(search.presence, SUBJECT_PRESENCE_VALUES);
  const response = runSpatialQuery({
    ...(search.kinds === undefined
      ? {}
      : { kinds: search.kinds.split(",") as SpatialSubjectKind[] }),
    ...(search.classes === undefined
      ? {}
      : {
          evidenceClasses: search.classes.split(",") as EvidenceClassification[],
        }),
    ...(search.support === undefined ? {} : { sourceSupport: search.support }),
    ...(search.uncertainty === undefined
      ? {}
      : { maximumStatedHorizontalUncertaintyM: search.uncertainty }),
    ...(search.includeUnknown === undefined
      ? {}
      : { includeUnknownHorizontalUncertainty: true }),
    ...(search.spatialDate === undefined ? {} : { snapshotDate: search.spatialDate }),
    ...(search.presence === undefined
      ? {}
      : { presence: search.presence.split(",") as SubjectPresence[] }),
    ...(search.anchor === undefined
      ? {}
      : {
          anchorSubjectId: search.anchor,
          maximumDistanceM: search.distance,
        }),
  });

  const update = (patch: Partial<SpatialQuerySearchState>) =>
    onChange({ ...search, ...patch });

  const toggle = <T extends string>(
    value: T,
    selected: Set<T>,
    all: readonly T[],
    key: "kinds" | "classes" | "presence",
  ) => {
    const next = new Set(selected);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    update({ [key]: encodedSelection(next, all) });
  };

  const successful = response.ok ? response : null;
  const queryErrors = response.ok ? [] : response.errors;

  return (
    <section aria-labelledby="spatial-query-heading" className="mt-10">
      <h2 id="spatial-query-heading" className="text-lg font-semibold">
        Spatial query
      </h2>
      <p className="text-muted-foreground mt-1 max-w-4xl text-sm leading-relaxed">
        Filter the committed model and measure edge-to-edge relationships between modeled
        footprints. Distances are planar EPSG:32645 grid values, not geodesic or surveyed
        measurements. Unknown uncertainty remains unknown.
      </p>

      <div className="border-border mt-4 grid gap-5 rounded-lg border p-4 lg:grid-cols-2">
        <fieldset>
          <legend className="text-sm font-medium">Subject kinds</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {SPATIAL_SUBJECT_KINDS.map((kind) => (
              <label key={kind} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={kinds.has(kind)}
                  onChange={() => toggle(kind, kinds, SPATIAL_SUBJECT_KINDS, "kinds")}
                  className="accent-primary"
                />
                {KIND_LABELS[kind]}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-sm font-medium">Evidence classifications</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {EVIDENCE_CLASSIFICATIONS.map((classification) => (
              <label key={classification} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={classes.has(classification)}
                  onChange={() =>
                    toggle(classification, classes, EVIDENCE_CLASSIFICATIONS, "classes")
                  }
                  className="accent-primary"
                />
                <span aria-hidden="true">
                  {EVIDENCE_CLASSIFICATION_META[classification].glyph}
                </span>
                {EVIDENCE_CLASSIFICATION_META[classification].label}
              </label>
            ))}
          </div>
        </fieldset>

        <div>
          <label htmlFor="spatial-support" className="text-sm font-medium">
            Observational support
          </label>
          <select
            id="spatial-support"
            value={search.support ?? "any"}
            onChange={(event) =>
              update({
                support:
                  event.target.value === "any"
                    ? undefined
                    : (event.target.value as SourceSupport),
              })
            }
            className="border-input bg-secondary/60 focus-visible:ring-ring mt-1 block h-9 w-full rounded-md border px-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
          >
            {SOURCE_SUPPORT_VALUES.map((value) => (
              <option key={value} value={value}>
                {value === "any"
                  ? "Any support"
                  : value === "direct-observation"
                    ? "Has direct observational support"
                    : "Without direct observational support"}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="spatial-uncertainty" className="text-sm font-medium">
            Maximum stated horizontal uncertainty (m)
          </label>
          <input
            id="spatial-uncertainty"
            type="number"
            min={0}
            step="any"
            value={search.uncertainty ?? ""}
            onChange={(event) =>
              update({
                uncertainty:
                  event.target.value === "" ? undefined : Number(event.target.value),
              })
            }
            className="border-input bg-secondary/60 focus-visible:ring-ring mt-1 block h-9 w-full rounded-md border px-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
          />
          <label className="mt-2 flex items-start gap-2 text-xs">
            <input
              type="checkbox"
              checked={search.includeUnknown === true}
              onChange={(event) =>
                update({ includeUnknown: event.target.checked ? true : undefined })
              }
              className="mt-0.5 accent-primary"
            />
            Include subjects whose horizontal uncertainty is not stated
          </label>
        </div>

        <div>
          <label htmlFor="spatial-date" className="text-sm font-medium">
            Evidence snapshot date
          </label>
          <select
            id="spatial-date"
            value={search.spatialDate ?? ""}
            onChange={(event) =>
              update({
                spatialDate: event.target.value || undefined,
                ...(event.target.value === "" ? { presence: undefined } : {}),
              })
            }
            className="border-input bg-secondary/60 focus-visible:ring-ring mt-1 block h-9 w-full rounded-md border px-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
          >
            <option value="">No temporal filter</option>
            {TEMPORAL_SNAPSHOT_DATES.map((date) => (
              <option key={date} value={date}>
                {date}
              </option>
            ))}
          </select>
        </div>

        <fieldset disabled={search.spatialDate === undefined}>
          <legend className="text-sm font-medium">Presence at snapshot</legend>
          <div className="mt-2 grid gap-2">
            {SUBJECT_PRESENCE_VALUES.map((value) => (
              <label key={value} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={presence.has(value)}
                  onChange={() =>
                    toggle(value, presence, SUBJECT_PRESENCE_VALUES, "presence")
                  }
                  className="accent-primary"
                />
                {PRESENCE_LABELS[value]}
              </label>
            ))}
          </div>
        </fieldset>

        <div>
          <label htmlFor="spatial-anchor" className="text-sm font-medium">
            Distance anchor
          </label>
          <select
            id="spatial-anchor"
            value={search.anchor ?? ""}
            onChange={(event) =>
              update({
                anchor: event.target.value || undefined,
                distance:
                  event.target.value === "" ? undefined : (search.distance ?? 500),
              })
            }
            className="border-input bg-secondary/60 focus-visible:ring-ring mt-1 block h-9 w-full rounded-md border px-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
          >
            <option value="">No proximity filter</option>
            {SPATIAL_SUBJECTS.map((subject) => (
              <option key={subject.id} value={subject.id}>
                {subject.label} ({subject.id})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="spatial-distance" className="text-sm font-medium">
            Maximum modeled footprint distance (m)
          </label>
          <input
            id="spatial-distance"
            type="number"
            min={0}
            step="any"
            disabled={search.anchor === undefined}
            value={search.distance ?? ""}
            onChange={(event) =>
              update({
                distance:
                  event.target.value === "" ? undefined : Number(event.target.value),
              })
            }
            className="border-input bg-secondary/60 focus-visible:ring-ring mt-1 block h-9 w-full rounded-md border px-2 text-sm focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
          />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onChange({})}
          className="border-border hover:bg-accent focus-visible:ring-ring rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
        >
          Reset query
        </button>
        <button
          type="button"
          disabled={successful === null}
          onClick={() =>
            successful &&
            download(
              "lop-nur-spatial-query.json",
              spatialResultsToJson(successful, identity),
              "application/json",
            )
          }
          className="border-border hover:bg-accent focus-visible:ring-ring rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
        >
          Export JSON
        </button>
        <button
          type="button"
          disabled={successful === null}
          onClick={() =>
            successful &&
            download(
              "lop-nur-spatial-query.csv",
              spatialResultsToCsv(successful),
              "text/csv",
            )
          }
          className="border-border hover:bg-accent focus-visible:ring-ring rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
        >
          Export CSV
        </button>
        <button
          type="button"
          disabled={successful === null}
          onClick={() =>
            successful &&
            download(
              "lop-nur-spatial-query.geojson",
              spatialResultsToGeoJson(successful, identity),
              "application/geo+json",
            )
          }
          className="border-border hover:bg-accent focus-visible:ring-ring rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
        >
          Export GeoJSON
        </button>
      </div>

      {successful === null ? (
        <div role="alert" className="mt-4 text-sm text-destructive">
          Query refused: {queryErrors.join("; ")}
        </div>
      ) : (
        <>
          <p role="status" className="mt-4 text-sm">
            {successful.results.length} modeled spatial subject
            {successful.results.length === 1 ? "" : "s"} match this query.
          </p>
          <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
            {successful.derivation}
          </p>
          <div className="mt-3 overflow-x-auto">
            <table
              id="spatial-query-results"
              tabIndex={-1}
              className="w-full min-w-[58rem] border-collapse text-left text-xs"
            >
              <caption className="text-muted-foreground pb-2 text-left text-xs">
                Deterministic spatial-query results from the committed model. Unknown
                values remain explicitly not stated.
              </caption>
              <thead>
                <tr className="border-border border-b">
                  <th scope="col" className="px-2 py-2 font-semibold">
                    Subject
                  </th>
                  <th scope="col" className="px-2 py-2 font-semibold">
                    Kind
                  </th>
                  <th scope="col" className="px-2 py-2 font-semibold">
                    Evidence
                  </th>
                  <th scope="col" className="px-2 py-2 font-semibold">
                    Modeled distance
                  </th>
                  <th scope="col" className="px-2 py-2 font-semibold">
                    Horizontal uncertainty
                  </th>
                  <th scope="col" className="px-2 py-2 font-semibold">
                    Presence
                  </th>
                  <th scope="col" className="px-2 py-2 font-semibold">
                    Sources
                  </th>
                  <th scope="col" className="px-2 py-2 font-semibold">
                    3D
                  </th>
                </tr>
              </thead>
              <tbody>
                {successful.results.map((result) => (
                  <tr
                    key={result.subject.id}
                    className="border-border border-b align-top"
                  >
                    <th scope="row" className="px-2 py-2 text-left font-medium">
                      {result.subject.label}
                      <span className="text-muted-foreground block font-mono text-[10px] font-normal">
                        {result.subject.id}
                      </span>
                    </th>
                    <td className="px-2 py-2">{KIND_LABELS[result.subject.kind]}</td>
                    <td className="px-2 py-2">
                      {EVIDENCE_CLASSIFICATION_META[result.subject.evidenceClass].glyph}{" "}
                      {EVIDENCE_CLASSIFICATION_META[result.subject.evidenceClass].label}
                    </td>
                    <td className="px-2 py-2 font-mono">
                      {result.distanceM === undefined
                        ? "not stated"
                        : formatDistanceM(result.distanceM)}
                    </td>
                    <td className="px-2 py-2 font-mono">
                      {result.subject.uncertainty?.horizontalMeters === undefined
                        ? "not stated"
                        : `±${result.subject.uncertainty.horizontalMeters} m`}
                    </td>
                    <td className="px-2 py-2 font-mono">
                      {result.presence ?? "not stated"}
                    </td>
                    <td className="px-2 py-2 font-mono">
                      {result.subject.sourceIds.length === 0
                        ? "none"
                        : result.subject.sourceIds.join(", ")}
                    </td>
                    <td className="px-2 py-2">
                      {result.subject.kind === "structure" ||
                      result.subject.kind === "aircraft" ? (
                        <Link
                          to="/"
                          search={{ structure: result.subject.id }}
                          className="border-border hover:bg-accent focus-visible:ring-ring inline-block rounded border px-2 py-1 whitespace-nowrap focus-visible:ring-2 focus-visible:outline-none"
                        >
                          Open
                          <span className="sr-only">
                            {" "}
                            {result.subject.label} dossier in 3D
                          </span>
                        </Link>
                      ) : (
                        "not applicable"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
