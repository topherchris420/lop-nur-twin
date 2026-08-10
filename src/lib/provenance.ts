/**
 * The provenance chain: claim → evidence → source → date → uncertainty → model decision.
 *
 * Clicking a building in the scene used to open a dossier that listed evidence
 * records. Everything a reviewer needed was in there, and the one thing it did
 * not do was show the *shape* of the reasoning: that a sentence on screen is
 * downstream of a classification, which is downstream of a publication, which
 * carries a date that is not the date of the thing it describes, which leaves a
 * residue of things nobody knows, which this project then filled in with a
 * decision of its own.
 *
 * This module turns one evidence record into those six links, in order, so the
 * chain can be read forwards (what supports this?) or backwards (what did the
 * model add?). It computes nothing new. Every value is copied from the ledger,
 * the source register, the uncertainty envelope or the defensibility verdict,
 * and a link with nothing behind it says so rather than being dropped — a
 * missing link is the most informative part of most chains here.
 *
 * The three dates stay in three separate links' worth of fields, per the
 * project rule that they are never merged: when something was true of the site,
 * when the evidence became public, and when the change entered this model. The
 * third is unrecorded throughout this repository, and the chain prints that.
 */

import {
  EVIDENCE_CLASSIFICATION_META,
  MODEL_INTERNAL_SOURCE_ID,
  formatConfidence,
  type EvidenceRecord,
} from "./evidence";
import {
  UNCERTAINTY_BASIS_LABELS,
  UNCERTAINTY_LEVEL_META,
  formatTemporalBound,
  formatUncertainty,
  type UncertaintyEnvelope,
} from "./uncertainty";
import {
  DEFENSIBILITY_META,
  MODELED_ATTRIBUTE_META,
  getDefensibility,
} from "./forensics";
import { getStructure } from "./layout";

/* ------------------------------------------------------------------ */
/* Schema                                                              */
/* ------------------------------------------------------------------ */

export type ProvenanceStepId =
  "claim" | "evidence" | "source" | "date" | "uncertainty" | "model-decision";

export const PROVENANCE_STEP_IDS: readonly ProvenanceStepId[] = [
  "claim",
  "evidence",
  "source",
  "date",
  "uncertainty",
  "model-decision",
];

export const PROVENANCE_STEP_META: Record<
  ProvenanceStepId,
  { label: string; glyph: string; question: string }
> = {
  claim: {
    label: "Claim",
    // Glyphs are decorative and always paired with the label, so a step is
    // never identified by colour or symbol alone (WCAG 1.4.1).
    glyph: "①",
    question: "What is being asserted?",
  },
  evidence: {
    label: "Evidence",
    glyph: "②",
    question: "What kind of support stands behind it?",
  },
  source: {
    label: "Source",
    glyph: "③",
    question: "Who published it, and can it be checked?",
  },
  date: {
    label: "Date",
    glyph: "④",
    question: "When — at the site, in public, and in this model?",
  },
  uncertainty: {
    label: "Uncertainty",
    glyph: "⑤",
    question: "How wrong could it be?",
  },
  "model-decision": {
    label: "Model decision",
    glyph: "⑥",
    question: "What did this project add that the source does not carry?",
  },
};

/** A row inside a chain step: a labelled value that may legitimately be absent. */
export interface ProvenanceField {
  label: string;
  /** The value, already formatted. `undefined` renders as "not recorded". */
  value?: string;
  /** Longer explanation, shown under the value where a surface has room. */
  detail?: string;
  /** An external URL, when the field points at something checkable. */
  href?: string;
}

export interface ProvenanceStep {
  id: ProvenanceStepId;
  /** The one-line answer to this step's question. */
  summary: string;
  fields: readonly ProvenanceField[];
  /**
   * True when this project holds nothing for the step. A chain with a hollow
   * link is the normal case here and the interface draws it as a gap rather
   * than closing over it.
   */
  hollow: boolean;
}

export interface ProvenanceChain {
  recordId: string;
  subjectId: string;
  steps: readonly ProvenanceStep[];
  /** Links this project holds nothing for, in chain order. */
  hollowSteps: readonly ProvenanceStepId[];
}

/* ------------------------------------------------------------------ */
/* Derivation                                                          */
/* ------------------------------------------------------------------ */

const NOT_RECORDED = "not recorded";

function claimStep(record: EvidenceRecord): ProvenanceStep {
  return {
    id: "claim",
    summary: record.claim,
    fields: [
      { label: "Subject", value: record.subjectId },
      { label: "Subject kind", value: record.subjectKind },
      {
        label: "Coordinate frame",
        value: record.coordinateReferenceSystem,
        detail:
          record.coordinateReferenceSystem === undefined
            ? "This claim is not a positional one, so it carries no coordinate frame."
            : undefined,
      },
    ],
    hollow: false,
  };
}

