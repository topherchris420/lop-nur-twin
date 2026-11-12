/**
 * A research fly's social senses and the two responses they drive.
 *
 * Research only. `SocialBrain` receives what the commons lets a body feel of
 * another, touch at the legs and the other's surface chemistry tasted there,
 * and holds two published, partner-blind pathways:
 *
 * - **Touch → walking away.** Ramdya et al. 2015 (doi:10.1038/nature14024):
 *   a stationary fly touched on a leg by another walks off, through leg
 *   mechanosensory neurons and NOMPC, whether or not the toucher carries
 *   cuticular hydrocarbons (their oenocyte-ablated flies elicited the
 *   response as well). Chemistry plays no part here.
 * - **Novel chemistry → alerting.** Hattori et al. 2017
 *   (doi:10.1016/j.cell.2017.04.028): a novel odour drives MBON-α′3 and
 *   interrupts grooming in about half of flies, a familiar one in 10-20%.
 *   The probability here is read from the fly's own α′3 compartment
 *   (`novelty.ts`) at the start of each contact bout.
 *
 * Neither names, counts or remembers a partner. Whatever familiarity the fly
 * shows is the compartment's synaptic depression, specific to a chemistry,
 * acting on the alerting probability; no rule says "recognize", "befriend" or
 * "avoid" anyone (AGENTS.md, First contact: "Do not script").
 *
 * `SocialOrganismAdapter` is the deployed ECHO's kind (the plasticity
 * organism, `PlasticityOrganismAdapter`) with this brain at the organism's
 * `shape()` hook: after the controller's intention, the rest gate and
 * olfaction, before fatigue scaling and the self-model's `act`, so ECHO's
 * efference copy is the command the body receives. It runs only in research
 * subjects; nothing in production imports it.
 */
import { mulberry32, seekStream, streamPosition } from "../../../lib/noise.js";
import { LIMITS, type DecisionInput, type MotorCommand } from "../../fly/neural.js";
import type { AdapterStreams } from "../../fly/neural.js";
import { wrapAngle } from "../../fly/units.js";
import { PlasticityOrganismAdapter } from "../../life/plasticOrganism.js";
import type { PlasticityMode } from "../../fly/echo/adaptiveBrain.js";
import type { SocialPort, TouchSample } from "./commons.js";
import {
  NoveltyCompartment,
  type NoveltyOptions,
  type NoveltyParam,
  type NoveltySnapshot,
} from "./novelty.js";

export const SOCIAL_VERSION = "first-contact-social-brain/v1" as const;

const RAMDYA = "10.1038/nature14024";
const HATTORI = "10.1016/j.cell.2017.04.028";

export const SOCIAL_PARAMS = {
  touchResponseP: {
    value: 0.8,
    unit: "probability",
    class: "published",
    note: "a resting or grooming fly touched by another starts walking away with this probability: the value Ramdya et al.'s simulation took from their measurements. A feeding fly's response to touch was not measured there and none is applied (model choice)",
    sources: [
      {
        doi: RAMDYA,
        quote:
          "if the walking fly encountered an inactive fly, it caused the encountered fly to initiate a bout with probability P(Encounter Response) = 0.8",
      },
    ],
  },
  touchBoutS: {
    value: 1,
    unit: "s",
    class: "model",
    note: "duration of the walk away; the paper reports such bouts are longer than spontaneous ones but this value is ours",
    sources: [
      {
        doi: RAMDYA,
        quote:
          "walking bouts (velocity >1 mm/s) initiated during an Encounter (‘Encounter Responses’) were significantly longer than those spontaneously initiated in isolation",
      },
    ],
  },
  touchWalkCmS: {
    value: 1.2,
    unit: "cm/s",
    class: "model",
    note: "walking speed of the walk away: above the paper's response criterion of 5 mm/s",
    sources: [
      {
        doi: RAMDYA,
        quote:
          "If there was continuous motion for the next half-second (mean velocity magnitude >5 mm/s) an Encounter Response occurred",
      },
    ],
  },
  alertNovelP: {
    value: 0.5,
    unit: "probability",
    class: "published",
    note: "interruption probability for a chemistry the compartment answers with full response",
    sources: [
      {
        doi: HATTORI,
        quote: "Upon exposure to a novel odor, 50% of the flies stop grooming",
      },
    ],
  },
  alertFamiliarP: {
    value: 0.15,
    unit: "probability",
    class: "published",
    note: "interruption probability at zero α′3 response, and for a contact that tastes of nothing: the middle of the measured range",
    sources: [
      {
        doi: HATTORI,
        quote:
          "Further pulses of the same odor interrupt grooming in only 10%–20% of the flies",
      },
    ],
  },
  alertHoldS: {
    value: 1,
    unit: "s",
    class: "model",
    note: "how long an alerted fly stays still before its controller may resume grooming or feeding",
  },
} as const satisfies Record<string, NoveltyParam>;

