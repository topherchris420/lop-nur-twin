/**
 * Shared evidence presentation.
 *
 * One place decides how an evidence classification, a confidence value and a
 * provenance footer look, so the 3D dossier, the research panel and the
 * accessible analysis table cannot drift into describing the same record
 * three different ways.
 *
 * Two accessibility rules are enforced here rather than left to each caller:
 *
 * - **Status is never carried by colour alone** (WCAG 1.4.1). Every badge
 *   pairs its tint with a glyph *and* a word, and the glyph is
 *   `aria-hidden` so a screen reader announces the word once.
 * - **Confidence is a number and a rank in text**, not a bar. "0.55 (medium)"
 *   survives a monochrome print-out, a screen reader and a colour-blind
 *   reviewer identically.
 */

import {
  EVIDENCE_CLASSIFICATION_META,
  EVIDENCE_CLASSIFICATIONS,
  PRIMARY_CRS,
  confidenceRank,
  type EvidenceClassification,
} from "@/lib/evidence";
import { cn } from "@/lib/utils";

/**
 * Tints are a secondary cue only. They are deliberately muted so the label
 * carries the meaning, and each pairs a border with a light foreground for
 * contrast against the dark panel background.
 */
const CLASSIFICATION_STYLES: Record<EvidenceClassification, string> = {
  observed: "border-emerald-400/45 text-emerald-100",
  reported: "border-sky-400/45 text-sky-100",
  interpreted: "border-amber-400/45 text-amber-100",
  illustrative: "border-zinc-400/45 text-zinc-100",
};

export function EvidenceBadge({
  classification,
  className,
}: {
  classification: EvidenceClassification;
  className?: string;
}) {
  const meta = EVIDENCE_CLASSIFICATION_META[classification];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] leading-tight font-medium",
        CLASSIFICATION_STYLES[classification],
        className,
      )}
      title={meta.statement}
    >
      <span aria-hidden="true">{meta.glyph}</span>
      <span>{meta.label}</span>
    </span>
  );
}

/** "0.55 (medium)" — text first, with the glyph as a redundant cue. */
export function ConfidenceValue({
  confidence,
  className,
}: {
  confidence: number;
  className?: string;
}) {
  const rank = confidenceRank(confidence);
  return (
    <span className={cn("font-mono tabular-nums", className)}>
      <span aria-hidden="true">{rank === "high" ? "●●●" : rank === "medium" ? "●●○" : "●○○"} </span>
      {confidence.toFixed(2)} ({rank})
    </span>
  );
}

/**
 * The full legend, as a description list: the term is the status, the
 * definition is what this project means by it. Every group carries both a
 * `<dt>` and a `<dd>` in either density, which is what the markup rule
 * requires and what makes it read correctly to a screen reader.
 */
export function EvidenceLegendList({ compact = false }: { compact?: boolean }) {
  return (
    <dl className="space-y-2">
      {EVIDENCE_CLASSIFICATIONS.map((classification) => {
        const meta = EVIDENCE_CLASSIFICATION_META[classification];
        return (
          <div key={classification}>
            <dt>
              <EvidenceBadge classification={classification} />
            </dt>
            <dd className="text-muted-foreground mt-1 text-[11px] leading-relaxed">
              {meta.statement}
              {compact ? null : <span className="block">{meta.description}</span>}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/**
 * The standing disclaimer. Every analytical surface carries it so no view of
 * this model can be screenshotted without the caveat attached.
 */
export function ProvenanceFooter({ className }: { className?: string }) {
  return (
    <p className={cn("text-muted-foreground text-[10px] leading-relaxed", className)}>
      Public-source analytical reconstruction · modeled geometry in {PRIMARY_CRS} ·
      approximate coordinates · not operational data · not verified interior use.
    </p>
  );
}
