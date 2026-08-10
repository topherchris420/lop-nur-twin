import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Crosshair, Download, FileJson, Globe2, Table2, Upload } from "lucide-react";
import {
  CHANGE_CATEGORIES,
  CHANGE_CATEGORY_META,
  MAX_MANIFEST_BYTES,
  diffManifests,
  diffToCsv,
  diffToMarkdown,
  parseManifest,
  type ChangeCategory,
  type ComparableManifest,
  type ManifestDiff,
} from "@/lib/manifestDiff";
import { DIFF_CHANNEL_META, manifestChannels } from "@/lib/forensicDiff";
import { MODEL_MANIFEST_PATH, fetchManifestText, shortHash } from "@/lib/modelManifest";

/**
 * `/compare` — two model manifests, side by side.
 *
 * The manifest already answered "is this the copy that was reviewed?". This
 * route answers the follow-up: *what changed between two builds, and is it the
 * kind of change I need to re-review?* A wording fix and a moved hangar used to
 * be the same event — "the evidence hash is different" — and the per-subject
 * digests added in manifest schema 1.1 are what separate them.
 *
 * It renders no canvas, mounts no Three.js and starts no timer. That is not a
 * concession: verification is exactly the task most likely to be done on a
 * locked-down machine, over a remote session, or by someone reading with a
 * screen reader, and a comparison tool that needs a GPU is a comparison tool
 * that is unavailable when it matters.
 *
 * Nothing is fetched from a third party. One side is the manifest this build
 * serves, same-origin; the other is a file the user chooses. There is
 * deliberately no "compare with a URL" field — it would turn this page into a
 * request-forwarding surface and break the offline guarantee for a convenience
 * that a download already provides.
 */

export const Route = createFileRoute("/compare")({
  component: CompareView,
});

type Side = "before" | "after";

interface LoadedManifest {
  manifest: ComparableManifest;
  label: string;
  warnings: readonly string[];
}

