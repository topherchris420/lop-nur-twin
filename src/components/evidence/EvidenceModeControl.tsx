import { ALL_SEGMENTS, APRONS, STRUCTURES } from "@/lib/layout";
import {
  EVIDENCE_MODES,
  EVIDENCE_MODE_META,
  describeEvidenceMode,
  type EvidenceMode,
} from "@/lib/evidenceMode";
import { cn } from "@/lib/utils";

/**
 * The evidence-mode picker, shared by the 3D HUD and `/analysis`.
 *
 * It is a radio group rather than four buttons because the modes are mutually
 * exclusive and nested, and a radio group is what a screen reader announces as
 * "1 of 4". Arrow keys move between options for free.
 *
 * Two accessibility rules are enforced here rather than left to each caller:
 * the active mode is always announced as *text* alongside its glyph, never by
 * highlight alone; and the readout below the group states how many subjects the
 * mode is currently withholding. A filter that silently subtracts from a scene
 * is a way to mislead yourself, so the subtraction is always on screen.
 */

/** Every subject a mode can filter — the same list the readout counts against. */
export const FILTERABLE_SUBJECT_IDS: readonly string[] = [
  ...STRUCTURES.map((structure) => structure.id),
  ...ALL_SEGMENTS.map((segment) => segment.id),
  ...APRONS.map((apron) => apron.id),
];

export function EvidenceModeControl({
  mode,
  onChange,
  density = "comfortable",
  className,
  idPrefix = "evidence-mode",
}: {
  mode: EvidenceMode;
  onChange: (mode: EvidenceMode) => void;
  density?: "comfortable" | "compact";
  className?: string;
  idPrefix?: string;
}) {
  const compact = density === "compact";
  return (
    <div className={className}>
      <fieldset>
        <legend
          className={cn(
            "font-semibold",
            compact
              ? "text-muted-foreground text-[10px] tracking-[0.18em] uppercase"
              : "text-sm",
          )}
        >
          Evidence mode
        </legend>
        <div className={cn("mt-2 flex flex-wrap", compact ? "gap-1.5" : "gap-3")}>
          {EVIDENCE_MODES.map((candidate) => {
            const meta = EVIDENCE_MODE_META[candidate];
            const active = candidate === mode;
            return (
              <label
                key={candidate}
                className={cn(
                  "focus-within:ring-ring inline-flex cursor-pointer items-center gap-1.5 rounded border px-2 py-1 focus-within:ring-2",
                  compact ? "text-[10px]" : "text-xs",
                  active
                    ? "border-primary/70 bg-accent/60 text-foreground"
                    : "border-border text-muted-foreground hover:bg-accent/40",
                )}
                title={meta.description}
              >
                <input
                  type="radio"
                  name={idPrefix}
                  value={candidate}
                  checked={active}
                  onChange={() => onChange(candidate)}
                  className="sr-only"
                />
                <span aria-hidden="true">{meta.glyph}</span>
                <span>{compact ? meta.shortLabel : meta.label}</span>
                {/* The check mark is the redundant, non-colour cue that this
                    option is the active one. */}
                <span aria-hidden="true">{active ? "✓" : ""}</span>
              </label>
            );
          })}
        </div>
      </fieldset>
      <p
        role="status"
        className={cn(
          "text-muted-foreground mt-2 leading-relaxed",
          compact ? "text-[10px]" : "text-xs",
        )}
      >
        {describeEvidenceMode(FILTERABLE_SUBJECT_IDS, mode)}
      </p>
      <p
        className={cn(
          "text-muted-foreground mt-1 leading-relaxed",
          compact ? "text-[10px]" : "text-xs",
        )}
      >
        {EVIDENCE_MODE_META[mode].description}
      </p>
    </div>
  );
}