export const SOCIAL_APPROXIMATIONS = Object.freeze([
  "alerting interrupts feeding as well as grooming: Hattori et al. measured grooming only; feeding is this model's extension",
  "the touch response is applied to resting and grooming flies (stationary), not to feeding ones, whose response was not measured",
  "the alerting probability is linear in the α′3 compartment's response between the two published endpoints (a model choice)",
  "a sleeping or protectively resting organism is not shaped at all (its rest gate holds), so it neither walks away nor alerts",
]);

/** What the experimenter records of each contact bout's onset, for the receiver. */
export interface ContactOnset {
  /** Commons time of the onset (s). */
  t: number;
  /** α′3 response at the first tasted sample, or null if nothing was tasted. */
  novelty: number | null;
  /** Filled at the next decision: the receiver's mode then, and what the brain did. */
  mode: string | null;
  touchResponse: boolean | null;
  alerted: boolean | null;
}

export interface SocialBrainOptions extends NoveltyOptions {
  /** Touch responses on (default). False lesions the leg mechanosensory pathway. */
  touch?: boolean;
  /** Alerting on (default). False lesions α′3's output. */
  alert?: boolean;
}

export interface SocialBrainSnapshot {
  version: typeof SOCIAL_VERSION;
  seed: number;
  touch: boolean;
  alert: boolean;
  compartment: NoveltySnapshot;
  rng: number;
  touchUntil: number;
  awayYaw: number;
  lastBearing: number;
  alertUntil: number;
  pending: ContactOnset[];
  onsets: ContactOnset[];
  inContact: boolean;
}

/** The onsets kept for the experimenter (a bounded record). */
export const ONSETS_KEPT = 20_000;

export class SocialBrain implements SocialPort {
  readonly seed: number;
  readonly touchOn: boolean;
  readonly alertOn: boolean;
  compartment: NoveltyCompartment;
  private rng: () => number;
  private touchUntil = -Infinity;
  private awayYaw = 0;
  private alertUntil = -Infinity;
  private pending: ContactOnset[] = [];
  /** Every onset handled so far, oldest first. */
  readonly onsets: ContactOnset[] = [];
  private inContact = false;

  constructor(seed: number, options: SocialBrainOptions = {}) {
    if (!Number.isSafeInteger(seed))
      throw new Error("social brain: seed must be an integer");
    this.seed = seed;
    this.touchOn = options.touch ?? true;
    this.alertOn = options.alert ?? true;
    this.compartment = new NoveltyCompartment(seed, options);
    this.rng = mulberry32((seed ^ 0x50c1_a1e5) >>> 0);
  }

  /** From the commons (commons time; decisions use the body's own clock). */
  touch(sample: TouchSample): void {
    this.lastBearing = sample.bearing;
    const r = this.compartment.sense(sample.chemistry, sample.t, sample.dt);
    if (sample.onset || !this.inContact)
      this.pending.push({
        t: sample.t,
        novelty: r.novelty,
        mode: null,
        touchResponse: null,
        alerted: null,
      });
    this.inContact = true;
  }

  /** The commons reports the end of a contact bout (no more samples follow). */
  release(): void {
    this.inContact = false;
  }

  /** The organism's hook. Reflexes and flight pass through untouched. */
  shape(input: DecisionInput, intention: MotorCommand): MotorCommand {
    const body = input.body;
    for (const onset of this.pending) this.decideOnset(onset, input);
    this.pending = [];
    if (
      intention.mode === "escape" ||
      intention.mode === "takeoff" ||
      intention.mode === "flight" ||
      intention.mode === "land"
    )
      return intention;
    const t = body.t;
    if (
      t < this.touchUntil &&
      (body.mode === "rest" || body.mode === "groom" || body.mode === "walk")
    ) {
      if (body.mode === "groom")
        return { mode: "rest", reason: "touched: stops grooming to walk away" };
      const turn = wrapAngle(this.awayYaw - body.yaw);
      const cap = LIMITS.yawRate / 2;
      return {
        mode: "walk",
        walkSpeed: SOCIAL_PARAMS.touchWalkCmS.value,
        yawRate: Math.max(-cap, Math.min(cap, 6 * turn)),
        reason: "touched: walking away (Ramdya et al. 2015)",
      };
    }
    if (t < this.alertUntil) {
      if (body.mode === "groom" || body.mode === "feed")
        return { mode: "rest", reason: "alert: contact chemistry (Hattori et al. 2017)" };
      if (intention.mode === "groom" || intention.mode === "feed")
        return { mode: "rest", reason: "alert: holding still" };
    }
    return intention;
  }

