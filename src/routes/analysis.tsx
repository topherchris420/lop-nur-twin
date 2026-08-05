import { useEffect, useMemo, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Crosshair, Download, ExternalLink, Globe2 } from "lucide-react";
import {
  STRUCTURES,
  STRUCTURE_TYPE_LABELS,
  isAircraft,
  type StructureDef,
} from "@/lib/layout";
import { gridEastingNorthing } from "@/lib/measure";
import { PUBLIC_SOURCES, SITE_PROFILE } from "@/lib/siteData";
import {
  CONFIDENCE_SCALE_NOTE,
  EVIDENCE_CLASSIFICATIONS,
  EVIDENCE_CLASSIFICATION_META,
  GEOGRAPHIC_CRS,
  KNOWN_LIMITATIONS,
  PRIMARY_CRS,
  evidenceClassificationCounts,
  getEvidenceForSubject,
  strongestClassification,
  type EvidenceClassification,
} from "@/lib/evidence";
import {
  MODEL_MANIFEST_PATH,
  shortHash,
  useModelManifest,
} from "@/lib/modelManifest";
import { EXTERNAL_LINK_PROPS, safeExternalHref } from "@/lib/safeUrl";
import {
  ConfidenceValue,
  EvidenceBadge,
  EvidenceLegendList,
} from "@/components/evidence/EvidenceUi";

/**
 * `/analysis` — the model without the 3D scene.
 *
 * The digital twin is a WebGL canvas driven by a mouse, which excludes anyone
 * using a screen reader, anyone on a machine without a usable GPU, and anyone
 * who simply wants to read the data rather than fly around it. This route is
 * the same evidence ledger as a document: semantic headings, one real table,
 * text-first evidence status, and a link back into the 3D dossier for every
 * row.
 *
 * It deliberately renders no canvas, no animation and no timers, so it works
 * under `prefers-reduced-motion`, in a text browser, and in print.
 */

interface AnalysisSearch {
  /** Row to highlight, handed over from a dossier in the 3D twin. */
  structure?: string;
}

export const Route = createFileRoute("/analysis")({
  component: AnalysisView,
  // Search parameters arrive from links and from whatever a visitor types.
  // Anything that is not a plausible model id is dropped rather than trusted.
  validateSearch: (search: Record<string, unknown>): AnalysisSearch => {
    const raw = search["structure"];
    if (typeof raw !== "string") return {};
    const id = raw.trim();
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) return {};
    return STRUCTURES.some((structure) => structure.id === id) ? { structure: id } : {};
  },
});

const ALL_CLASSIFICATIONS: readonly EvidenceClassification[] = EVIDENCE_CLASSIFICATIONS;

function structureClassification(structure: StructureDef): EvidenceClassification {
  return strongestClassification(getEvidenceForSubject(structure.id)) ?? structure.evidence.status;
}

/** Highest confidence recorded for a structure, or the layout ordinal if none. */
function structureConfidence(structure: StructureDef): number {
  const records = getEvidenceForSubject(structure.id);
  return records.reduce((best, record) => Math.max(best, record.confidence), 0);
}

