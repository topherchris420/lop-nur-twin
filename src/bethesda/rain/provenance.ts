/**
 * Both sides' revision identity, recorded with every session and experiment.
 *
 * Unknown is recorded as `null` with the reason in `*_source`, never guessed:
 * a local build that cannot read git records no commit; an OFFLINE session
 * records no james_library revision. The lop-nur-twin revision is baked in at
 * build time (`vite.config.ts`, `__LAB_REVISION__`): from the CI environment
 * when it says, otherwise from the checkout's own `git` with its dirty state.
 */
import { DATA_VERSION } from "../model";
import { REPLAY_SCHEMA, SIM_VERSION } from "../simulation";
import { TERRAIN_VERSION } from "../terrain";
import { TRANSIT_VERSION } from "../streetscape";
import {
  COMMIT,
  DEFINITION_SCHEMA,
  RAIN_BETHESDA_SCHEMA,
  WORLD_OBSERVATION_SCHEMA,
  type RainRevision,
} from "./contracts";

export interface LabRevision {
  commit: string | null;
  dirty: boolean | null;
  source: "ci" | "git" | "unknown";
}
export function labRevision(): LabRevision {
  const baked: unknown = typeof __LAB_REVISION__ === "object" ? __LAB_REVISION__ : null;
  const r = baked as Partial<LabRevision> | null;
  if (
    r &&
    typeof r.commit === "string" &&
    COMMIT.test(r.commit) &&
    (r.source === "ci" || r.source === "git") &&
    (r.dirty === null || typeof r.dirty === "boolean")
  )
    return { commit: r.commit, dirty: r.dirty ?? null, source: r.source };
  return { commit: null, dirty: null, source: "unknown" };
}

export interface Provenance {
  james_library_repository: "topherchris420/james_library";
  james_library_commit: string | null;
  james_library_dirty: boolean | null;
  /** Where the R.A.I.N. revision came from. */
  james_library_source: "live-identity" | "demo-recording" | "unavailable";
  lop_nur_twin_repository: "topherchris420/lop-nur-twin";
  lop_nur_twin_commit: string | null;
  lop_nur_twin_dirty: boolean | null;
  lop_nur_twin_source: LabRevision["source"];
  rain_contract: typeof RAIN_BETHESDA_SCHEMA;
  bethesda_contract: typeof WORLD_OBSERVATION_SCHEMA;
  experiment_schema: typeof DEFINITION_SCHEMA;
  replay_schema: typeof REPLAY_SCHEMA;
  sim_version: typeof SIM_VERSION;
  bethesda_map_sha256: string;
  streetscape_sha256: string;
  terrain_sha256: string;
  /** Only when a model produced something in this record; otherwise null. */
  provider: string | null;
  model: string | null;
  seeds: number[];
  recorded_at: string;
}

export function provenance(input: {
  rain: RainRevision | null;
  rainSource: Provenance["james_library_source"];
  model: string | null;
  seeds: number[];
  now: Date;
}): Provenance {
  const lab = labRevision();
  return {
    james_library_repository: "topherchris420/james_library",
    james_library_commit: input.rain?.commit ?? null,
    james_library_dirty: input.rain?.dirty ?? null,
    james_library_source: input.rain ? input.rainSource : "unavailable",
    lop_nur_twin_repository: "topherchris420/lop-nur-twin",
    lop_nur_twin_commit: lab.commit,
    lop_nur_twin_dirty: lab.dirty,
    lop_nur_twin_source: lab.source,
    rain_contract: RAIN_BETHESDA_SCHEMA,
    bethesda_contract: WORLD_OBSERVATION_SCHEMA,
    experiment_schema: DEFINITION_SCHEMA,
    replay_schema: REPLAY_SCHEMA,
    sim_version: SIM_VERSION,
    bethesda_map_sha256: DATA_VERSION,
    streetscape_sha256: TRANSIT_VERSION,
    terrain_sha256: TERRAIN_VERSION,
    provider: input.model ? "rain" : null,
    model: input.model,
    seeds: [...input.seeds],
    recorded_at: input.now.toISOString(),
  };
}