  private decideOnset(onset: ContactOnset, input: DecisionInput): void {
    const body = input.body;
    onset.mode = body.mode;
    // Both draws are always made, so lesions never shift the stream.
    const uTouch = this.rng(),
      uAlert = this.rng();
    const stationary = body.mode === "rest" || body.mode === "groom";
    onset.touchResponse =
      this.touchOn && stationary && uTouch < SOCIAL_PARAMS.touchResponseP.value;
    if (onset.touchResponse) {
      this.touchUntil = body.t + SOCIAL_PARAMS.touchBoutS.value;
      // Away from the side touched: the bearing was relative to the body then.
      const last = this.lastBearing;
      this.awayYaw = wrapAngle(body.yaw + last + Math.PI);
    }
    const n = onset.novelty ?? 0;
    const pF = SOCIAL_PARAMS.alertFamiliarP.value,
      pN = SOCIAL_PARAMS.alertNovelP.value;
    const p = pF + (pN - pF) * Math.max(0, Math.min(1, n));
    onset.alerted =
      this.alertOn && (body.mode === "groom" || body.mode === "feed") && uAlert < p;
    if (onset.alerted) this.alertUntil = body.t + SOCIAL_PARAMS.alertHoldS.value;
    if (this.onsets.length >= ONSETS_KEPT) this.onsets.shift();
    this.onsets.push(onset);
  }

  /** The side of the latest touch (rad, + left, relative to the body then). */
  private lastBearing = 0;

  get state() {
    return {
      version: SOCIAL_VERSION,
      onsets: this.onsets.length,
      meanWeight: this.compartment.meanWeight,
      touchUntil: this.touchUntil,
      alertUntil: this.alertUntil,
    };
  }

  snapshot(): SocialBrainSnapshot {
    return {
      version: SOCIAL_VERSION,
      seed: this.seed,
      touch: this.touchOn,
      alert: this.alertOn,
      compartment: this.compartment.snapshot(),
      rng: streamPosition(this.rng)!,
      touchUntil: this.touchUntil,
      awayYaw: this.awayYaw,
      lastBearing: this.lastBearing,
      alertUntil: this.alertUntil,
      pending: structuredClone(this.pending),
      onsets: structuredClone(this.onsets),
      inContact: this.inContact,
    };
  }

  static restore(s: SocialBrainSnapshot): SocialBrain {
    if (s.version !== SOCIAL_VERSION)
      throw new Error("social brain: incompatible snapshot");
    const b = new SocialBrain(s.seed, {
      touch: s.touch,
      alert: s.alert,
      plastic: s.compartment.plastic,
      tastes: s.compartment.tastes,
    });
    b.compartment = NoveltyCompartment.restore(s.compartment);
    seekStream(b.rng, s.rng);
    b.touchUntil = s.touchUntil;
    b.awayYaw = s.awayYaw;
    b.lastBearing = s.lastBearing;
    b.alertUntil = s.alertUntil;
    b.pending = structuredClone(s.pending);
    b.onsets.push(...structuredClone(s.onsets));
    b.inContact = s.inContact;
    return b;
  }
}

/**
 * The deployed ECHO's kind, a plasticity organism, with a social brain at
 * its shaping hook. The plasticity shapes first (as deployed), then the
 * social brain.
 */
export class SocialOrganismAdapter extends PlasticityOrganismAdapter {
  readonly social: SocialBrain;

  constructor(
    rng: () => number,
    streams: AdapterStreams,
    seed: number,
    mode: PlasticityMode,
    social: SocialBrain,
  ) {
    super(rng, streams, seed, mode);
    this.social = social;
  }

  override get state() {
    return { ...super.state, social: this.social.state };
  }

  protected override shape(input: DecisionInput, intention: MotorCommand): MotorCommand {
    return this.social.shape(input, super.shape(input, intention));
  }
}
