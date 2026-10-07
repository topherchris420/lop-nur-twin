import { Fragment, useEffect, useMemo } from "react";
import { Link } from "@tanstack/react-router";
import {
  EVIDENCE_CLASSIFICATION_META,
  getEvidenceForSubject,
  strongestClassification,
  type EvidenceSubjectKind,
} from "@/lib/evidence";
import { CLAIM_SUBJECT_IDS, claimSubjectLabel, inspectClaim } from "@/lib/claims";
import { isSubjectVisible, type EvidenceMode } from "@/lib/evidenceMode";
import { STRUCTURES } from "@/lib/layout";
import { modelEntryCells } from "@/lib/modelHistory";
import { temporalEventsForSubject } from "@/lib/temporal";
import { ClaimInspector } from "@/components/evidence/ClaimInspector";
import { ConfidenceValue, EvidenceBadge } from "@/components/evidence/EvidenceUi";

/**
 * Every claim that is not about a building, with the same inspector.
 *
 * The structure table is where most of the model is, but it is not where the
 * model's strongest claims are: the only observed claims in the ledger are the
 * runway measurements and the site's reference coordinate, and before this
 * table they appeared nowhere on this page. Pavements, the terrain proxy, the
 * climatology, off-site context and the illustrative scenario elements are
 * claims too — mostly claims that something is *not* evidence — and each
 * answers the same questions here as a hangar does.
 */

const KIND_ORDER: readonly EvidenceSubjectKind[] = [
  "measurement",
  "context",
  "pavement",
  "terrain",
  "environment",
  "simulation",
];

const KIND_LABELS: Partial<Record<EvidenceSubjectKind, string>> = {
  measurement: "Measurement",
  context: "Site and context",
  pavement: "Pavement",
  terrain: "Terrain",
  environment: "Environment",
  simulation: "Scenario element",
};

const STRUCTURE_IDS: ReadonlySet<string> = new Set(STRUCTURES.map((s) => s.id));

interface Row {
  subjectId: string;
  label: string;
  kind: EvidenceSubjectKind;
}

const ROWS: readonly Row[] = CLAIM_SUBJECT_IDS.filter((id) => !STRUCTURE_IDS.has(id))
  .map((subjectId): Row => {
    const kind = getEvidenceForSubject(subjectId)[0]?.subjectKind ?? "context";
    return { subjectId, label: claimSubjectLabel(subjectId), kind };
  })
  .sort((left, right) => {
    const order = KIND_ORDER.indexOf(left.kind) - KIND_ORDER.indexOf(right.kind);
    return order !== 0 ? order : left.label.localeCompare(right.label);
  });

export function ClaimList({
  open,
  evidenceMode,
  snapshotDate,
}: {
  /** The subject whose inspector is open (`?claim=`), if any. */
  open: string | undefined;
  evidenceMode: EvidenceMode;
  snapshotDate: string | null;
}) {
  // The table lists what the evidence mode admits, as the structure table does.
  const rows = useMemo(
    () => ROWS.filter((row) => isSubjectVisible(row.subjectId, evidenceMode)),
    [evidenceMode],
  );

  useEffect(() => {
    if (open === undefined) return;
    const row = document.getElementById(`claim-row-${open}`);
    if (row === null) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    row.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
  }, [open]);

  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[52rem] border-collapse text-left text-xs">
        <caption className="text-muted-foreground pb-3 text-left text-xs">
          Every claim this model makes that is not about a structure, grouped by kind.
          Measurements are the only claims here observed in a cited scene; most of the
          rest say that something is a proxy or an illustration.
        </caption>
        <thead>
          <tr className="border-border border-b">
            <th scope="col" className="px-2 py-2 font-semibold">
              Subject
            </th>
            <th scope="col" className="px-2 py-2 font-semibold">
              Kind
            </th>
            <th scope="col" className="px-2 py-2 font-semibold">
              Evidence status
            </th>
            <th scope="col" className="px-2 py-2 font-semibold">
              Confidence
            </th>
            <th scope="col" className="px-2 py-2 font-semibold">
              In this model
            </th>
            <th scope="col" className="px-2 py-2 font-semibold">
              Inspect
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const records = getEvidenceForSubject(row.subjectId);
            const classification = strongestClassification(records) ?? "illustrative";
            const confidence = records.reduce(
              (best, record) => Math.max(best, record.confidence),
              0,
            );
            const history = modelEntryCells(row.subjectId);
            const isOpen = open === row.subjectId;
            const claim = isOpen ? inspectClaim(row.subjectId, snapshotDate) : undefined;
            return (
              <Fragment key={row.subjectId}>
                <tr
                  id={`claim-row-${row.subjectId}`}
                  className={
                    isOpen
                      ? "border-border bg-accent/40 border-b align-top"
                      : "border-border border-b align-top"
                  }
                >
                  <th scope="row" className="px-2 py-3 text-left font-medium">
                    {row.label}
                    <span className="text-muted-foreground block font-mono text-[10px] font-normal">
                      {row.subjectId}
                    </span>
                  </th>
                  <td className="px-2 py-3">{KIND_LABELS[row.kind] ?? row.kind}</td>
                  <td className="px-2 py-3">
                    <EvidenceBadge classification={classification} />
                    <span className="text-muted-foreground mt-1 block text-[10px]">
                      {EVIDENCE_CLASSIFICATION_META[classification].statement}
                    </span>
                  </td>
                  <td className="px-2 py-3">
                    <ConfidenceValue confidence={confidence} />
                  </td>
                  <td className="px-2 py-3 font-mono text-[10px] whitespace-nowrap">
                    {history === null ? (
                      "not recorded"
                    ) : (
                      <>
                        <span className="block">entered {history.entered}</span>
                        <span className="text-muted-foreground block">
                          last change {history.lastChange}
                        </span>
                      </>
                    )}
                  </td>
                  <td className="px-2 py-3">
                    {isOpen ? (
                      <span className="text-muted-foreground">Open below</span>
                    ) : (
                      <Link
                        to="/analysis"
                        search={(previous) => ({ ...previous, claim: row.subjectId })}
                        replace
                        className="border-border hover:bg-accent focus-visible:ring-ring block rounded border px-2 py-1 whitespace-nowrap focus-visible:ring-2 focus-visible:outline-none"
                      >
                        Inspect claim
                        <span className="sr-only"> — {row.label}</span>
                      </Link>
                    )}
                  </td>
                </tr>
                {claim === undefined ? null : (
                  <tr className="border-border bg-accent/20 border-b">
                    <td colSpan={6} className="px-4 py-4">
                      <section aria-labelledby="claim-list-heading" className="max-w-4xl">
                        <h3 id="claim-list-heading" className="text-base font-semibold">
                          Claim inspector: {claim.label}
                        </h3>
                        <div className="mt-3">
                          <ClaimInspector
                            claim={claim}
                            events={temporalEventsForSubject(row.subjectId)}
                            density="comfortable"
                            headingLevel={4}
                            idPrefix="claim-list"
                          />
                        </div>
                      </section>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      {rows.length === 0 ? (
        <p className="text-muted-foreground py-6 text-center text-sm">
          The evidence mode admits none of these claims.
        </p>
      ) : null}
    </div>
  );
}