function evidenceStep(record: EvidenceRecord): ProvenanceStep {
  const meta = EVIDENCE_CLASSIFICATION_META[record.classification];
  return {
    id: "evidence",
    summary: meta.statement,
    fields: [
      { label: "Classification", value: meta.label, detail: meta.description },
      {
        label: "Confidence",
        value: formatConfidence(record.confidence),
        detail:
          "A project-assigned ordinal rank published on a 0-1 scale, not a measured probability.",
      },
      {
        label: "Source resolution",
        value:
          record.sourceResolutionM === undefined
            ? undefined
            : `${record.sourceResolutionM} m ground sample distance`,
        detail:
          record.sourceResolutionM === undefined
            ? "The cited source states no ground sample distance, or is not imagery."
            : "Nothing smaller than one pixel of the cited scene is resolved by it.",
      },
    ],
    hollow: false,
  };
}

function sourceStep(record: EvidenceRecord): ProvenanceStep {
  const internal = record.sourceId === MODEL_INTERNAL_SOURCE_ID;
  return {
    id: "source",
    summary: internal
      ? "This repository is the source. Nothing external is cited, because there is nothing external to cite."
      : record.sourceTitle,
    fields: [
      { label: "Title", value: record.sourceTitle },
      { label: "Publisher", value: record.sourcePublisher },
      {
        label: "Link",
        value: record.sourceUrl === undefined ? undefined : "open the cited source",
        ...(record.sourceUrl === undefined ? {} : { href: record.sourceUrl }),
        detail: internal
          ? "Procedural content authored here. Attributing it to a publisher would be a fabricated citation."
          : undefined,
      },
      {
        label: "Content hash",
        value: record.sourceHash,
        detail:
          "Deliberately absent everywhere: the build fetches nothing, so there is no retrieved artifact to hash. Provenance is pinned by citation and access date instead.",
      },
    ],
    hollow: internal,
  };
}

/**
 * The three dates, kept apart.
 *
 * `latestDate` on the envelope is a bound on the *site* — the day a cited scene
 * proves the thing already existed — and is printed through
 * `formatTemporalBound` so it can never be read as a construction date. The
 * publication date is a fact about the evidence. The model-entry date is a fact
 * about this repository and is not recorded for any subject, which is why the
 * step is hollow whenever the other two are all this project holds.
 */
function dateStep(record: EvidenceRecord): ProvenanceStep {
  const envelope = record.uncertainty;
  const siteBound = envelope === undefined ? "not stated" : formatTemporalBound(envelope);
  const hasSiteDate = siteBound !== "not stated";

  return {
    id: "date",
    summary: hasSiteDate
      ? `Site: ${siteBound}. Evidence published ${record.sourceDate ?? "unknown"}.`
      : `No date bounds the site claim. Evidence published ${record.sourceDate ?? "unknown"}.`,
    fields: [
      {
        label: "Site event",
        value: hasSiteDate ? siteBound : undefined,
        detail:
          "Imagery bounds when something existed by, never when it was built. The earlier end of the range is almost always unknown.",
      },
      {
        label: "Evidence published",
        value: record.sourceDate,
        detail:
          "When the source became publicly available. It is not a claim that anything at the site happened on this date.",
      },
      {
        label: "Source last consulted",
        value: record.accessedAt,
        detail: "When this project last read the source.",
      },
      {
        label: "Entered this model",
        value: undefined,
        detail:
          "This repository has never recorded per-feature model history, so the date a claim entered the model is unknown. It is left blank rather than filled with the current release, which would be a guess dressed as provenance.",
      },
    ],
    hollow: !hasSiteDate && record.sourceDate === undefined,
  };
}

function uncertaintyStep(envelope: UncertaintyEnvelope | undefined): ProvenanceStep {
  if (envelope === undefined) {
    return {
      id: "uncertainty",
      summary: "No uncertainty envelope is recorded for this claim.",
      fields: [
        {
          label: "Envelope",
          value: undefined,
          detail: "Absent means unknown, not zero.",
        },
      ],
      hollow: true,
    };
  }

  const numeric = formatUncertainty(envelope);
  return {
    id: "uncertainty",
    summary: `Position and extent: ${numeric}. Identification ${envelope.identification}, function ${envelope.function}.`,
    fields: [
      {
        label: "Positional / extent",
        value: numeric === "not stated" ? undefined : numeric,
        detail:
          numeric === "not stated"
            ? "This project documents no distance for this claim, so none is drawn or printed."
            : undefined,
      },
      {
        label: "Height",
        value:
          envelope.heightMeters === undefined ? undefined : `±${envelope.heightMeters} m`,
        detail:
          "Never populated anywhere in this model: no cited source states a height tolerance for anything at this site.",
      },
      {
        label: "Orientation",
        value:
          envelope.orientationDegrees === undefined
            ? undefined
            : `±${envelope.orientationDegrees}°`,
        detail: "Never populated: no cited source states an orientation tolerance.",
      },
      {
        label: "Identification",
        value: UNCERTAINTY_LEVEL_META[envelope.identification].label,
        detail: UNCERTAINTY_LEVEL_META[envelope.identification].description,
      },
      {
        label: "Function",
        value: UNCERTAINTY_LEVEL_META[envelope.function].label,
        detail: UNCERTAINTY_LEVEL_META[envelope.function].description,
      },
      {
        label: "Basis",
        value:
          envelope.basis === undefined
            ? undefined
            : UNCERTAINTY_BASIS_LABELS[envelope.basis],
        detail: envelope.method,
      },
      {
        label: "Sources disagree",
        value: envelope.sourceDisagreement === true ? "yes" : undefined,
        detail:
          envelope.sourceDisagreement === true
            ? undefined
            : "No two cited sources are recorded as disagreeing about this claim.",
      },
      {
        label: "Project caveat",
        value: envelope.narrative,
      },
    ],
    hollow: false,
  };
}

