import { X } from "lucide-react";
import { Link } from "@tanstack/react-router";
import {
  DEFENSIBILITY_META,
  MODELED_ATTRIBUTE_META,
  PROVE_IT_REPORT,
  formatArea,
  formatVolume,
  retainedPercent,
  type DefensibilityVerdict,
} from "@/lib/forensics";
import { getSource, type SourceId } from "@/lib/siteData";
import { EXTERNAL_LINK_PROPS, safeExternalHref } from "@/lib/safeUrl";
import { ProvenanceFooter } from "@/components/evidence/EvidenceUi";
import { useTwinStore } from "@/lib/store";
import { cn } from "@/lib/utils";

/**
 * The audit that runs while the reconstruction dissolves.
 *
 * Everything on this panel is a count over the evidence ledger, and the numbers
 * are deliberately not softened. The reconstruction renders nine attributes of
 * sixty-eight subjects; a cited public source carries fourteen of those six
 * hundred and twelve assertions. One subject — the runway — keeps geometry a
 * strict reading defends. No cited source states the height of anything at this
 * site, so the modeled built volume that survives is zero cubic metres, and it
 * is printed as zero rather than as a small percentage.
 *
 * The panel exists because the dissolve on its own would be a stunt. A viewer
 * watching forty-five buildings erode is owed the arithmetic behind it, the
 * names of what survived, and a route to the record for every claim that did
 * not — which is what the three lists and the attribute table are.
 */

function SourceLinks({ sourceIds }: { sourceIds: readonly string[] }) {
  if (sourceIds.length === 0) {
    return <span className="text-muted-foreground">no citable public source</span>;
  }
  return (
    <>
      {sourceIds.map((sourceId, index) => {
        const source = getSource(sourceId as SourceId);
        const href = safeExternalHref(source?.url);
        return (
          <span key={sourceId}>
            {index > 0 ? " · " : ""}
            {href === undefined ? (
              <span>{source?.publisher ?? sourceId}</span>
            ) : (
              <a
                href={href}
                {...EXTERNAL_LINK_PROPS}
                className="text-primary hover:underline"
              >
                {source?.publisher ?? sourceId}
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            )}
          </span>
        );
      })}
    </>
  );
}

function VerdictRow({ verdict }: { verdict: DefensibilityVerdict }) {
  const meta = DEFENSIBILITY_META[verdict.level];
  return (
    <li className="border-border border-l-2 pl-2.5">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-foreground text-[11px] font-medium">{verdict.label}</span>
        <span className="text-muted-foreground font-mono text-[10px]">
          <span aria-hidden="true">{meta.glyph} </span>
          {meta.label}
          {verdict.retained.toleranceM === undefined
            ? ""
            : ` · ±${verdict.retained.toleranceM} m`}
        </span>
      </div>
      <p className="text-muted-foreground mt-0.5 font-mono text-[10px]">
        <SourceLinks sourceIds={verdict.sourceIds} />
      </p>
    </li>
  );
}

