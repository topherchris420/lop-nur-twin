/**
 * The releases the suite can run, by name. The baseline is the deployed
 * configuration unchanged; any other release is an update of it and says how a
 * baseline individual is moved onto it.
 */
import type { LifeKind } from "../life/continuity.js";
import type { Continue } from "./study.js";
import {
  BASELINE,
  BASELINE_KIND,
  type FlyGenesis,
  type Release,
  type ResearchLife,
} from "./yard.js";

export interface RegisteredRelease {
  release: Release;
  kind: LifeKind<FlyGenesis, ResearchLife>;
  /** The release this one updates, and how; absent for the baseline. */
  updates?: { from: string; continueFrom: Continue };
}

export const RELEASES: Readonly<Record<string, RegisteredRelease>> = {
  baseline: { release: BASELINE, kind: BASELINE_KIND },
};