/**
 * The last link: what the reconstruction draws that no source carries.
 *
 * This is the step the whole chain exists for. It reads the defensibility
 * verdict rather than restating the evidence, so the sentence a reviewer ends
 * on is a list of the attributes this project supplied itself.
 */
function modelDecisionStep(record: EvidenceRecord): ProvenanceStep {
  const verdict = getDefensibility(record.subjectId);
  const structure = getStructure(record.subjectId);
  const strippedLabels =
    verdict === undefined
      ? []
      : verdict.stripped.map((attribute) =>
          MODELED_ATTRIBUTE_META[attribute].label.toLowerCase(),
        );

  const summary =
    verdict === undefined
      ? "This subject carries no rendered geometry, so there is no geometric modeling decision to declare."
      : `${DEFENSIBILITY_META[verdict.level].verdict}. Supplied by this project: ${
          strippedLabels.length === 0 ? "nothing" : strippedLabels.join(", ")
        }.`;

  return {
    id: "model-decision",
    summary,
    fields: [
      {
        label: "Model basis",
        value: structure?.modelBasis,
        detail:
          structure === undefined
            ? "Not a structure record, so the layout declares no model basis for it."
            : undefined,
      },
      {
        label: "Method",
        value: record.analystNotes,
      },
      {
        label: "Defensibility",
        value:
          verdict === undefined ? undefined : DEFENSIBILITY_META[verdict.level].label,
        detail:
          verdict === undefined
            ? undefined
            : DEFENSIBILITY_META[verdict.level].description,
      },
      {
        label: "Defended by the source",
        value:
          verdict === undefined || verdict.defended.length === 0
            ? undefined
            : verdict.defended
                .map((attribute) => MODELED_ATTRIBUTE_META[attribute].label.toLowerCase())
                .join(", "),
        detail:
          verdict !== undefined && verdict.defended.length === 0
            ? "Nothing cited defends any attribute of this subject."
            : undefined,
      },
      {
        label: "Supplied by this project",
        value: strippedLabels.length === 0 ? undefined : strippedLabels.join(", "),
      },
      {
        label: "Superseded record",
        value: record.supersedes,
        detail:
          record.supersedes === undefined
            ? "This record has never been revised."
            : undefined,
      },
    ],
    hollow: verdict === undefined && structure === undefined,
  };
}

/**
 * The chain for one evidence record.
 *
 * Pure and total: every record produces six steps in the same order, and a step
 * with nothing behind it is marked hollow rather than omitted, so two chains
 * always line up side by side.
 */
export function provenanceChain(record: EvidenceRecord): ProvenanceChain {
  const steps: readonly ProvenanceStep[] = [
    claimStep(record),
    evidenceStep(record),
    sourceStep(record),
    dateStep(record),
    uncertaintyStep(record.uncertainty),
    modelDecisionStep(record),
  ];
  return {
    recordId: record.id,
    subjectId: record.subjectId,
    steps,
    hollowSteps: steps.filter((step) => step.hollow).map((step) => step.id),
  };
}

/** A field's printable value, with the project's standing wording for absence. */
export function fieldValue(field: ProvenanceField): string {
  return field.value === undefined || field.value.length === 0
    ? NOT_RECORDED
    : field.value;
}

/**
 * The chain as plain text, for the clipboard and for a reviewer pasting a
 * finding into a document. Deterministic: the same record always renders the
 * same bytes.
 */
export function chainToText(chain: ProvenanceChain): string {
  const lines: string[] = [`Provenance chain for ${chain.recordId}`];
  for (const step of chain.steps) {
    const meta = PROVENANCE_STEP_META[step.id];
    lines.push("", `${meta.label} — ${meta.question}`, `  ${step.summary}`);
    for (const field of step.fields) {
      lines.push(`  - ${field.label}: ${fieldValue(field)}`);
    }
  }
  return lines.join("\n");
}
