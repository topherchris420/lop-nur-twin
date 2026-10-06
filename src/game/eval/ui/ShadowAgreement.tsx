import { useMemo } from "react";
import { AXES } from "../../pilot/contract";
import {
  SHADOW_CAVEAT,
  SHADOW_REFERENCES,
  SHADOW_SCHEMA,
  shadowEpisode,
  summarizeShadow,
  type ShadowSummary,
} from "../shadow";
import type { EpisodeRecords } from "./DecisionTrace";
import { ScrollRegion } from "./ScrollRegion";

/**
 * "Same observations, other minds", as tables.
 *
 * One row per arm and reference policy, one column per control axis. A cell is
 * the share of decisions on which the arm chose what the reference would have
 * chosen from the identical observation, with the exact agreement of a uniform
 * chooser beside it. Text only: a number and its baseline, never a bar.
 */

export interface ShadowArm {
  id: string;
  references: readonly ShadowSummary[];
}

export interface ShadowFile {
  schema: typeof SHADOW_SCHEMA;
  run: string;
  caveat: string;
  arms: readonly ShadowArm[];
}

const pct = (value: number | null): string =>
  value === null ? "—" : `${(value * 100).toFixed(0)}%`;

/**
 * A bundled `shadow.json`, checked before anything is read off it. Bundled at
 * build time from this repository, but checked all the same: the page renders
 * what the validator admits and nothing else.
 */
export function parseShadowFile(value: unknown): ShadowFile | null {
  if (typeof value !== "object" || value === null) return null;
  const file = value as Record<string, unknown>;
  if (file["schema"] !== SHADOW_SCHEMA || !Array.isArray(file["arms"])) return null;
  const arms: ShadowArm[] = [];
  for (const arm of file["arms"] as unknown[]) {
    if (typeof arm !== "object" || arm === null) return null;
    const { id, references } = arm as Record<string, unknown>;
    if (typeof id !== "string" || !Array.isArray(references)) return null;
    for (const reference of references as unknown[]) {
      const summary = reference as Partial<ShadowSummary> | null;
      if (
        summary === null ||
        summary.schema !== SHADOW_SCHEMA ||
        !SHADOW_REFERENCES.includes(summary.reference as never) ||
        !Array.isArray(summary.axes)
      ) {
        return null;
      }
    }
    arms.push({ id, references: references as ShadowSummary[] });
  }
  return {
    schema: SHADOW_SCHEMA,
    run: typeof file["run"] === "string" ? file["run"] : "unknown",
    caveat: SHADOW_CAVEAT,
    arms,
  };
}

export function ShadowTable({
  arms,
  caption,
}: {
  arms: readonly ShadowArm[];
  caption: string;
}) {
  return (
    <ScrollRegion
      label="Agreement with reference policies on identical observations"
      className="overflow-x-auto"
    >
      <table className="w-full min-w-[56rem] border-collapse text-left text-xs">
        <caption className="text-muted-foreground pb-2 text-left text-xs leading-relaxed">
          {caption} Each cell: agreement, then the exact agreement of a uniform chooser
          over the same offered options. &ldquo;—&rdquo; means the axis was never a
          choice.
        </caption>
        <thead>
          <tr className="border-border border-b">
            <th scope="col" className="px-2 py-2 font-semibold">
              Arm
            </th>
            <th scope="col" className="px-2 py-2 font-semibold">
              Reference
            </th>
            <th scope="col" className="px-2 py-2 text-right font-semibold">
              Decisions
            </th>
            {AXES.map((axis) => (
              <th key={axis} scope="col" className="px-2 py-2 text-right font-semibold">
                {axis}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="font-mono">
          {arms.flatMap((arm) =>
            arm.references.map((summary) => (
              <tr
                key={`${arm.id}-${summary.reference}`}
                className="border-border border-b"
              >
                <th scope="row" className="px-2 py-1.5 text-left font-medium">
                  {arm.id}
                </th>
                <td className="px-2 py-1.5">{summary.reference}</td>
                <td className="px-2 py-1.5 text-right">{summary.compared}</td>
                {AXES.map((axis) => {
                  const row = summary.axes.find((candidate) => candidate.axis === axis);
                  return (
                    <td key={axis} className="px-2 py-1.5 text-right whitespace-nowrap">
                      {row === undefined || row.episodes === 0 ? (
                        "—"
                      ) : (
                        <>
                          {pct(row.agreement)}{" "}
                          <span className="text-muted-foreground">
                            ({pct(row.chance)})
                          </span>
                        </>
                      )}
                    </td>
                  );
                })}
              </tr>
            )),
          )}
        </tbody>
      </table>
    </ScrollRegion>
  );
}

/** The same comparison for one opened episode, computed here from its records. */
export function EpisodeShadow({ records }: { records: EpisodeRecords }) {
  const references = useMemo(
    () =>
      SHADOW_REFERENCES.map((reference) =>
        summarizeShadow(reference, [
          shadowEpisode(
            { episodeId: records.episodeId, decisions: records.decisions },
            reference,
          ),
        ]),
      ),
    [records],
  );
  const first = references[0];
  return (
    <div className="mt-6">
      <h3 className="text-base font-semibold">Same observations, other minds</h3>
      <p className="text-muted-foreground mt-1 max-w-4xl text-sm leading-relaxed">
        This episode&rsquo;s observations, shown in order to the scripted reference
        policies. {SHADOW_CAVEAT}
        {first === undefined || first.setAside + first.skipped === 0
          ? ""
          : ` ${first.setAside} fallback or replayed frame(s) set aside; ${first.skipped} record(s) without an observation skipped.`}
      </p>
      <div className="mt-3">
        <ShadowTable
          arms={[{ id: records.brain?.id ?? "this episode", references }]}
          caption={`Episode ${records.episodeId}: one episode, so no interval is shown.`}
        />
      </div>
    </div>
  );
}
