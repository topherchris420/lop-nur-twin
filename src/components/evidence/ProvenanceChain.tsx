import { useState } from "react";
import { ExternalLink } from "lucide-react";
import {
  PROVENANCE_STEP_META,
  fieldValue,
  provenanceChain,
  type ProvenanceChain as Chain,
  type ProvenanceStep,
} from "@/lib/provenance";
import type { EvidenceRecord } from "@/lib/evidence";
import { EXTERNAL_LINK_PROPS, safeExternalHref } from "@/lib/safeUrl";
import { cn } from "@/lib/utils";

/**
 * The provenance chain, drawn as a chain.
 *
 * Six links in one direction — claim, evidence, source, date, uncertainty,
 * model decision — so the reasoning can be read forwards (what supports this?)
 * or backwards (what did the model add?). The order is fixed and every record
 * produces all six, which is what lets two chains be compared side by side.
 *
 * A link this project holds nothing for is drawn as a *gap*: dashed, labelled,
 * and still occupying its position in the chain. That is the opposite of the
 * usual instinct to omit empty rows, and it is deliberate — for most subjects
 * here the interesting part of the provenance is which links are missing, and a
 * chain that quietly closes over its gaps reads as though it had none.
 */

function FieldRow({
  label,
  value,
  detail,
  href,
  compact,
}: {
  label: string;
  value: string;
  detail?: string;
  href?: string;
  compact: boolean;
}) {
  const safeHref = safeExternalHref(href);
  return (
    <div className="grid grid-cols-[minmax(0,7rem)_1fr] gap-x-2 gap-y-0.5">
      <dt className="text-muted-foreground text-[10px] leading-relaxed">{label}</dt>
      <dd className="text-[10px] leading-relaxed">
        {safeHref === undefined ? (
          <span
            className={cn(value === "not recorded" && "text-muted-foreground italic")}
          >
            {value}
          </span>
        ) : (
          <a
            href={safeHref}
            {...EXTERNAL_LINK_PROPS}
            className="text-primary inline-flex items-start gap-1 hover:underline"
          >
            {value}
            <ExternalLink className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        )}
        {compact || detail === undefined ? null : (
          <span className="text-muted-foreground block">{detail}</span>
        )}
      </dd>
    </div>
  );
}

function Step({
  step,
  index,
  compact,
  expanded,
}: {
  step: ProvenanceStep;
  index: number;
  compact: boolean;
  expanded: boolean;
}) {
  const meta = PROVENANCE_STEP_META[step.id];
  return (
    <li
      className={cn(
        "relative pl-5",
        // The connector line between links. It stops before the last step so the
        // chain reads as ending rather than running off.
        index < 5 &&
          "before:bg-border before:absolute before:top-4 before:bottom-0 before:left-[0.3125rem] before:w-px",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute top-1 left-0 inline-flex size-2.5 rounded-full border",
          step.hollow
            ? "border-muted-foreground border-dashed"
            : "border-primary bg-primary/70",
        )}
      />
      <div className="flex flex-wrap items-baseline gap-x-1.5">
        <span className="text-foreground text-[10px] font-semibold tracking-[0.08em] uppercase">
          {meta.label}
        </span>
        <span className="text-muted-foreground text-[9px]">{meta.question}</span>
        {step.hollow ? (
          <span className="text-muted-foreground border-muted-foreground/60 rounded border border-dashed px-1 text-[9px]">
            nothing recorded
          </span>
        ) : null}
      </div>
      <p className="text-muted-foreground mt-0.5 text-[10px] leading-relaxed">
        {step.summary}
      </p>
      {expanded ? (
        <dl className="mt-1.5 space-y-1">
          {step.fields.map((field) => (
            <FieldRow
              key={field.label}
              label={field.label}
              value={fieldValue(field)}
              {...(field.detail === undefined ? {} : { detail: field.detail })}
              {...(field.href === undefined ? {} : { href: field.href })}
              compact={compact}
            />
          ))}
        </dl>
      ) : null}
    </li>
  );
}

export function ProvenanceChainView({
  chain,
  compact = false,
  defaultExpanded = false,
  className,
}: {
  chain: Chain;
  compact?: boolean;
  defaultExpanded?: boolean;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const bodyId = `provenance-${chain.recordId}`;

  return (
    <div className={className}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-muted-foreground text-[9px] leading-relaxed">
          {chain.hollowSteps.length === 0
            ? "All six links carry something."
            : `${chain.hollowSteps.length} of 6 links carry nothing: ${chain.hollowSteps
                .map((id) => PROVENANCE_STEP_META[id].label.toLowerCase())
                .join(", ")}.`}
        </p>
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          aria-controls={bodyId}
          className="border-border hover:bg-accent focus-visible:ring-ring shrink-0 rounded border px-1.5 py-0.5 text-[9px] focus-visible:ring-2 focus-visible:outline-none"
        >
          {expanded ? "Less" : "Every field"}
        </button>
      </div>
      <ol id={bodyId} className="mt-2 space-y-2">
        {chain.steps.map((step, index) => (
          <Step
            key={step.id}
            step={step}
            index={index}
            compact={compact}
            expanded={expanded}
          />
        ))}
      </ol>
    </div>
  );
}

/** The chain for one record, built here so callers pass a record, not a chain. */
export function RecordProvenance({
  record,
  compact = false,
  className,
}: {
  record: EvidenceRecord;
  compact?: boolean;
  className?: string;
}) {
  return (
    <ProvenanceChainView
      chain={provenanceChain(record)}
      compact={compact}
      {...(className === undefined ? {} : { className })}
    />
  );
}