function AnalysisView() {
  const { structure: highlighted } = Route.useSearch();
  const [query, setQuery] = useState("");
  const [enabled, setEnabled] = useState<readonly EvidenceClassification[]>(
    ALL_CLASSIFICATIONS,
  );
  const manifest = useModelManifest(true);

  useEffect(() => {
    document.title =
      "Structure analysis table — Lop Nur Geospatial Simulation Testbed (public-source model)";
  }, []);

  // A deep link from a dossier should land on its row, not at the top of a
  // 45-row table. Reduced-motion users get an instant jump.
  useEffect(() => {
    if (highlighted === undefined) return;
    const row = document.getElementById(`row-${highlighted}`);
    if (row === null) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    row.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
  }, [highlighted]);

  const rows = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const active = new Set(enabled);
    return STRUCTURES.filter((structure) => {
      if (!active.has(structureClassification(structure))) return false;
      if (needle.length === 0) return true;
      const haystack = [
        structure.name,
        structure.id,
        structure.description,
        STRUCTURE_TYPE_LABELS[structure.type],
        ...getEvidenceForSubject(structure.id).map(
          (record) => `${record.claim} ${record.analystNotes ?? ""} ${record.sourceTitle}`,
        ),
      ]
        .join(" ")
        .toLocaleLowerCase();
      return haystack.includes(needle);
    }).sort((left, right) => left.name.localeCompare(right.name));
  }, [query, enabled]);

  const counts = useMemo(evidenceClassificationCounts, []);

  const toggleClassification = (classification: EvidenceClassification) => {
    setEnabled((current) =>
      current.includes(classification)
        ? current.filter((item) => item !== classification)
        : [...current, classification],
    );
  };

  return (
    <div className="bg-background text-foreground h-full overflow-y-auto">
      <a
        href="#structure-table"
        className="bg-primary text-primary-foreground focus:ring-ring sr-only rounded px-4 py-2 text-sm font-semibold focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:ring-2"
      >
        Skip to the structure table
      </a>

      <div className="mx-auto max-w-[110rem] px-4 py-8 sm:px-8">
        <header>
          <p className="text-muted-foreground font-mono text-[11px] tracking-[0.3em] uppercase">
            Unclassified · public sources only
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
            Lop Nur Geospatial Simulation Testbed — structure analysis
          </h1>
          <p className="text-muted-foreground mt-3 max-w-4xl text-sm leading-relaxed">
            This table describes a <strong className="text-foreground">public-source
            analytical reconstruction</strong>: a modeled airfield built from cited
            open Earth-observation products and published reporting. It is not
            operational data, not an official facility record, and not a verified
            statement of any building&rsquo;s interior use. Every row carries the
            evidence classification, confidence and source that supports it, and
            values the project does not know are marked unknown rather than
            estimated.
          </p>
          <nav aria-label="Views of this model" className="mt-5 flex flex-wrap gap-3">
            <Link
              to="/"
              className="border-border bg-secondary text-secondary-foreground hover:bg-accent focus-visible:ring-ring inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
            >
              <Globe2 className="size-4" aria-hidden="true" />
              Open the 3D analytical twin
            </Link>
            <Link
              to="/play"
              className="border-border hover:bg-accent focus-visible:ring-ring inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
            >
              <Crosshair className="size-4" aria-hidden="true" />
              Open Blacksite — illustrative simulation, not operational data
            </Link>
            <a
              href={MODEL_MANIFEST_PATH}
              download
              className="border-border hover:bg-accent focus-visible:ring-ring inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
            >
              <Download className="size-4" aria-hidden="true" />
              Download the model manifest (JSON)
            </a>
          </nav>
        </header>

        <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <section aria-labelledby="legend-heading">
            <h2 id="legend-heading" className="text-lg font-semibold">
              Evidence status legend
            </h2>
            <p className="text-muted-foreground mt-1 text-sm">
              Status is shown with a symbol and a word as well as a colour, so it
              survives greyscale printing and colour-blind review.
            </p>
            <div className="border-border mt-3 rounded-lg border p-4">
              <EvidenceLegendList />
            </div>
            <p className="text-muted-foreground mt-3 text-xs leading-relaxed">
              {CONFIDENCE_SCALE_NOTE}
            </p>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
              {ALL_CLASSIFICATIONS.map((classification) => (
                <div key={classification} className="border-border rounded border p-2">
                  <dt className="text-muted-foreground">
                    {EVIDENCE_CLASSIFICATION_META[classification].label} records
                  </dt>
                  <dd className="font-mono text-base tabular-nums">{counts[classification]}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section aria-labelledby="manifest-heading">
            <h2 id="manifest-heading" className="text-lg font-semibold">
              Model manifest
            </h2>
            <p className="text-muted-foreground mt-1 text-sm">
              Generated before each build from the committed model data. The hashes
              identify exactly which geometry and which evidence ledger this page is
              rendering.
            </p>
            <dl className="border-border mt-3 space-y-2 rounded-lg border p-4 text-xs">
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Coordinate reference system</dt>
                <dd className="font-mono">{PRIMARY_CRS}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Geographic reference</dt>
                <dd className="font-mono">{GEOGRAPHIC_CRS}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Vertical reference</dt>
                <dd className="text-right font-mono">
                  {SITE_PROFILE.terrainDatum.verticalReference}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Modeled structures</dt>
                <dd className="font-mono tabular-nums">{STRUCTURES.length}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Public sources</dt>
                <dd className="font-mono tabular-nums">{PUBLIC_SOURCES.length}</dd>
              </div>
              {manifest.status === "ready" ? (
                <>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Manifest version</dt>
                    <dd className="font-mono">{manifest.manifest.modelVersion}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Generated</dt>
                    <dd className="font-mono">{manifest.manifest.generatedAt}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Validation</dt>
                    <dd className="font-mono">{manifest.manifest.validationStatus}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Geometry hash</dt>
                    <dd
                      className="font-mono break-all"
                      title={manifest.manifest.geometryHash}
                    >
                      {shortHash(manifest.manifest.geometryHash)}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Evidence ledger hash</dt>
                    <dd
                      className="font-mono break-all"
                      title={manifest.manifest.evidenceLedgerHash}
                    >
                      {shortHash(manifest.manifest.evidenceLedgerHash)}
                    </dd>
                  </div>
                </>
              ) : null}
            </dl>
            {/* Outside the list: a status line is not a term/definition pair,
                and a stray <div> inside a <dl> is a markup error. */}
            {manifest.status === "ready" ? null : (
              <p role="status" className="text-muted-foreground mt-3 text-xs">
                {manifest.status === "loading"
                  ? "Reading the manifest…"
                  : "Manifest not available in this build. Run `bun run manifest` (or `npm run manifest`) to generate it."}
              </p>
            )}
          </section>
        </div>

        <section aria-labelledby="limitations-heading" className="mt-10">
          <h2 id="limitations-heading" className="text-lg font-semibold">
            Known limitations
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Published in the release manifest as well, so a downstream consumer of
            the data receives them with it.
          </p>
          <ul className="mt-3 grid gap-2 md:grid-cols-2">
            {KNOWN_LIMITATIONS.map((limitation) => (
              <li
                key={limitation}
                className="border-border bg-card/40 rounded border px-3 py-2 text-xs leading-relaxed"
              >
                {limitation}
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="table-heading" className="mt-10">
          <h2 id="table-heading" className="text-lg font-semibold">
            Modeled structures
          </h2>

          <div className="mt-4 flex flex-col gap-4 md:flex-row md:items-end">
            <div className="md:w-80">
              <label htmlFor="structure-search" className="text-sm font-medium">
                Search structures
              </label>
              <input
                id="structure-search"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Name, id, source or note"
                autoComplete="off"
                aria-describedby="structure-search-hint"
                className="border-input bg-secondary/60 text-foreground placeholder:text-muted-foreground focus-visible:ring-ring mt-1 h-10 w-full rounded-md border px-3 text-sm focus-visible:ring-2 focus-visible:outline-none"
              />
              <p id="structure-search-hint" className="text-muted-foreground mt-1 text-xs">
                Matches structure names, ids, descriptions, analyst notes and source
                titles.
              </p>
            </div>

            <fieldset className="min-w-0">
              <legend className="text-sm font-medium">Filter by evidence status</legend>
              <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
                {ALL_CLASSIFICATIONS.map((classification) => (
                  <label
                    key={classification}
                    className="flex cursor-pointer items-center gap-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={enabled.includes(classification)}
                      onChange={() => toggleClassification(classification)}
                      className="accent-primary focus-visible:ring-ring size-4 focus-visible:ring-2 focus-visible:outline-none"
                    />
                    <span aria-hidden="true">
                      {EVIDENCE_CLASSIFICATION_META[classification].glyph}
                    </span>
                    {EVIDENCE_CLASSIFICATION_META[classification].label}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>

          <p role="status" className="text-muted-foreground mt-4 text-sm">
            Showing {rows.length} of {STRUCTURES.length} modeled structures.
          </p>

          <div id="structure-table" tabIndex={-1} className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[72rem] border-collapse text-left text-xs">
              <caption className="text-muted-foreground pb-3 text-left text-xs">
                Modeled structures in the public-source reconstruction. Positions are
                modeled coordinates in {PRIMARY_CRS}, not surveyed control points;
                dimensions are modeled geometry.
              </caption>
              <thead>
                <tr className="border-border border-b">
                  <th scope="col" className="px-2 py-2 font-semibold">
                    Structure
                  </th>
                  <th scope="col" className="px-2 py-2 font-semibold">
                    Identifier
                  </th>
                  <th scope="col" className="px-2 py-2 font-semibold">
                    Category
                  </th>
                  <th scope="col" className="px-2 py-2 font-semibold">
                    Evidence status
                  </th>
                  <th scope="col" className="px-2 py-2 font-semibold">
                    Confidence
                  </th>
                  <th scope="col" className="px-2 py-2 font-semibold">
                    Modeled position ({PRIMARY_CRS})
                  </th>
                  <th scope="col" className="px-2 py-2 font-semibold">
                    Dimensions (W × D × H)
                  </th>
                  <th scope="col" className="px-2 py-2 font-semibold">
                    Stated uncertainty
                  </th>
                  <th scope="col" className="px-2 py-2 font-semibold">
                    Sources
                  </th>
                  <th scope="col" className="px-2 py-2 font-semibold">
                    Analyst notes
                  </th>
                  <th scope="col" className="px-2 py-2 font-semibold">
                    3D dossier
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((structure) => {
                  const records = getEvidenceForSubject(structure.id);
                  const classification = structureClassification(structure);
                  const grid = gridEastingNorthing(structure.position[0], structure.position[1]);
                  const uncertainty = records
                    .map((record) =>
                      record.measurementUncertaintyM !== undefined
                        ? `±${record.measurementUncertaintyM} m`
                        : record.sourceResolutionM !== undefined
                          ? `${record.sourceResolutionM} m source resolution`
                          : undefined,
                    )
                    .filter((value): value is string => value !== undefined);
                  const notes = records
                    .map((record) => record.analystNotes)
                    .filter((note): note is string => note !== undefined);
                  const [width, height, depth] = structure.size;
                  const isSelected = highlighted === structure.id;

                  return (
                    <tr
                      key={structure.id}
                      id={`row-${structure.id}`}
                      className={
                        isSelected
                          ? "border-border bg-accent/40 border-b align-top"
                          : "border-border border-b align-top"
                      }
                    >
                      <th scope="row" className="px-2 py-3 text-left font-medium">
                        {structure.name}
                        {isSelected ? (
                          <span className="text-primary block text-[10px] font-normal">
                            ← opened from the 3D dossier
                          </span>
                        ) : null}
                        {isAircraft(structure.type) ? (
                          <span className="text-muted-foreground block text-[10px] font-normal">
                            Aircraft — identification follows cited reporting and is not
                            official
                          </span>
                        ) : null}
                      </th>
                      <td className="px-2 py-3 font-mono">{structure.id}</td>
                      <td className="px-2 py-3">{STRUCTURE_TYPE_LABELS[structure.type]}</td>
                      <td className="px-2 py-3">
                        <EvidenceBadge classification={classification} />
                        <span className="text-muted-foreground mt-1 block text-[10px]">
                          {EVIDENCE_CLASSIFICATION_META[classification].statement}
                        </span>
                      </td>
                      <td className="px-2 py-3">
                        <ConfidenceValue confidence={structureConfidence(structure)} />
                      </td>
                      <td className="px-2 py-3 font-mono whitespace-nowrap">
                        {grid.easting.toFixed(0)} E<br />
                        {grid.northing.toFixed(0)} N
                        <span className="text-muted-foreground block text-[10px]">
                          approximate coordinate
                        </span>
                      </td>
                      <td className="px-2 py-3 font-mono whitespace-nowrap">
                        {width} × {depth} × {height} m
                        <span className="text-muted-foreground block text-[10px]">
                          modeled geometry
                        </span>
                      </td>
                      <td className="px-2 py-3">
                        {uncertainty.length > 0 ? uncertainty.join("; ") : "not stated"}
                      </td>
                      <td className="px-2 py-3">
                        <ul className="space-y-1">
                          {records.map((record) => {
                            const href = safeExternalHref(record.sourceUrl);
                            return (
                              <li key={record.id}>
                                {href === undefined ? (
                                  <span>{record.sourceTitle}</span>
                                ) : (
                                  <a
                                    href={href}
                                    {...EXTERNAL_LINK_PROPS}
                                    className="text-primary focus-visible:ring-ring inline-flex items-start gap-1 underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:outline-none"
                                  >
                                    {record.sourceTitle}
                                    <ExternalLink
                                      className="mt-0.5 size-3 shrink-0"
                                      aria-hidden="true"
                                    />
                                    <span className="sr-only">(opens in a new tab)</span>
                                  </a>
                                )}
                                <span className="text-muted-foreground block text-[10px]">
                                  {record.sourcePublisher ?? "publisher unknown"} · published{" "}
                                  {record.sourceDate ?? "unknown"} · accessed{" "}
                                  {record.accessedAt ?? "unknown"}
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      </td>
                      <td className="text-muted-foreground max-w-[26rem] px-2 py-3 leading-relaxed">
                        {notes.length > 0 ? notes.join(" ") : "No additional analyst note."}
                      </td>
                      <td className="px-2 py-3">
                        <Link
                          to="/"
                          search={{ structure: structure.id }}
                          className="border-border hover:bg-accent focus-visible:ring-ring inline-block rounded border px-2 py-1 whitespace-nowrap focus-visible:ring-2 focus-visible:outline-none"
                        >
                          Open in 3D
                          <span className="sr-only"> — {structure.name} dossier</span>
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {rows.length === 0 ? (
              <p className="text-muted-foreground py-8 text-center text-sm">
                No structures match this search and filter combination.
              </p>
            ) : null}
          </div>
        </section>

        <section aria-labelledby="sources-heading" className="mt-10">
          <h2 id="sources-heading" className="text-lg font-semibold">
            Public source register
          </h2>
          <ol className="mt-3 space-y-3">
            {PUBLIC_SOURCES.map((source) => {
              const href = safeExternalHref(source.url);
              return (
                <li key={source.id} className="border-border border-l-2 pl-3">
                  <p className="text-sm font-medium">
                    {href === undefined ? (
                      source.title
                    ) : (
                      <a
                        href={href}
                        {...EXTERNAL_LINK_PROPS}
                        className="text-primary focus-visible:ring-ring inline-flex items-start gap-1 underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:outline-none"
                      >
                        {source.title}
                        <ExternalLink className="mt-1 size-3 shrink-0" aria-hidden="true" />
                        <span className="sr-only">(opens in a new tab)</span>
                      </a>
                    )}
                  </p>
                  <p className="text-muted-foreground mt-0.5 font-mono text-xs">
                    {source.publisher} · published {source.publishedOn ?? "unknown"} · accessed{" "}
                    {source.accessedOn} · role: {source.role}
                  </p>
                  <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                    {source.attribution}
                  </p>
                </li>
              );
            })}
          </ol>
        </section>

        <footer className="border-border text-muted-foreground mt-12 border-t pt-6 text-xs leading-relaxed">
          <p>
            Lop Nur Geospatial Simulation Testbed · unclassified public-source research
            prototype · not government-certified, not FedRAMP authorized, not CMMC
            certified, and not approved for classified or controlled unclassified
            information. Observation and simulation are labelled separately throughout:
            source observations come from the cited register above; everything the
            model adds is marked interpreted or illustrative.
          </p>
        </footer>
      </div>
    </div>
  );
}
