/**
 * Additive, maintenance-only continuation of an existing ECHO individual.
 * Prepares an in-memory candidate. No store I/O, deployment, or live-runner selection.
 * The existing controller, all synapses, memories and RNG streams remain untouched.
 */
import { sha256 } from "../../../rain/sha256.js";
import {
  checkpointLife,
  restoreLife,
  sameVersions,
  type LifeCheckpoint,
  type LifeKind,
} from "../continuity.js";
import {
  BETHESDA_LIFE,
  type HeadlessBethesdaLife,
  type HeadlessGenesis,
} from "../headless.js";
import { ECHO_UPGRADED_LIFE } from "../echoUpgrade.js";
import { GRAPH_SCHEMA, indexGraph, snapshotGraph } from "../snapshot.js";
import { Physiology, PHYSIOLOGY_VERSION } from "./physiology.js";

export const MAINTENANCE_CONTINUATION = "bethesda-immortal-maintenance/v1";
const EVENT = "immortal-maintenance-upgrade";
export type MaintainedLife = HeadlessBethesdaLife & { maintenance: Physiology };
type SourceKind = LifeKind<HeadlessGenesis, HeadlessBethesdaLife>;

function sourceKind(checkpoint: LifeCheckpoint<HeadlessGenesis>): SourceKind {
  for (const kind of [BETHESDA_LIFE, ECHO_UPGRADED_LIFE])
    if (sameVersions(checkpoint.versions, { ...kind.versions, graph: GRAPH_SCHEMA }))
      return kind;
  // GRAPH_SCHEMA is checked by restoreLife; no untrusted version can bypass it.
  throw new Error(
    "maintenance continuation requires an exact supported current-engine checkpoint",
  );
}

export function maintenanceKind(
  source: SourceKind,
): LifeKind<HeadlessGenesis, MaintainedLife> {
  const versions = {
    ...source.versions,
    maintenance: MAINTENANCE_CONTINUATION,
    physiology: PHYSIOLOGY_VERSION,
  };
  return {
    id: source.id,
    versions,
    build: (g) => Object.assign(source.build(g), { maintenance: new Physiology(true) }),
    tick: source.tick,
    hash: (life) => `${source.hash(life)}|${JSON.stringify(life.maintenance.state)}`,
    step: (life, ticks) => {
      if (!Number.isSafeInteger(ticks) || ticks < 0)
        throw new Error("invalid maintenance tick count");
      for (let i = 0; i < ticks; i++) {
        const fly = life.cityFly.fly;
        fly.state.reserve += life.maintenance.advance(0.1, {
          mode: fly.state.mode,
          reserve: fly.state.reserve,
          capacity: fly.params.reserveJ,
        });
        life.advanceTicks(1);
      }
    },
    history: {
      versions: [...(source.history?.versions ?? []), source.versions],
      transition: (previous, next) => {
        const was = previous && "maintenance" in previous.versions;
        const now = "maintenance" in next.versions;
        if (!now) {
          if (was) return ["maintenance continuation cannot silently downgrade"];
          return source.history?.transition(previous, next) ?? [];
        }
        if (!previous) return ["maintenance is a continuation, never a new birth"];
        const events = next.events.filter((e) => e.kind === EVENT);
        if (was) return events.length ? ["maintenance upgrade cannot be repeated"] : [];
        const e = events[0];
        const d = e?.data;
        return events.length === 1 &&
          e?.tick === previous.tick &&
          next.tick === previous.tick &&
          d?.migration === MAINTENANCE_CONTINUATION &&
          d.parent === previous.digest &&
          d.sourceGraphDigest === previous.graphDigest &&
          d.preservedGraphDigest === previous.graphDigest &&
          typeof d.pausedFromUtc === "string" &&
          typeof d.preparedUtc === "string" &&
          Number.isFinite(Date.parse(d.pausedFromUtc)) &&
          Number.isFinite(Date.parse(d.preparedUtc)) &&
          Date.parse(d.preparedUtc) >= Date.parse(d.pausedFromUtc)
          ? []
          : [
              "maintenance upgrade must attest the exact parent at an unchanged tick and a valid pause",
            ];
      },
    },
  };
}

/** Pure dry run, suitable only for a backup or a research verification process.
 * A live cutover must obtain the final stopped head, back it up, and rerun this
 * verification under an explicitly approved operational procedure. */
export function prepareMaintenanceContinuation(
  source: LifeCheckpoint<HeadlessGenesis>,
  times: { pausedFromUtc: string; preparedUtc: string },
) {
  if (
    !Number.isFinite(Date.parse(times.pausedFromUtc)) ||
    !Number.isFinite(Date.parse(times.preparedUtc)) ||
    Date.parse(times.preparedUtc) < Date.parse(times.pausedFromUtc)
  )
    throw new Error("invalid maintenance pause interval");
  const oldKind = sourceKind(source);
  const old = restoreLife(oldKind, source);
  if (old.cityFly.controller !== "echo" || old.cityFly.failed)
    throw new Error("continuation requires a healthy existing ECHO individual");
  const originalHash = oldKind.hash(old);
  const preservedGraphDigest = sha256(
    JSON.stringify(snapshotGraph(old, indexGraph(oldKind.build(source.genesis)))),
  );
  if (preservedGraphDigest !== source.graphDigest)
    throw new Error("source projection did not survive exactly");
  const life: MaintainedLife = Object.assign(old, { maintenance: new Physiology(true) });
  if (oldKind.hash(life) !== originalHash)
    throw new Error("maintenance changed pre-existing state");
  const kind = maintenanceKind(oldKind);
  const checkpoint = checkpointLife(kind, life, {
    genesis: source.genesis,
    birth: source.birth,
    previous: source,
    events: [
      {
        tick: source.tick,
        kind: EVENT,
        data: {
          migration: MAINTENANCE_CONTINUATION,
          parent: source.digest,
          sourceGraphDigest: source.graphDigest,
          preservedGraphDigest,
          ...times,
          scope: "artificial maintenance only; existing ECHO controller preserved",
        },
      },
    ],
  });
  const errors = kind.history!.transition(source, checkpoint);
  if (errors.length) throw new Error(errors.join("; "));
  restoreLife(kind, checkpoint);
  return {
    kind,
    life,
    checkpoint,
    originalHash,
    preservedGraphDigest,
    rollout: "dry-run only; live store and deployment not modified" as const,
  };
}
