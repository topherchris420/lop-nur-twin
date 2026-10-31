/**
 * Stage 2: controlled encounters between two research subjects.
 *
 * Each subject lives in an arena of its own (two `arenaWorld`s built from the
 * same specification, so the declared frame map between them is the identity:
 * the two worlds coincide in space but share nothing else). Each first lives
 * alone for a pre-contact period of its own, so their clocks differ when
 * contact begins, as the originals' do. The `EncounterClock` then steps both
 * on one timeline, and the bridge carries each one's body to the other's eyes
 * after every step, only while both clocks are verified in step.
 *
 * Three conditions:
 * - `live`: both directions, so either fly's response can change what the
 *   other sees (contingent);
 * - `yoked`: subject 0 sees a recording of subject 1 from a live session with
 *   the same seeds, played back as it was recorded, so it sees the same kind of
 *   motion but nothing it does changes it (non-contingent);
 * - `solitary`: the bridge is never opened; each fly lives alone.
 *
 * Everything measured here is the experimenter's: true positions, counts and
 * which moving thing the fly's last decision looked at. None of it is given
 * to either fly.
 */
import { arenaWorld, type ArenaSpec } from "../fly/arena.js";
import type { DigitalFly } from "../fly/fly.js";
import type { V3 } from "../fly/units.js";
import {
  BRIDGE_MOVER_ID,
  BridgedWorld,
  DEFAULT_BRIDGE,
  EncounterBridge,
  PerceptChannel,
  type BridgeAuthorization,
  type BridgeConfig,
} from "./bridge.js";
import { EncounterClock, type SubjectClock } from "./clock.js";
import { applyMap, identityMap, type FrameMap } from "./frames.js";
import { percept } from "./percept.js";
import { researchSubject, type SubjectSpec } from "./subjects.js";

export const SESSION_CONDITIONS = ["live", "yoked", "solitary"] as const;
export type SessionCondition = (typeof SESSION_CONDITIONS)[number];

export interface SessionSpec {
  id: string;
  condition: SessionCondition;
  subjects: [SubjectSpec, SubjectSpec];
  /** Each subject's life alone before contact (s): their ages at contact. */
  preContactS: [number, number];
  contactS: number;
  arena: ArenaSpec;
  bridge?: Partial<BridgeConfig>;
  authorization: BridgeAuthorization;
}

export interface SubjectOutcome {
  id: string;
  controller: string;
  /** Counts over the contact period only. */
  escapes: number;
  takeoffs: number;
  landings: number;
  flownM: number;
  walkedM: number;
  /** Decisions whose sensory sample's strongest looming thing was the other fly. */
  sawOther: number;
  /** Escapes that began while the other fly was within `NEAR_M`. */
  escapesNear: number;
  /** Closest the other fly came (m), and the time it spent within `NEAR_M` (s). */
  closestM: number | null;
  nearS: number;
  /** Own clock at contact and at the end (s). */
  clock: [number, number];
}

export interface SessionResult {
  id: string;
  condition: SessionCondition;
  subjects: [SubjectOutcome, SubjectOutcome | null];
  exchanges: number;
  synchronized: boolean;
  bridge: { events: number; head: string; closedReason: string | null } | null;
  /** Subject 1's body in subject 0's frame at every step (live sessions): the yoked condition's playback. */
  trace: V3[] | null;
}

/** "Near": within this distance the other fly can be resolved and can loom (m). */
export const NEAR_M = 0.03;

interface Tracker {
  fly: DigitalFly;
  start: DigitalFly["state"]["counts"];
  lastFrameT: number;
  sawOther: number;
  escapes: number;
  escapesNear: number;
  closest: number;
  nearS: number;
}

const track = (fly: DigitalFly): Tracker => ({
  fly,
  start: { ...fly.state.counts },
  lastFrameT: -1,
  sawOther: 0,
  escapes: fly.state.counts.escapes,
  escapesNear: 0,
  closest: Infinity,
  nearS: 0,
});

function observe(tr: Tracker, other: V3 | null, dt: number) {
  const f = tr.fly.lastFrame;
  if (f && f.t !== tr.lastFrameT) {
    tr.lastFrameT = f.t;
    if (f.looming?.id === BRIDGE_MOVER_ID) tr.sawOther++;
  }
  const d = other
    ? Math.hypot(
        other[0] - tr.fly.state.p[0],
        other[1] - tr.fly.state.p[1],
        other[2] - tr.fly.state.p[2],
      )
    : Infinity;
  if (d < tr.closest) tr.closest = d;
  if (d < NEAR_M) tr.nearS += dt;
  const e = tr.fly.state.counts.escapes;
  if (e > tr.escapes && d < NEAR_M) tr.escapesNear += e - tr.escapes;
  tr.escapes = e;
}