function ManifestSummary({
  loaded,
  side,
}: {
  loaded: LoadedManifest | null;
  side: Side;
}) {
  if (loaded === null) {
    return (
      <p className="text-muted-foreground text-sm">No {side} manifest loaded yet.</p>
    );
  }
  const { manifest } = loaded;
  return (
    <>
      <dl className="space-y-1.5 text-xs">
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Source</dt>
          <dd className="text-right font-mono break-all">{loaded.label}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Model</dt>
          <dd className="text-right font-mono">
            {manifest.modelName} {manifest.modelVersion}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Schema</dt>
          <dd className="text-right font-mono">
            {manifest.manifestSchemaVersion ?? "unstated"}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Generated</dt>
          <dd className="text-right font-mono">{manifest.generatedAt}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Validation</dt>
          <dd className="text-right font-mono">{manifest.validationStatus}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Geometry hash</dt>
          <dd className="text-right font-mono break-all" title={manifest.geometryHash}>
            {shortHash(manifest.geometryHash)}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Evidence ledger hash</dt>
          <dd
            className="text-right font-mono break-all"
            title={manifest.evidenceLedgerHash}
          >
            {shortHash(manifest.evidenceLedgerHash)}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Subjects</dt>
          <dd className="text-right font-mono tabular-nums">
            {manifest.subjects?.length ?? "not carried"}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Evidence records</dt>
          <dd className="text-right font-mono tabular-nums">
            {manifest.evidenceRecordCount ?? "not carried"}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Sources</dt>
          <dd className="text-right font-mono tabular-nums">
            {manifest.sourceCount ?? "not carried"}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Timeline</dt>
          <dd className="text-right font-mono tabular-nums">
            {manifest.timelineYears === undefined
              ? "not carried"
              : `${manifest.timelineYears.min}–${manifest.timelineYears.max}`}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Known limitations</dt>
          <dd className="text-right font-mono tabular-nums">
            {manifest.knownLimitations.length}
          </dd>
        </div>
      </dl>
      {loaded.warnings.length > 0 ? (
        <ul className="mt-3 space-y-1">
          {loaded.warnings.map((warning) => (
            <li
              key={warning}
              className="border-border bg-card/40 rounded border px-2 py-1.5 text-[11px] leading-relaxed"
            >
              ⚠ {warning}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

function ManifestSlot({
  side,
  heading,
  loaded,
  error,
  onFile,
  onLoadBundled,
  busy,
}: {
  side: Side;
  heading: string;
  loaded: LoadedManifest | null;
  error: string | null;
  onFile: (file: File) => void;
  onLoadBundled: () => void;
  busy: boolean;
}) {
  const inputId = `manifest-file-${side}`;
  return (
    <section
      aria-labelledby={`${side}-heading`}
      className="border-border rounded-lg border p-4"
    >
      <h2 id={`${side}-heading`} className="text-lg font-semibold">
        {heading}
      </h2>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label
          htmlFor={inputId}
          className="border-border hover:bg-accent focus-within:ring-ring inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm focus-within:ring-2"
        >
          <Upload className="size-4" aria-hidden="true" />
          Load a manifest file
          <input
            id={inputId}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file !== undefined) onFile(file);
              // Reset so choosing the same file twice fires a change event.
              event.target.value = "";
            }}
          />
        </label>
        <button
          type="button"
          onClick={onLoadBundled}
          disabled={busy}
          className="border-border hover:bg-accent focus-visible:ring-ring inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
        >
          <FileJson className="size-4" aria-hidden="true" />
          Use this build&rsquo;s manifest
        </button>
      </div>

      {error === null ? null : (
        <p
          role="alert"
          className="mt-3 rounded border border-amber-400/50 px-3 py-2 text-sm leading-relaxed"
        >
          {error}
        </p>
      )}

      <div className="mt-4">
        <ManifestSummary loaded={loaded} side={side} />
      </div>
    </section>
  );
}

/**
 * The three forensic channels, over a manifest diff.
 *
 * The manifest's five categories are the right granularity for "which field
 * moved"; they are the wrong granularity for "do I need to re-review the
 * geometry?". Routing them into geometry, evidence and interpretation answers
 * that in one glance, and it is the same routing the temporal comparison uses
 * so both diffs read alike.
 *
 * Release metadata is reported separately rather than folded into a channel: a
 * version bump is not a change to the model, and putting it in one of the three
 * would be noise in a channel a reviewer is meant to trust.
 */
function ChannelSummary({ diff }: { diff: ManifestDiff }) {
  const { channels, releaseMetadata } = manifestChannels(diff);
  return (
    <section aria-labelledby="channels-heading" className="mt-8">
      <h3 id="channels-heading" className="text-base font-semibold">
        What kind of change was it?
      </h3>
      <dl className="mt-3 grid gap-3 md:grid-cols-3">
        {channels.map((summary) => {
          const meta = DIFF_CHANNEL_META[summary.channel];
          return (
            <div
              key={summary.channel}
              className="border-border bg-card/40 rounded-lg border p-3"
            >
              <dt className="text-sm font-medium">
                <span aria-hidden="true">{meta.glyph} </span>
                {meta.label}
                <span className="text-muted-foreground font-mono">
                  {" "}
                  · {summary.differences.length}
                </span>
              </dt>
              <dd className="text-muted-foreground mt-1 text-xs leading-relaxed">
                {meta.description}
                {summary.subjectIds.length === 0 ? null : (
                  <span className="mt-1 block font-mono break-words">
                    {summary.subjectIds.join(", ")}
                  </span>
                )}
              </dd>
            </div>
          );
        })}
      </dl>
      <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
        {releaseMetadata.length} release-metadata difference
        {releaseMetadata.length === 1 ? "" : "s"} (version, generation time, validation
        status) are excluded from all three channels, because they say nothing about the
        model&rsquo;s content.
      </p>
    </section>
  );
}

function DifferenceTable({
  diff,
  category,
}: {
  diff: ManifestDiff;
  category: ChangeCategory;
}) {
  const rows = diff.differences.filter((difference) => difference.category === category);
  if (rows.length === 0) return null;
  const meta = CHANGE_CATEGORY_META[category];
  return (
    <section aria-labelledby={`category-${category}`} className="mt-8">
      <h3 id={`category-${category}`} className="text-base font-semibold">
        <span aria-hidden="true" className="mr-2 font-mono">
          {meta.glyph}
        </span>
        {meta.label} ({rows.length})
      </h3>
      <p className="text-muted-foreground mt-1 max-w-3xl text-sm leading-relaxed">
        {meta.description}
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[52rem] border-collapse text-left text-xs">
          <caption className="text-muted-foreground pb-2 text-left text-xs">
            {meta.label} differences between the two manifests, ordered by subject
            identifier then by field. The ordering is fixed, so the same pair of manifests
            always produces this table in this order.
          </caption>
          <thead>
            <tr className="border-border border-b">
              <th scope="col" className="px-2 py-2 font-semibold">
                Subject
              </th>
              <th scope="col" className="px-2 py-2 font-semibold">
                Field
              </th>
              <th scope="col" className="px-2 py-2 font-semibold">
                Before
              </th>
              <th scope="col" className="px-2 py-2 font-semibold">
                After
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((difference) => (
              <tr
                key={`${difference.subjectId}-${difference.field}`}
                className="border-border border-b align-top"
              >
                <th scope="row" className="px-2 py-2 text-left font-mono font-medium">
                  {difference.subjectId}
                </th>
                <td className="px-2 py-2 font-mono">{difference.field}</td>
                <td className="max-w-[20rem] px-2 py-2 break-words">
                  {difference.before}
                </td>
                <td className="max-w-[20rem] px-2 py-2 break-words">
                  {difference.after}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function download(filename: string, text: string, mime: string) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function CompareView() {
  const [before, setBefore] = useState<LoadedManifest | null>(null);
  const [after, setAfter] = useState<LoadedManifest | null>(null);
  const [beforeError, setBeforeError] = useState<string | null>(null);
  const [afterError, setAfterError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const bundledText = useRef<string | null>(null);

  useEffect(() => {
    document.title =
      "Model manifest comparison — Lop Nur Geospatial Simulation Testbed (public-source model)";
  }, []);

  const accept = useCallback((side: Side, text: string, label: string) => {
    const setLoaded = side === "before" ? setBefore : setAfter;
    const setError = side === "before" ? setBeforeError : setAfterError;
    const result = parseManifest(text);
    if (!result.ok) {
      setLoaded(null);
      setError(result.error);
      return;
    }
    setError(null);
    setLoaded({ manifest: result.manifest, label, warnings: result.warnings });
  }, []);

  const loadFile = useCallback(
    (side: Side, file: File) => {
      const setError = side === "before" ? setBeforeError : setAfterError;
      if (file.size > MAX_MANIFEST_BYTES) {
        setError(
          `"${file.name}" is ${file.size} bytes, over the ${MAX_MANIFEST_BYTES}-byte limit. It is refused without being read.`,
        );
        return;
      }
      file
        .text()
        .then((text) => {
          accept(side, text, file.name);
        })
        .catch(() => {
          setError("The file could not be read.");
        });
    },
    [accept],
  );

  const loadBundled = useCallback(
    (side: Side) => {
      const setError = side === "before" ? setBeforeError : setAfterError;
      const cached = bundledText.current;
      if (cached !== null) {
        accept(side, cached, MODEL_MANIFEST_PATH);
        return;
      }
      setBusy(true);
      fetchManifestText()
        .then((text) => {
          bundledText.current = text;
          accept(side, text, MODEL_MANIFEST_PATH);
        })
        .catch((error: unknown) => {
          setError(
            `This build's manifest could not be read (${
              error instanceof Error ? error.message : "unknown error"
            }). Run \`bun run manifest\` if you are on a dev server that has not generated it.`,
          );
        })
        .finally(() => {
          setBusy(false);
        });
    },
    [accept],
  );

  const diff = useMemo(
    () =>
      before === null || after === null
        ? null
        : diffManifests(before.manifest, after.manifest),
    [before, after],
  );

  return (
    <div className="bg-background text-foreground h-full overflow-y-auto">
      <a
        href="#comparison"
        className="bg-primary text-primary-foreground focus:ring-ring sr-only rounded px-4 py-2 text-sm font-semibold focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:ring-2"
      >
        Skip to the comparison
      </a>

      <div className="mx-auto max-w-[100rem] px-4 py-8 sm:px-8">
        <header>
          <p className="text-muted-foreground font-mono text-[11px] tracking-[0.3em] uppercase">
            Unclassified · public sources only
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
            Model manifest comparison
          </h1>
          <p className="text-muted-foreground mt-3 max-w-4xl text-sm leading-relaxed">
            A release manifest states what one build of this model contains: its geometry
            hash, its evidence-ledger hash, a digest per modeled subject, and what the
            model does not know. Comparing two of them answers a question a single
            manifest cannot &mdash;{" "}
            <strong className="text-foreground">
              what changed, and does it need re-reviewing?
            </strong>{" "}
            Differences are grouped so a build that only reworded a description is visibly
            not the same event as one that moved a footprint.
          </p>
          <p className="text-muted-foreground mt-3 max-w-4xl text-sm leading-relaxed">
            This page loads nothing from a third party. One side is the manifest this
            build serves, from the same origin; the other is a file you choose from your
            own machine. There is no field for a remote URL.
          </p>
          <nav aria-label="Views of this model" className="mt-5 flex flex-wrap gap-3">
            <Link
              to="/analysis"
              className="border-border bg-secondary text-secondary-foreground hover:bg-accent focus-visible:ring-ring inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
            >
              <Table2 className="size-4" aria-hidden="true" />
              Accessible analysis view
            </Link>
            <Link
              to="/"
              className="border-border hover:bg-accent focus-visible:ring-ring inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
            >
              <Globe2 className="size-4" aria-hidden="true" />
              3D analytical twin
            </Link>
            <a
              href={MODEL_MANIFEST_PATH}
              download
              className="border-border hover:bg-accent focus-visible:ring-ring inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
            >
              <Download className="size-4" aria-hidden="true" />
              Download this build&rsquo;s manifest
            </a>
            <Link
              to="/play"
              className="border-border hover:bg-accent focus-visible:ring-ring inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
            >
              <Crosshair className="size-4" aria-hidden="true" />
              Blacksite &mdash; illustrative simulation, not analysis
            </Link>
          </nav>
        </header>

        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          <ManifestSlot
            side="before"
            heading="Before (baseline)"
            loaded={before}
            error={beforeError}
            busy={busy}
            onFile={(file) => loadFile("before", file)}
            onLoadBundled={() => loadBundled("before")}
          />
          <ManifestSlot
            side="after"
            heading="After (comparison)"
            loaded={after}
            error={afterError}
            busy={busy}
            onFile={(file) => loadFile("after", file)}
            onLoadBundled={() => loadBundled("after")}
          />
        </div>

        <section aria-labelledby="comparison-heading" className="mt-10">
          <h2 id="comparison-heading" className="text-lg font-semibold">
            Comparison
          </h2>
          <div id="comparison" tabIndex={-1}>
            {diff === null ? (
              <p role="status" className="text-muted-foreground mt-2 text-sm">
                Load a manifest into both slots to compare them. CI publishes the manifest
                as an artifact on every run, so an earlier build&rsquo;s file can be
                downloaded from its run and loaded here.
              </p>
            ) : (
              <>
                <p role="status" className="mt-2 text-sm">
                  {diff.empty
                    ? "No differences. Every field these two manifests share is identical."
                    : `${diff.differences.length} difference${
                        diff.differences.length === 1 ? "" : "s"
                      } across ${diff.categoriesTouched.length} categor${
                        diff.categoriesTouched.length === 1 ? "y" : "ies"
                      }: ${diff.categoriesTouched
                        .map((category) => CHANGE_CATEGORY_META[category].label)
                        .join(", ")}.`}
                </p>
                {diff.addedSubjectIds.length > 0 || diff.removedSubjectIds.length > 0 ? (
                  <p className="text-muted-foreground mt-1 text-sm">
                    {diff.addedSubjectIds.length} subject
                    {diff.addedSubjectIds.length === 1 ? "" : "s"} added,{" "}
                    {diff.removedSubjectIds.length} removed.
                  </p>
                ) : null}

                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      download(
                        "manifest-diff.json",
                        `${JSON.stringify(diff, null, 2)}\n`,
                        "application/json",
                      )
                    }
                    className="border-border hover:bg-accent focus-visible:ring-ring rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
                  >
                    Export JSON
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      download("manifest-diff.csv", diffToCsv(diff), "text/csv")
                    }
                    className="border-border hover:bg-accent focus-visible:ring-ring rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
                  >
                    Export CSV
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      download(
                        "manifest-diff.md",
                        diffToMarkdown(diff, before!.manifest, after!.manifest),
                        "text/markdown",
                      )
                    }
                    className="border-border hover:bg-accent focus-visible:ring-ring rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
                  >
                    Export Markdown
                  </button>
                </div>

                {/*
                  The same three channels the temporal diff uses, so a build
                  comparison and a date comparison are read the same way. The
                  five manifest categories still get their own tables below —
                  this is the routing on top of them, not a replacement.
                */}
                <ChannelSummary diff={diff} />

                {CHANGE_CATEGORIES.map((category) => (
                  <DifferenceTable key={category} diff={diff} category={category} />
                ))}

                <section aria-labelledby="not-covered-heading" className="mt-10">
                  <h3 id="not-covered-heading" className="text-base font-semibold">
                    What this comparison cannot see
                  </h3>
                  <p className="text-muted-foreground mt-1 max-w-3xl text-sm leading-relaxed">
                    An empty diff means the manifests agree, not that the builds are
                    identical. These are outside the manifest by design:
                  </p>
                  <ul className="mt-3 grid gap-2 md:grid-cols-2">
                    {diff.notCovered.map((item) => (
                      <li
                        key={item}
                        className="border-border bg-card/40 rounded border px-3 py-2 text-xs leading-relaxed"
                      >
                        {item}
                      </li>
                    ))}
                  </ul>
                </section>
              </>
            )}
          </div>
        </section>

        <footer className="border-border text-muted-foreground mt-12 border-t pt-6 text-xs leading-relaxed">
          <p>
            Lop Nur Geospatial Simulation Testbed · unclassified public-source research
            prototype · not government-certified, not FedRAMP authorized, not CMMC
            certified, and not approved for classified or controlled unclassified
            information. This page compares two statements about model content; it does
            not validate either model against the real world.
          </p>
        </footer>
      </div>
    </div>
  );
}