export function ProveItReport() {
  const proveIt = useTwinStore((state) => state.proveIt);
  const setProveIt = useTwinStore((state) => state.setProveIt);
  const report = PROVE_IT_REPORT;

  if (!proveIt) return null;

  const assertionPercent = retainedPercent(
    report.defendedAssertions,
    report.renderedAssertions,
  );
  const footprintPercent = retainedPercent(
    report.retainedFootprintM2,
    report.modeledFootprintM2,
  );

  return (
    <section
      aria-labelledby="prove-it-heading"
      // The right column, where the dossier would be — and the dossier hides
      // under PROVE IT, so the two never collide. It gets the full height there,
      // which the centre could not offer without covering the console that
      // produced the view or the scene the view is about.
      className={cn(
        "hud-panel pointer-events-auto absolute top-16 right-4 z-30",
        "max-h-[calc(100vh-6rem)] w-[24rem] max-w-[calc(100vw-2rem)] overflow-y-auto p-4",
        "max-sm:top-14 max-sm:right-2 max-sm:max-h-[calc(100vh-16rem)] max-sm:w-[calc(100vw-1rem)] max-sm:p-3",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2
            id="prove-it-heading"
            className="text-foreground font-mono text-xs tracking-[0.28em] uppercase"
          >
            Prove it
          </h2>
          <p className="text-muted-foreground mt-0.5 text-[10px] leading-relaxed">
            The scene now shows only geometry a cited public source defends. Everything
            else has been removed — not hidden.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setProveIt(false)}
          aria-label="Close the strip-down and restore the reconstruction"
          className="border-border hover:bg-accent focus-visible:ring-ring rounded border p-1 focus-visible:ring-2 focus-visible:outline-none"
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      </div>

      {/* The three headline figures. Announced as one status so a screen reader
          gets the finding rather than three orphaned numbers. */}
      <div role="status" className="mt-3 space-y-2.5">
        <div className="border-border bg-secondary/40 rounded border p-2.5">
          <div className="text-foreground font-mono text-2xl leading-none tabular-nums">
            {report.survivingSubjects}
            <span className="text-muted-foreground text-base">
              {" "}
              of {report.totalSubjects}
            </span>
          </div>
          <p className="text-muted-foreground mt-1 text-[10px] leading-relaxed">
            modeled subjects keep any defensible geometry. {report.presenceOnlySubjects}{" "}
            more are attested to exist by a cited publication that does not defend where
            they are, and {report.undefendedSubjects} are defended by nothing cited at
            all.
          </p>
        </div>

        <div className="border-border bg-secondary/40 rounded border p-2.5">
          <div className="text-foreground font-mono text-2xl leading-none tabular-nums">
            {formatVolume(report.retainedVolumeM3)}
            <span className="text-muted-foreground text-base">
              {" "}
              of {formatVolume(report.modeledVolumeM3)}
            </span>
          </div>
          <p className="text-muted-foreground mt-1 text-[10px] leading-relaxed">
            modeled built volume survives, because no cited source states the height of
            anything at this site. Every roofline in the reconstruction is a modeling
            decision.
          </p>
        </div>

        <div className="border-border bg-secondary/40 rounded border p-2.5">
          <div className="text-foreground font-mono text-2xl leading-none tabular-nums">
            {report.defendedAssertions}
            <span className="text-muted-foreground text-base">
              {" "}
              of {report.renderedAssertions}
            </span>
          </div>
          <p className="text-muted-foreground mt-1 text-[10px] leading-relaxed">
            things the scene asserts are carried by a cited source ({assertionPercent}%).
            The reconstruction renders nine attributes of every subject; the evidence
            carries at most three, and only for a few.
          </p>
        </div>
      </div>

      <div className="border-border mt-3 border-t pt-3">
        <h3 className="text-muted-foreground text-[10px] font-semibold tracking-[0.14em] uppercase">
          Retained ({report.survivingSubjects}) · {formatArea(report.retainedFootprintM2)}{" "}
          of {formatArea(report.modeledFootprintM2)} footprint ({footprintPercent}%)
        </h3>
        <ul className="mt-2 space-y-2">
          {report.surviving.map((verdict) => (
            <VerdictRow key={verdict.subjectId} verdict={verdict} />
          ))}
        </ul>
      </div>

      {report.presenceOnly.length > 0 ? (
        <div className="border-border mt-3 border-t pt-3">
          <h3 className="text-muted-foreground text-[10px] font-semibold tracking-[0.14em] uppercase">
            Attested, but not placeable ({report.presenceOnly.length})
          </h3>
          <p className="text-muted-foreground mt-1 text-[10px] leading-relaxed">
            A cited publication states these exist. Nothing cited establishes where they
            are, so no geometry for them is drawn — listing them here rather than putting
            a marker on the ground is the difference between the two claims.
          </p>
          <ul className="mt-2 space-y-2">
            {report.presenceOnly.map((verdict) => (
              <VerdictRow key={verdict.subjectId} verdict={verdict} />
            ))}
          </ul>
        </div>
      ) : null}

      <div className="border-border mt-3 border-t pt-3">
        <h3 className="text-muted-foreground text-[10px] font-semibold tracking-[0.14em] uppercase">
          What the evidence carries, attribute by attribute
        </h3>
        <table className="mt-2 w-full font-mono text-[10px]">
          <caption className="sr-only">
            For each attribute the reconstruction renders, how many of the{" "}
            {report.totalSubjects} modeled subjects have it carried by a cited source.
          </caption>
          <thead>
            <tr className="text-muted-foreground text-left">
              <th scope="col" className="font-normal">
                Attribute
              </th>
              <th scope="col" className="font-normal">
                Question
              </th>
              <th scope="col" className="text-right font-normal">
                Defended
              </th>
            </tr>
          </thead>
          <tbody>
            {report.attributeCoverage.map((coverage) => {
              const meta = MODELED_ATTRIBUTE_META[coverage.attribute];
              return (
                <tr key={coverage.attribute} className="border-border/60 border-t">
                  <th scope="row" className="py-1 pr-2 text-left font-normal">
                    {meta.label}
                  </th>
                  <td className="text-muted-foreground py-1 pr-2 leading-tight">
                    {meta.question}
                  </td>
                  <td className="py-1 text-right tabular-nums">
                    {coverage.defendedSubjects}/{coverage.totalSubjects}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setProveIt(false)}
          className="border-border hover:bg-accent focus-visible:ring-ring rounded border px-2 py-1 text-[10px] focus-visible:ring-2 focus-visible:outline-none"
        >
          Restore the reconstruction
        </button>
        <Link
          to="/analysis"
          className="border-border hover:bg-accent focus-visible:ring-ring rounded border px-2 py-1 text-[10px] focus-visible:ring-2 focus-visible:outline-none"
        >
          Every verdict, as a table
        </Link>
      </div>
      <ProvenanceFooter className="mt-3" />
    </section>
  );
}