function outcome(
  tr: Tracker,
  spec: SubjectSpec,
  clock: [number, number],
): SubjectOutcome {
  const c = tr.fly.state.counts;
  return {
    id: spec.id,
    controller: tr.fly.adapter.descriptor.id,
    escapes: c.escapes - tr.start.escapes,
    takeoffs: c.takeoffs - tr.start.takeoffs,
    landings: c.landings - tr.start.landings,
    flownM: c.flownM - tr.start.flownM,
    walkedM: c.walkedM - tr.start.walkedM,
    sawOther: tr.sawOther,
    escapesNear: tr.escapesNear,
    closestM: Number.isFinite(tr.closest) ? tr.closest : null,
    nearS: tr.nearS,
    clock,
  };
}

/**
 * Runs one session. A yoked session needs `playback`: subject 1's trace from
 * the live session with the same seeds.
 */
export function runSession(
  spec: SessionSpec,
  playback: readonly V3[] | null = null,
): SessionResult {
  const config: BridgeConfig = { ...DEFAULT_BRIDGE, ...spec.bridge };
  const steps = Math.round(spec.contactS / config.exchangeS);
  if (!(steps > 0 && steps <= 2_000_000))
    throw new Error("session: contact period out of range");
  if (spec.condition === "yoked" && (!playback || playback.length < steps + 1))
    throw new Error("session: a yoked session needs the live session's full trace");
  const frames = ["arena-0", "arena-1"] as const;
  const maps: [FrameMap, FrameMap] = [
    {
      ...identityMap(
        "arena",
        "the two arenas share a specification and coincide in space",
      ),
      id: "arena-1→arena-0",
      from: frames[1],
      to: frames[0],
    },
    {
      ...identityMap(
        "arena",
        "the two arenas share a specification and coincide in space",
      ),
      id: "arena-0→arena-1",
      from: frames[0],
      to: frames[1],
    },
  ];
  // The bodies are read through accessors, so the bridge can exist before the flies.
  const flies: DigitalFly[] = [];
  const bridge =
    spec.condition === "live"
      ? new EncounterBridge(
          [
            {
              id: spec.subjects[0].id,
              frame: frames[0],
              position: () => flies[0]!.state.p,
            },
            {
              id: spec.subjects[1].id,
              frame: frames[1],
              position: () => flies[1]!.state.p,
            },
          ],
          maps,
          spec.authorization,
          config,
        )
      : null;
  // A live session's worlds read the bridge's channels; the others' are fed here (yoked) or never (solitary).
  const channels = bridge
    ? [bridge.channel(0), bridge.channel(1)]
    : [new PerceptChannel(config.latencyS), new PerceptChannel(config.latencyS)];
  const pre = spec.preContactS;
  const worlds = [0, 1].map(
    (i) =>
      new BridgedWorld(
        arenaWorld(spec.arena, frames[i]),
        channels[i]!,
        (t) => t - pre[i]!,
      ),
  );
  spec.subjects.forEach((s, i) => flies.push(researchSubject(s, worlds[i]!).fly));
  flies.forEach((f, i) => f.advance(pre[i]!));
  const clocks = flies.map((f, i): SubjectClock => ({
    id: spec.subjects[i]!.id,
    ownAtContactS: f.state.t,
    read: () => f.state.t,
    advance: (dt) => f.advance(dt),
  })) as [SubjectClock, SubjectClock];
  const atContact = clocks.map((c) => c.ownAtContactS);
  const clock = new EncounterClock(clocks, {
    stepS: config.exchangeS,
    // A subject advances in whole physics steps (5 ms by default).
    toleranceS: Math.min(config.exchangeS * 0.99, 0.0051),
  });
  const trackers = flies.map(track);
  const trace: V3[] | null = spec.condition === "live" ? [] : null;
  let synchronized = true;
  const deliver = (tau: number, k: number) => {
    if (bridge) bridge.exchange(tau, clock.sync);
    else if (spec.condition === "yoked")
      channels[0]!.push(tau, percept({ center: playback![k]!, radius: config.radiusM }));
    trace?.push(applyMap(maps[0], flies[1]!.state.p));
  };
  bridge?.open(0);
  deliver(0, 0);
  for (let k = 1; k <= steps; k++) {
    const sync = clock.step();
    if (!sync.synchronized) synchronized = false;
    deliver(clock.tau, k);
    const other0 =
      spec.condition === "live"
        ? applyMap(maps[0], flies[1]!.state.p)
        : spec.condition === "yoked"
          ? playback![k]!
          : null;
    const other1 =
      spec.condition === "live" ? applyMap(maps[1], flies[0]!.state.p) : null;
    observe(trackers[0]!, other0, config.exchangeS);
    observe(trackers[1]!, other1, config.exchangeS);
  }
  bridge?.close(clock.tau, "the session ended");
  const end = flies.map((f) => f.state.t);
  return {
    id: spec.id,
    condition: spec.condition,
    subjects: [
      outcome(trackers[0]!, spec.subjects[0], [atContact[0]!, end[0]!]),
      // In a yoked session subject 1 is not a party: only its recording is.
      spec.condition === "yoked"
        ? null
        : outcome(trackers[1]!, spec.subjects[1], [atContact[1]!, end[1]!]),
    ],
    exchanges: steps,
    synchronized,
    bridge: bridge
      ? {
          events: bridge.log.events.length,
          head: bridge.log.head,
          closedReason: bridge.reason,
        }
      : null,
    trace,
  };
}
