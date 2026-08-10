import { useMemo } from "react";
import {
  DEFENSIBILITY_LEDGER,
  DEFENSIBILITY_LEVELS,
  DEFENSIBILITY_META,
  MODELED_ATTRIBUTE_META,
  PROVE_IT_REPORT,
  formatArea,
  formatVolume,
  proveItHeadline,
  retainedPercent,
} from "@/lib/forensics";
import { XRAY_LAYER_ORDER, XRAY_MODE_META, XRAY_MODES } from "@/lib/xray";
import { EVIDENCE_CLASSIFICATION_META } from "@/lib/evidence";
import {
  DIFF_CHANNELS,
  DIFF_CHANNEL_META,
  SUBJECT_DIFF_META,
  forensicDiff,
} from "@/lib/forensicDiff";
import {
  REFERENCE_SCENES,
  registrationInstructions,
  sceneAttribution,
  sceneSourceUrl,
} from "@/lib/referenceImagery";
import {
  SCRUB_FIRST_DATE,
  SCRUB_LAST_DATE,
  SCRUB_PRESENCE_META,
  SCRUB_STOPS,
} from "@/lib/timeScrubber";
import { EXTERNAL_LINK_PROPS, safeExternalHref } from "@/lib/safeUrl";
import { useTwinStore } from "@/lib/store";

/**
 * The forensic capabilities, as a document.
 *
 * Every analytical capability the 3D route has must appear on `/analysis` in a
 * semantic form, or it is a capability that is unavailable to anyone using a
 * screen reader, anyone without a usable GPU, and anyone who would rather read
 * the model than fly around it. Four capabilities arrived with the forensic
 * engine and all four are here: the strip-down verdict, the X-ray strata, the
 * three-channel change diff, and the reference-imagery registration.
 *
 * The 3D versions are the same data rendered as geometry. Nothing on this page
 * is a summary of the scene — both read the same derived ledgers, so a figure
 * quoted here is the figure the scene draws.
 */

/* ------------------------------------------------------------------ */
/* Defensibility                                                       */
/* ------------------------------------------------------------------ */

