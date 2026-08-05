import {
  UNCERTAINTY_BASIS_LABELS,
  UNCERTAINTY_LEVEL_META,
  formatTemporalBound,
  formatUncertainty,
  hasNumericUncertainty,
  type UncertaintyEnvelope,
} from "@/lib/uncertainty";
import { TEMPORAL_SCOPE_META, type TemporalEvidenceEvent } from "@/lib/temporal";
import { cn } from "@/lib/utils";

/**
 * Uncertainty and temporal evidence, as text.
 *
 * This is the representation the whole feature is anchored to: the rings in the
 * 3D scene and the broken outlines on the minimap are redundant restatements of
 * what is written here, so nothing is knowable only by looking at a picture.
 * `/analysis` renders the same component, which is what makes the non-WebGL
 * route equivalent rather than a summary.
 *
 * The rule the wording enforces: absent is printed as "not stated", never as a
 * zero, a dash, or an omitted row. A missing height tolerance and a height
 * tolerance of ±0 m are opposite claims.
 */

function LevelRow({
  label,
  level,
}: {
  label: string;
  level: UncertaintyEnvelope["identification"];
}) {
  const meta = UNCERTAINTY_LEVEL_META[level];
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right">
        <span aria-hidden="true" className="mr-1 font-mono">
          {meta.glyph}
        </span>
        {meta.label}
      </dd>
    </>
  );
}

export function UncertaintyPanel({
  envelope,
  events,
  className,
  density = "compact",
}: {
  envelope: UncertaintyEnvelope | undefined;
  events?: readonly TemporalEvidenceEvent[];
  className?: string;
  density?: "compact" | "comfortable";
}) {
  const text = density === "compact" ? "text-[10px]" : "text-xs";

  if (envelope === undefined) {
    return (
      <p className={cn("text-muted-foreground leading-relaxed", text, className)}>
        No uncertainty envelope is recorded for this subject.
      </p>
    );
  }

  return (
    <div className={className}>
      <dl className={cn("grid grid-cols-2 gap-x-3 gap-y-1", text, "font-mono")}>
        <dt className="text-muted-foreground">Spatial</dt>
        <dd className="text-right">{formatUncertainty(envelope)}</dd>
        <dt className="text-muted-foreground">Height</dt>
        <dd className="text-right">
          {envelope.heightMeters === undefined
            ? "not stated"
            : `±${envelope.heightMeters} m`}
        </dd>
        <dt className="text-muted-foreground">Orientation</dt>
        <dd className="text-right">
          {envelope.orientationDegrees === undefined
            ? "not stated"
            : `±${envelope.orientationDegrees}°`}
        </dd>
        <LevelRow label="Identification" level={envelope.identification} />
        <LevelRow label="Function" level={envelope.function} />
        <dt className="text-muted-foreground">Temporal bound</dt>
        <dd className="text-right">{formatTemporalBound(envelope)}</dd>
        <dt className="text-muted-foreground">Source disagreement</dt>
        <dd className="text-right">
          {envelope.sourceDisagreement === undefined
            ? "none recorded"
            : envelope.sourceDisagreement
              ? "yes"
              : "no"}
        </dd>
      </dl>

      {hasNumericUncertainty(envelope) && envelope.basis !== undefined ? (
        <p className={cn("text-muted-foreground mt-1.5 leading-relaxed", text)}>
          <span className="font-semibold">Basis:</span>{" "}
          {UNCERTAINTY_BASIS_LABELS[envelope.basis]}
          {envelope.method === undefined ? null : ` — ${envelope.method}`}
        </p>
      ) : null}

      {envelope.narrative === undefined ? null : (
        <p className={cn("text-muted-foreground mt-1.5 leading-relaxed", text)}>
          {envelope.narrative}
        </p>
      )}

      {events !== undefined && events.length > 0 ? (
        <div className="mt-2">
          <div className="text-muted-foreground text-[10px] font-semibold tracking-[0.14em] uppercase">
            Temporal evidence ({events.length})
          </div>
          <ul className={cn("mt-1 space-y-1.5", text)}>
            {events.map((event) => {
              const scope = TEMPORAL_SCOPE_META[event.scope];
              return (
                <li key={event.id} className="border-border border-l-2 pl-2">
                  <div className="flex flex-wrap items-baseline gap-x-1.5">
                    <span className="font-mono" aria-hidden="true">
                      {scope.glyph}
                    </span>
                    <span className="font-semibold">{scope.label}</span>
                    <span className="text-muted-foreground font-mono">
                      {event.category}
                    </span>
                  </div>
                  {/* The three dates are printed on separate lines, always
                      labelled. Collapsing them is how a publication date turns
                      into a construction date in a reader's head. */}
                  <p className="text-muted-foreground mt-0.5 leading-relaxed">
                    {event.latestDate === undefined
                      ? "Estimated site date: none recorded."
                      : event.bestSupportedDate === undefined
                        ? `Existed by ${event.latestDate}; earliest date unknown.`
                        : `Date: ${event.bestSupportedDate}.`}
                  </p>
                  <p className="text-muted-foreground leading-relaxed">
                    Evidence published:{" "}
                    {event.publicationDate ?? "not stated by the source"}.
                  </p>
                  <p className="text-muted-foreground leading-relaxed">
                    Entered this model:{" "}
                    {event.modelVersionIntroduced ?? "not recorded by this repository"}.
                  </p>
                  {event.analystNote === undefined ? null : (
                    <p className="text-muted-foreground mt-0.5 leading-relaxed">
                      {event.analystNote}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
