import { ExternalLink } from "lucide-react";
import type { ClaimInspection } from "@/lib/claims";
import { EXTERNAL_LINK_PROPS, safeExternalHref } from "@/lib/safeUrl";
import { ConfidenceValue, EvidenceBadge } from "@/components/evidence/EvidenceUi";
import { UncertaintyPanel } from "@/components/evidence/UncertaintyPanel";
import type { TemporalEvidenceEvent } from "@/lib/temporal";
import { cn } from "@/lib/utils";

/**
 * The claim inspector's body: one subject, as the questions a reviewer asks.
 *
 * Rendered by the 3D dossier (compact) and by `/analysis` (comfortable), from
 * the same `inspectClaim` result, so the canvas and the document cannot answer
 * differently. Headings are real headings at the level the host passes, lists
 * are lists, and every date is labelled with which of the three dates it is.
 */
export function ClaimInspector({
  claim,
  events,
  density = "compact",
  headingLevel = 3,
  idPrefix,
}: {
  claim: ClaimInspection;
  events?: readonly TemporalEvidenceEvent[];
  density?: "compact" | "comfortable";
  headingLevel?: 2 | 3 | 4;
  idPrefix: string;
}) {
  const compact = density === "compact";
  const text = compact ? "text-[11px]" : "text-sm";
  const small = compact ? "text-[10px]" : "text-xs";
  const Heading = `h${headingLevel}` as const;
  const headingClass = compact
    ? "text-muted-foreground text-[10px] font-semibold tracking-[0.14em] uppercase"
    : "text-base font-semibold";

  return (
    <div className="space-y-3">
      {claim.atDate === undefined ? null : (
        <p
          className={cn(
            "border-border bg-secondary/40 rounded border px-2 py-1.5 leading-relaxed",
            small,
          )}
        >
          <span className="font-semibold">On {claim.atDate.date}: </span>
          {claim.atDate.statement}
        </p>
      )}

      <section aria-labelledby={`${idPrefix}-what`}>
        <Heading id={`${idPrefix}-what`} className={headingClass}>
          What this is
        </Heading>
        {claim.description === undefined ? null : (
          <p className={cn("mt-1 leading-relaxed", text)}>{claim.description}</p>
        )}
        <p className={cn("text-muted-foreground mt-1 leading-relaxed", small)}>
          <EvidenceBadge classification={claim.classification} className="mr-1.5" />
          {claim.meaning}
        </p>
        {claim.modelBasis === undefined ? null : (
          <p className={cn("text-muted-foreground mt-1 leading-relaxed", small)}>
            <span className="font-semibold">Why it is here:</span> {claim.modelBasis}.
          </p>
        )}
      </section>

      <section aria-labelledby={`${idPrefix}-knowledge`}>
        <Heading id={`${idPrefix}-knowledge`} className={headingClass}>
          How much is known
        </Heading>
        <dl className={cn("mt-1 space-y-1.5", small)}>
          {(
            [
              ["The evidence establishes", claim.establishes],
              ["This model infers", claim.infers],
              ["Unknown", claim.unknown],
            ] as const
          ).map(([term, lines]) => (
            <div key={term}>
              <dt className="font-semibold">{term}</dt>
              <dd>
                <ul className="text-muted-foreground list-disc space-y-0.5 pl-4 leading-relaxed">
                  {lines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby={`${idPrefix}-when`}>
        <Heading id={`${idPrefix}-when`} className={headingClass}>
          When
        </Heading>
        {/* Three dates, never merged: when something was true of the site, when
            evidence of it became public, and when it entered this model. */}
        <dl
          className={cn(
            "mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono",
            small,
          )}
        >
          <dt className="text-muted-foreground">At the site</dt>
          <dd>{claim.dates.siteEvent}</dd>
          <dt className="text-muted-foreground">Evidence public</dt>
          <dd>{claim.dates.firstPublished ?? "no publication date stated"}</dd>
          <dt className="text-muted-foreground">Knowable from</dt>
          <dd>{claim.dates.knowableFrom ?? "not on the evidence timeline"}</dd>
          <dt className="text-muted-foreground">Entered this model</dt>
          <dd>not recorded by this repository</dd>
        </dl>
      </section>

      <section aria-labelledby={`${idPrefix}-support`}>
        <Heading id={`${idPrefix}-support`} className={headingClass}>
          What supports it ({claim.support.length})
        </Heading>
        <ul className="mt-1.5 space-y-2.5">
          {claim.support.map((support) => {
            const href = safeExternalHref(support.url);
            return (
              <li key={support.recordId} className="border-border border-l-2 pl-2.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <EvidenceBadge classification={support.classification} />
                  <ConfidenceValue
                    confidence={support.confidence}
                    className={cn("text-muted-foreground", small)}
                  />
                </div>
                <p className={cn("mt-1 leading-relaxed", small)}>
                  {href === undefined ? (
                    <span className="text-muted-foreground">{support.title}</span>
                  ) : (
                    <a
                      href={href}
                      {...EXTERNAL_LINK_PROPS}
                      className="text-primary inline-flex items-start gap-1 hover:underline"
                    >
                      {support.title}
                      <ExternalLink
                        className="mt-0.5 size-3 shrink-0"
                        aria-hidden="true"
                      />
                      <span className="sr-only">(opens in a new tab)</span>
                    </a>
                  )}
                </p>
                <p className={cn("text-muted-foreground mt-0.5 font-mono", small)}>
                  {support.modelInternal
                    ? "this repository's own definition"
                    : `${support.publisher ?? "publisher unknown"} · published ${support.published ?? "unknown"} · knowable from ${support.knowableFrom ?? "unknown"}`}
                  {support.measurementUncertaintyM === undefined
                    ? ""
                    : ` · ±${support.measurementUncertaintyM} m`}
                  {support.resolutionM === undefined
                    ? ""
                    : ` · ${support.resolutionM} m source resolution`}
                </p>
              </li>
            );
          })}
        </ul>
        {claim.methodReferences.length === 0 ? null : (
          <p className={cn("text-muted-foreground mt-2 leading-relaxed", small)}>
            <span className="font-semibold">Method reference:</span>{" "}
            {claim.methodReferences.map((reference) => reference.title).join("; ")} —
            documents how a figure is derived; it is not evidence that this exists.
          </p>
        )}
      </section>

      <section aria-labelledby={`${idPrefix}-uncertainty`}>
        <Heading id={`${idPrefix}-uncertainty`} className={headingClass}>
          Uncertainty
        </Heading>
        <UncertaintyPanel
          envelope={claim.uncertainty}
          {...(events === undefined ? {} : { events })}
          density={density}
          className="mt-1.5"
        />
      </section>

      {claim.relationships.length === 0 ? null : (
        <p className={cn("text-muted-foreground leading-relaxed", small)}>
          {claim.relationships
            .map(
              (relationship) =>
                `${relationship.kind.replace(/-/g, " ")} ${relationship.targetLabel}`,
            )
            .join(" · ")}
        </p>
      )}

      <p className={cn("text-muted-foreground leading-relaxed", small)}>
        Changes across releases are not tracked per subject inside the app. Each release
        manifest carries a digest for this subject; compare two of them on the comparison
        page to see whether its geometry, evidence, wording or uncertainty changed.
      </p>
    </div>
  );
}