export function DefensibilitySection() {
  const report = PROVE_IT_REPORT;
  const proveIt = useTwinStore((state) => state.proveIt);
  const setProveIt = useTwinStore((state) => state.setProveIt);

  return (
    <section aria-labelledby="defensibility-heading" className="mt-10">
      <h2 id="defensibility-heading" className="text-lg font-semibold">
        Defensibility — what survives a strict reading
      </h2>
      <p className="text-muted-foreground mt-1 max-w-4xl text-sm leading-relaxed">
        {proveItHeadline(report)} This is the same verdict the 3D view applies when
        &ldquo;PROVE IT&rdquo; is pressed: everything the cited evidence does not carry is
        removed from the scene rather than dimmed, and what is left is listed below.
      </p>

      <dl className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="border-border bg-card/40 rounded-lg border p-3">
          <dt className="text-muted-foreground text-xs">Subjects keeping geometry</dt>
          <dd className="mt-1 font-mono text-2xl tabular-nums">
            {report.survivingSubjects}
            <span className="text-muted-foreground text-base">
              {" "}
              / {report.totalSubjects}
            </span>
          </dd>
        </div>
        <div className="border-border bg-card/40 rounded-lg border p-3">
          <dt className="text-muted-foreground text-xs">Built volume retained</dt>
          <dd className="mt-1 font-mono text-2xl tabular-nums">
            {formatVolume(report.retainedVolumeM3)}
            <span className="text-muted-foreground text-base">
              {" "}
              / {formatVolume(report.modeledVolumeM3)}
            </span>
          </dd>
        </div>
        <div className="border-border bg-card/40 rounded-lg border p-3">
          <dt className="text-muted-foreground text-xs">Assertions with a source</dt>
          <dd className="mt-1 font-mono text-2xl tabular-nums">
            {report.defendedAssertions}
            <span className="text-muted-foreground text-base">
              {" "}
              / {report.renderedAssertions}
            </span>
          </dd>
        </div>
      </dl>

      <p className="text-muted-foreground mt-3 text-xs leading-relaxed">
        Footprint retained: {formatArea(report.retainedFootprintM2)} of{" "}
        {formatArea(report.modeledFootprintM2)} (
        {retainedPercent(report.retainedFootprintM2, report.modeledFootprintM2)}%). The
        built-volume figure is zero because no source in the register states the height of
        anything at this site, so every roofline in the reconstruction is a modeling
        decision. It is printed as zero rather than as a small percentage.
      </p>

      <button
        type="button"
        onClick={() => setProveIt(!proveIt)}
        aria-pressed={proveIt}
        className="border-border hover:bg-accent focus-visible:ring-ring mt-3 rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
      >
        {proveIt
          ? "Restore the full reconstruction in the 3D view"
          : "Apply the strict reading to the 3D view"}
      </button>

      <h3 className="mt-6 text-base font-semibold">Levels</h3>
      <dl className="mt-2 space-y-2">
        {DEFENSIBILITY_LEVELS.map((level) => {
          const meta = DEFENSIBILITY_META[level];
          return (
            <div key={level} className="border-border rounded border p-3">
              <dt className="text-sm font-medium">
                <span aria-hidden="true">{meta.glyph} </span>
                {meta.label} — {meta.verdict}{" "}
                <span className="text-muted-foreground font-mono text-xs">
                  ({report.byLevel[level]} subjects)
                </span>
              </dt>
              <dd className="text-muted-foreground mt-1 text-xs leading-relaxed">
                {meta.description}
              </dd>
            </div>
          );
        })}
      </dl>

      <h3 className="mt-6 text-base font-semibold">
        Attribute coverage across {report.totalSubjects} subjects
      </h3>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[34rem] text-sm">
          <caption className="sr-only">
            For each of the nine attributes the reconstruction renders, how many modeled
            subjects have that attribute carried by a cited public source.
          </caption>
          <thead>
            <tr className="border-border text-muted-foreground border-b text-left">
              <th scope="col" className="py-2 pr-3 font-medium">
                Attribute
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                What it answers
              </th>
              <th scope="col" className="py-2 text-right font-medium">
                Defended
              </th>
            </tr>
          </thead>
          <tbody>
            {report.attributeCoverage.map((coverage) => {
              const meta = MODELED_ATTRIBUTE_META[coverage.attribute];
              return (
                <tr key={coverage.attribute} className="border-border/60 border-b">
                  <th scope="row" className="py-2 pr-3 text-left font-medium">
                    {meta.label}
                  </th>
                  <td className="text-muted-foreground py-2 pr-3">{meta.question}</td>
                  <td className="py-2 text-right font-mono tabular-nums">
                    {coverage.defendedSubjects} / {coverage.totalSubjects}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h3 className="mt-6 text-base font-semibold">Verdict for every modeled subject</h3>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[44rem] text-sm">
          <caption className="sr-only">
            Every modeled subject with its defensibility level, the attributes a cited
            source carries, and the attributes this project supplied.
          </caption>
          <thead>
            <tr className="border-border text-muted-foreground border-b text-left">
              <th scope="col" className="py-2 pr-3 font-medium">
                Subject
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                Level
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                Defended by a source
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                Supplied by this project
              </th>
              <th scope="col" className="py-2 text-right font-medium">
                Retained footprint
              </th>
            </tr>
          </thead>
          <tbody>
            {DEFENSIBILITY_LEDGER.map((verdict) => {
              const meta = DEFENSIBILITY_META[verdict.level];
              return (
                <tr
                  key={verdict.subjectId}
                  className="border-border/60 border-b align-top"
                >
                  <th scope="row" className="py-2 pr-3 text-left font-medium">
                    {verdict.label}
                    <span className="text-muted-foreground block font-mono text-xs font-normal">
                      {verdict.subjectId}
                    </span>
                  </th>
                  <td className="py-2 pr-3">
                    <span aria-hidden="true">{meta.glyph} </span>
                    {meta.label}
                  </td>
                  <td className="text-muted-foreground py-2 pr-3 text-xs">
                    {verdict.defended.length === 0
                      ? "nothing"
                      : verdict.defended
                          .map((attribute) =>
                            MODELED_ATTRIBUTE_META[attribute].label.toLowerCase(),
                          )
                          .join(", ")}
                  </td>
                  <td className="text-muted-foreground py-2 pr-3 text-xs">
                    {verdict.stripped
                      .map((attribute) =>
                        MODELED_ATTRIBUTE_META[attribute].label.toLowerCase(),
                      )
                      .join(", ")}
                  </td>
                  <td className="py-2 text-right font-mono text-xs tabular-nums">
                    {verdict.retained.footprintAreaM2 === 0
                      ? "none"
                      : formatArea(verdict.retained.footprintAreaM2)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* X-ray                                                               */
/* ------------------------------------------------------------------ */

export function XraySection() {
  const xrayMode = useTwinStore((state) => state.xrayMode);
  const setXrayMode = useTwinStore((state) => state.setXrayMode);

  return (
    <section aria-labelledby="xray-heading" className="mt-10">
      <h2 id="xray-heading" className="text-lg font-semibold">
        Evidence X-ray — the four layers, separated
      </h2>
      <p className="text-muted-foreground mt-1 max-w-4xl text-sm leading-relaxed">
        By default the reconstruction draws observation, reporting, inference and
        invention with identical solidity, which is a claim it has not earned. X-ray makes
        support visible as appearance: how solid something looks and how high it sits both
        follow from its classification. The table below is that mapping, and the same
        values drive the 3D view.
      </p>

      <fieldset className="mt-3">
        <legend className="text-sm font-medium">X-ray mode</legend>
        <div className="mt-2 flex flex-wrap gap-3">
          {XRAY_MODES.map((mode) => {
            const meta = XRAY_MODE_META[mode];
            const active = mode === xrayMode;
            return (
              <label
                key={mode}
                title={meta.description}
                className={`focus-within:ring-ring inline-flex cursor-pointer items-center gap-1.5 rounded border px-2 py-1 text-xs focus-within:ring-2 ${
                  active
                    ? "border-primary/70 bg-accent/60 text-foreground"
                    : "border-border text-muted-foreground hover:bg-accent/40"
                }`}
              >
                <input
                  type="radio"
                  name="analysis-xray-mode"
                  value={mode}
                  checked={active}
                  onChange={() => setXrayMode(mode)}
                  className="sr-only"
                />
                <span aria-hidden="true">{meta.glyph}</span>
                <span>{meta.label}</span>
                <span aria-hidden="true">{active ? "✓" : ""}</span>
              </label>
            );
          })}
        </div>
      </fieldset>
      <p role="status" className="text-muted-foreground mt-2 text-xs leading-relaxed">
        {XRAY_MODE_META[xrayMode].description}
      </p>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[40rem] text-sm">
          <caption className="sr-only">
            How each evidence classification is drawn under X-ray: the altitude it lifts
            to, whether it is drawn as a building or as a schematic shell, and how much of
            that shell is eroded.
          </caption>
          <thead>
            <tr className="border-border text-muted-foreground border-b text-left">
              <th scope="col" className="py-2 pr-3 font-medium">
                Layer
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                Altitude
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                Drawn as
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                Surface eroded
              </th>
              <th scope="col" className="py-2 font-medium">
                What that says
              </th>
            </tr>
          </thead>
          <tbody>
            {XRAY_LAYER_ORDER.map((layer) => {
              const meta = EVIDENCE_CLASSIFICATION_META[layer.classification];
              return (
                <tr
                  key={layer.classification}
                  className="border-border/60 border-b align-top"
                >
                  <th scope="row" className="py-2 pr-3 text-left font-medium">
                    <span aria-hidden="true">{meta.glyph} </span>
                    {meta.label}
                  </th>
                  <td className="py-2 pr-3 font-mono tabular-nums">{layer.liftM} m</td>
                  <td className="py-2 pr-3">
                    {layer.body === "solid"
                      ? "the modeled building"
                      : "a schematic shell"}
                  </td>
                  <td className="py-2 pr-3 font-mono tabular-nums">
                    {Math.round(layer.dissolve * 100)}%
                  </td>
                  <td className="text-muted-foreground py-2 text-xs leading-relaxed">
                    {layer.reading}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Time scrubber                                                       */
/* ------------------------------------------------------------------ */

export function ScrubberSection() {
  return (
    <section aria-labelledby="scrubber-heading" className="mt-10">
      <h2 id="scrubber-heading" className="text-lg font-semibold">
        Evidence timeline — the dates the ledger can be read at
      </h2>
      <p className="text-muted-foreground mt-1 max-w-4xl text-sm leading-relaxed">
        The 3D view scrubs a continuous day axis from {SCRUB_FIRST_DATE ?? "—"} to{" "}
        {SCRUB_LAST_DATE ?? "—"}, but the state it reports is always the state at one of
        the {SCRUB_STOPS.length} stops below. Between stops nothing changes, because
        between stops this project learned nothing. The axis is days rather than ledger
        position on purpose: quiet years and busy weeks should not take the same time to
        cross.
      </p>

      <h3 className="mt-4 text-base font-semibold">
        How a subject reads while scrubbing
      </h3>
      <dl className="mt-2 space-y-2">
        {(["established", "not-yet-evidenced", "undated", "pre-evidence"] as const).map(
          (presence) => {
            const meta = SCRUB_PRESENCE_META[presence];
            return (
              <div key={presence} className="border-border rounded border p-3">
                <dt className="text-sm font-medium">
                  <span aria-hidden="true">{meta.glyph} </span>
                  {meta.label}
                </dt>
                <dd className="text-muted-foreground mt-1 text-xs leading-relaxed">
                  {meta.description}
                </dd>
              </div>
            );
          },
        )}
      </dl>
      <p className="text-muted-foreground mt-3 text-xs leading-relaxed">
        An undated subject deliberately stays drawn as uncertain rather than appearing or
        disappearing at some date. This project does not know when it arrived, and popping
        it in on a chosen day would be a claim.
      </p>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Three-channel diff                                                  */
/* ------------------------------------------------------------------ */

export function ForensicDiffSection() {
  const snapshotDate = useTwinStore((state) => state.snapshotDate);
  const comparisonDate = useTwinStore((state) => state.comparisonDate);
  const diff = useMemo(
    () =>
      snapshotDate === null || comparisonDate === null
        ? null
        : forensicDiff(snapshotDate, comparisonDate),
    [snapshotDate, comparisonDate],
  );

  return (
    <section aria-labelledby="forensic-diff-heading" className="mt-10">
      <h2 id="forensic-diff-heading" className="text-lg font-semibold">
        Forensic diff — geometry, evidence and interpretation, separately
      </h2>
      <p className="text-muted-foreground mt-1 max-w-4xl text-sm leading-relaxed">
        A flat list of differences answers &ldquo;did something change?&rdquo; and hides
        the only question a reviewer actually has, which is what <em>kind</em> of change
        it was. These three are different events with different consequences, and
        collapsing them is how a rewording gets reviewed like a moved building.
      </p>

      <dl className="mt-3 grid gap-3 md:grid-cols-3">
        {DIFF_CHANNELS.map((channel) => {
          const meta = DIFF_CHANNEL_META[channel];
          const count = diff === null ? null : diff.byChannel[channel].length;
          return (
            <div key={channel} className="border-border bg-card/40 rounded-lg border p-3">
              <dt className="text-sm font-medium">
                <span aria-hidden="true">{meta.glyph} </span>
                {meta.label}
                {count === null ? null : (
                  <span className="text-muted-foreground font-mono"> · {count}</span>
                )}
              </dt>
              <dd className="text-muted-foreground mt-1 text-xs leading-relaxed">
                {meta.question} {meta.description}
              </dd>
            </div>
          );
        })}
      </dl>

      {diff === null ? (
        <p role="status" className="text-muted-foreground mt-3 text-sm">
          Pick a snapshot date and a comparison date above to see what changed between
          them. The same comparison marks the ground in the 3D view.
        </p>
      ) : diff.empty ? (
        <p role="status" className="text-muted-foreground mt-3 text-sm">
          Nothing differs between {diff.from} and {diff.to}.
        </p>
      ) : (
        <>
          <p role="status" className="text-muted-foreground mt-3 text-sm">
            {diff.subjects.length} subject{diff.subjects.length === 1 ? "" : "s"} changed
            between {diff.from} and {diff.to}, across {diff.channelsTouched.length}{" "}
            channel
            {diff.channelsTouched.length === 1 ? "" : "s"}. {diff.addedSourceIds.length}{" "}
            source
            {diff.addedSourceIds.length === 1 ? "" : "s"} became public in that window.
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[44rem] text-sm">
              <caption className="sr-only">
                Every subject that changed between the two dates, with the channel the
                change belongs to and the before and after values.
              </caption>
              <thead>
                <tr className="border-border text-muted-foreground border-b text-left">
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Subject
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Status
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Channels
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Before
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    After
                  </th>
                </tr>
              </thead>
              <tbody>
                {diff.subjects.map((subject) => {
                  const meta = SUBJECT_DIFF_META[subject.status];
                  return (
                    <tr
                      key={subject.subjectId}
                      className="border-border/60 border-b align-top"
                    >
                      <th scope="row" className="py-2 pr-3 text-left font-medium">
                        {subject.label}
                        {subject.modelOnly ? (
                          <span className="text-muted-foreground block text-xs font-normal">
                            model only — asserts nothing about the site
                          </span>
                        ) : null}
                      </th>
                      <td className="py-2 pr-3">
                        <span aria-hidden="true">{meta.glyph} </span>
                        {meta.label}
                      </td>
                      <td className="text-muted-foreground py-2 pr-3 text-xs">
                        {subject.channels
                          .map((channel) => DIFF_CHANNEL_META[channel].label)
                          .join(", ")}
                      </td>
                      <td className="text-muted-foreground py-2 pr-3 text-xs">
                        {subject.changes.map((change) => (
                          <span key={change.kind} className="block">
                            {change.before}
                          </span>
                        ))}
                      </td>
                      <td className="text-muted-foreground py-2 text-xs">
                        {subject.changes.map((change) => (
                          <span key={change.kind} className="block">
                            {change.after}
                          </span>
                        ))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Reference imagery                                                   */
/* ------------------------------------------------------------------ */

export function ReferenceRegistrationSection() {
  return (
    <section aria-labelledby="reference-heading" className="mt-10">
      <h2 id="reference-heading" className="text-lg font-semibold">
        Reference imagery registration
      </h2>
      <p className="text-muted-foreground mt-1 max-w-4xl text-sm leading-relaxed">
        The most direct check on this model is to put the source beside it. This
        application ships no imagery and fetches none — redistribution is not this
        project&rsquo;s to grant, and the build downloads nothing — so what it publishes
        instead is the exact projected window the model occupies. Retrieve the cited scene
        yourself, crop to these bounds, and the 3D view will draw it on the ground at the
        same metre scale with a swipe divider.
      </p>

      {REFERENCE_SCENES.map((scene) => {
        const href = safeExternalHref(sceneSourceUrl(scene));
        return (
          <div key={scene.id} className="border-border mt-4 rounded-lg border p-4">
            <h3 className="text-base font-semibold">{scene.label}</h3>
            <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
              {scene.note}
            </p>
            <dl className="mt-3 grid gap-x-4 gap-y-1 font-mono text-xs sm:grid-cols-2">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Coordinate frame</dt>
                <dd>{scene.window.crs}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Resolution</dt>
                <dd>{scene.resolutionM} m</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Easting</dt>
                <dd className="tabular-nums">
                  {scene.window.minEastingM} – {scene.window.maxEastingM}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Northing</dt>
                <dd className="tabular-nums">
                  {scene.window.minNorthingM} – {scene.window.maxNorthingM}
                </dd>
              </div>
            </dl>
            <ol className="mt-3 space-y-1 pl-5 text-xs leading-relaxed">
              {registrationInstructions(scene).map((step) => (
                <li key={step} className="list-decimal">
                  {step}
                </li>
              ))}
            </ol>
            {href === undefined ? null : (
              <p className="mt-2 text-xs">
                <a
                  href={href}
                  {...EXTERNAL_LINK_PROPS}
                  className="text-primary inline-flex items-center gap-1 hover:underline"
                >
                  Open the cited scene
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
              </p>
            )}
            <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
              {sceneAttribution(scene)}
            </p>
          </div>
        );
      })}
    </section>
  );
}
