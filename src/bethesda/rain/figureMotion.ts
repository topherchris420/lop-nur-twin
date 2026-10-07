/**
 * How the four perspectives move. Presentation only.
 *
 * The behaviours are R.A.I.N.'s own, ported from its Godot client
 * (`agent_avatar.gd` in topherchris420/james_library) and re-timed for a
 * figure in a room instead of a sprite on a strip:
 *
 *  - **idle:** breathing, randomised blinks (one in five a double blink, the
 *    client's timings), a wandering gaze, weight shifting between the feet,
 *    and each perspective's secondary motion — James's arms, Luca's scarf;
 *  - **listening:** the eyes and then the head go to whoever is speaking;
 *  - **talking:** the mouth moves on the client's procedural voice (syllable
 *    bumps under a slower phrase contour, attack faster than release), the
 *    head takes a small beat on the open syllables, the hands gesture —
 *    rest, a gesture after 0.9–2.4 s, held, and back — and the speaker's gaze
 *    goes round the room.
 *
 * What the client also does and the lab does not: tone presets (excited,
 * skeptical, pleased …), nods, the end-of-conversation celebration, the
 * drop-in entrance and the squash-and-stretch hops. Each of those reads as
 * agreement or confidence, and the lab never animates either; a gesture here
 * has one energy whoever speaks and whatever is said. The animator is handed
 * where a figure is, where it should face, what is worth looking at and
 * whether its turn is on — never a record, a verdict or a confidence.
 *
 * The walk is not the client's (a sprite does not walk): the feet are
 * placed, not swung, by the shared two-bone IK, with stride, duty and cadence
 * tied to speed so a planted foot never slides — the same contract as
 * `game/characters/animation.ts`. James crawls on his arms instead.
 *
 * Randomness is `mulberry32`, seeded per perspective. Per-frame state lives
 * in this object and in the bones; nothing here touches React state.
 */
import * as THREE from "three";
import { mulberry32 } from "@/lib/noise";
import { solveTwoBone } from "../../game/characters/ik";
import { B, BONE_LENGTH, REST_POS } from "../../game/characters/rig";
import type { FigureRig } from "./figures";

/** What the scene tells a figure each frame. */
export interface FigureCue {
  /** Where the figure stands, world metres. */
  x: number;
  z: number;
  /** World height of the floor under it. */
  ground: number;
  /** Which way to face when standing (radians, the rig faces -z at 0). Null keeps the current facing. */
  face: number | null;
  /** The point of attention, world metres, or null to look ahead. */
  look: THREE.Vector3 | null;
  /** Other points a glance may go to: the room, for a speaker. */
  glances: readonly THREE.Vector3[];
  /** Its turn is the one being shown. */
  speaking: boolean;
  /** Looking round a place rather than at anyone (an outing's observation). */
  scan: boolean;
  /** Floor height sampler for the feet, world metres; omit on a flat floor. */
  groundAt?: (x: number, z: number) => number;
}

/** A stable seed per perspective, as the Godot client seeds each avatar by its name. */
export function seedFor(who: string) {
  let h = 0x811c9dc5;
  for (const ch of who) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193);
  return h >>> 0;
}

/** Yaw that turns the rig's -z forward toward a world direction. */
export function yawToward(dx: number, dz: number) {
  return Math.atan2(-dx, -dz);
}
function wrap(a: number) {
  return ((((a + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
}
function damp(current: number, target: number, lambda: number, dt: number) {
  return target + (current - target) * Math.exp(-lambda * dt);
}
function smooth(e0: number, e1: number, x: number) {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
function clamp(x: number, lo: number, hi: number) {
  return x < lo ? lo : x > hi ? hi : x;
}

/* ------------------------------------------------------------------ */
/* Gait constants, from the rig                                        */
/* ------------------------------------------------------------------ */

const PELVIS_Y = REST_POS[B.pelvis * 3 + 1]!;
const PELVIS_Z = REST_POS[B.pelvis * 3 + 2]!;
const ANKLE_Y = REST_POS[B.footL * 3 + 1]!;
const ANKLE_Z = REST_POS[B.footL * 3 + 2]!;
const THIGH = BONE_LENGTH[B.thighL]!;
const SHIN = BONE_LENGTH[B.shinL]!;
const REACH = (THIGH + SHIN) * 0.985;
/** The longest a foot travels relative to the hips in one stance. */
const MAX_EXCURSION = 0.8;
/** Share of the stance spent ahead of the hips. */
const FRONT_BIAS = 0.4;
/** Eye height of the rig, for aiming the head. */
const EYE_Y = 1.649;

/** Ankle rise and pitch through stance and swing: heel strike, flat, toe-off. */
function stanceRise(s: number) {
  return (
    Math.max(0, 1 - s / 0.16) * 0.05 + (s > 0.72 ? ((s - 0.72) / 0.28) ** 1.5 * 0.11 : 0)
  );
}
function stanceRoll(s: number) {
  if (s < 0.18) return (1 - s / 0.18) * 0.22;
  if (s > 0.7) return -(((s - 0.7) / 0.3) ** 2) * 0.5;
  return 0;
}
function swingRise(s: number) {
  return THREE.MathUtils.lerp(0.11, 0.05, smooth(0, 0.6, s));
}
function swingRoll(s: number) {
  return THREE.MathUtils.lerp(-0.5, 0.22, smooth(0, 0.55, s));
}

const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _pelvisQ = new THREE.Quaternion();
const _pelvisInv = new THREE.Quaternion();
const _pelvisPos = new THREE.Vector3();
const _hip = new THREE.Vector3();
const _foot = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _shinQ = new THREE.Quaternion();
const _footQ = new THREE.Quaternion();
const _dir = new THREE.Vector3();
const _lift = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _plan = [
  { target: new THREE.Vector3(), pitch: 0 },
  { target: new THREE.Vector3(), pitch: 0 },
];

function setEuler(bone: THREE.Bone, x: number, y: number, z: number) {
  bone.quaternion.setFromEuler(_e.set(x, y, z, "YXZ"));
}
function addEuler(bone: THREE.Bone, x: number, y: number, z: number) {
  bone.quaternion.multiply(_q.setFromEuler(_e.set(x, y, z, "YXZ")));
}

type Gesture = "right" | "left" | "both";

export class FigureAnimator {
  private readonly rand: () => number;
  /** Seconds since this figure appeared. */
  private t = 0;
  private readonly phase0: number;
  private placed = false;
  private x = 0;
  private z = 0;
  private yaw = 0;
  private yawRate = 0;
  /** Smoothed ground speed, world m/s. */
  speed = 0;
  /** Gait phase, radians; one cycle is two steps. */
  private gait = 0;

  // Blinks (the client's timings).
  private nextBlink: number;
  private blinkAt = -Infinity;
  private blinkAgain = -Infinity;
  // Gaze.
  private nextGlance: number;
  private glance = -1;
  private glanceYaw = 0;
  private glancePitch = 0;
  private headYaw = 0;
  private headPitch = 0;
  private eyeYaw = 0;
  private eyePitch = 0;
  // Speech.
  private mouth = 0;
  private wasSpeaking = false;
  private gesture: Gesture = "right";
  private gestureOn = false;
  private gestureUntil = 0;
  private nextGesture = 0;
  private gestureWeight = 0;
  /** A front arm James raises to talk with. */
  private readonly gestureArm: number;

  constructor(
    private readonly rig: FigureRig,
    seed: number,
  ) {
    this.rand = mulberry32(seed >>> 0);
    this.phase0 = this.rand() * Math.PI * 2;
    this.nextBlink = 0.6 + this.rand() * 2.4;
    this.nextGlance = 1 + this.rand() * 2;
    this.gestureArm = this.rand() < 0.5 ? 3 : 4;
  }

  private between(lo: number, hi: number) {
    return lo + (hi - lo) * this.rand();
  }

  /** Where the figure is drawn, world metres, and which way it faces. */
  get position() {
    return { x: this.x, z: this.z, yaw: this.yaw };
  }

  /** Put the figure somewhere without walking there. */
  place(x: number, z: number, yaw: number) {
    this.x = x;
    this.z = z;
    this.yaw = yaw;
    this.speed = 0;
    this.placed = true;
  }

  update(dt: number, cue: FigureCue, reduced: boolean) {
    dt = Math.min(Math.max(dt, 0), 0.1);
    const rig = this.rig;
    if (!this.placed) this.place(cue.x, cue.z, cue.face ?? 0);
    // Under reduced motion nothing breathes, blinks, gestures or walks: the
    // figure stands where it is and turns at once to what it attends to.
    const clock = reduced ? 0 : dt;
    this.t += clock;

    /* ------------------------------------------------- locomotion */
    const dx = cue.x - this.x,
      dz = cue.z - this.z;
    const moved = Math.hypot(dx, dz);
    // A jump of more than a metre in one frame is a placement, not a stride.
    const v = dt > 0 && moved < 1 ? moved / dt : 0;
    this.speed = reduced || moved >= 1 ? 0 : damp(this.speed, Math.min(v, 6), 10, dt);
    this.x = cue.x;
    this.z = cue.z;
    const travelling = this.speed > 0.25 && moved > 1e-5;
    const want = travelling ? yawToward(dx, dz) : (cue.face ?? this.yaw);
    const err = wrap(want - this.yaw);
    const before = this.yaw;
    if (reduced) this.yaw = want;
    else {
      const rate = Math.min(travelling ? 5 : 3.2, Math.abs(err) * 5);
      this.yaw = wrap(this.yaw + Math.sign(err) * Math.min(Math.abs(err), rate * dt));
    }
    this.yawRate = dt > 0 ? damp(this.yawRate, wrap(this.yaw - before) / dt, 12, dt) : 0;
    rig.root.position.set(this.x, cue.ground, this.z);
    rig.root.rotation.set(0, this.yaw, 0);

    /* --------------------------------------------------- attention */
    this.attend(cue, clock, reduced);

    if (rig.kind === "octopus") this.poseOctopus(cue, clock, reduced);
    else this.poseHuman(cue, clock, reduced);
    this.poseFace(reduced);
  }

  /* ------------------------------------------------------------------ */
  /* Attention: blinks, glances, speech envelope, gesture timing          */
  /* ------------------------------------------------------------------ */

  private attend(cue: FigureCue, dt: number, reduced: boolean) {
    const t = this.t;
    // Blinks: the client's 2.2–5.5 s apart (1.6–3.4 s while talking), one in
    // five followed by a second 0.3 s later.
    if (t >= this.nextBlink) {
      this.blinkAt = t;
      this.blinkAgain = this.rand() < 0.2 ? t + 0.3 : -Infinity;
      this.nextBlink =
        t + (cue.speaking ? this.between(1.6, 3.4) : this.between(2.2, 5.5));
    }
    // Glances: a speaker looks round the room, favouring whoever is in front;
    // a listener stays on the speaker four times in five.
    if (t >= this.nextGlance) {
      this.nextGlance = t + this.between(1.4, 4.2);
      const r = this.rand();
      if (cue.scan) {
        this.glance = -1;
        this.glanceYaw = this.between(-0.85, 0.85);
        this.glancePitch = this.between(-0.12, 0.06);
      } else if (cue.speaking && cue.glances.length && r > 0.45) {
        this.glance = Math.floor(this.rand() * cue.glances.length);
        this.glanceYaw = this.glancePitch = 0;
      } else if (cue.look && !cue.speaking && r < 0.8) {
        this.glance = -1;
        this.glanceYaw = this.glancePitch = 0;
      } else {
        this.glance = -1;
        this.glanceYaw = this.rand() < 0.6 ? this.between(-0.3, 0.3) : 0;
        this.glancePitch = this.between(-0.08, 0.04);
      }
    }
    // Speech: the client's procedural voice when no level is known.
    if (cue.speaking !== this.wasSpeaking) {
      this.wasSpeaking = cue.speaking;
      if (cue.speaking) {
        this.nextGesture = t + this.between(0.3, 1.0);
        this.nextGlance = t + this.between(0.8, 1.6);
        this.glance = -1;
      } else this.gestureOn = false;
    }
    let voice = 0;
    if (cue.speaking && !reduced) {
      const syllables = Math.abs(Math.sin(t * 10 * 0.5 * Math.PI + this.phase0));
      const phrase = 0.55 + 0.45 * Math.sin(t * 1.7 + this.phase0);
      voice = syllables * phrase;
    }
    const rate = voice > this.mouth ? 30 : 14;
    this.mouth = THREE.MathUtils.lerp(this.mouth, voice, Math.min(1, dt * rate));
    // Gestures: rest, then one after 0.9–2.4 s, held, and back to rest.
    if (cue.speaking && !reduced) {
      if (this.gestureOn && t >= this.gestureUntil) {
        this.gestureOn = false;
        this.nextGesture = t + this.between(0.9, 2.4);
      } else if (!this.gestureOn && t >= this.nextGesture) {
        this.gestureOn = true;
        const r = this.rand();
        this.gesture = r < 0.45 ? "right" : r < 0.75 ? "left" : "both";
        this.gestureUntil = t + this.between(0.8, 1.6);
      }
    }
    this.gestureWeight = reduced
      ? 0
      : damp(this.gestureWeight, this.gestureOn ? 1 : 0, this.gestureOn ? 7 : 5, dt);
  }

  /** The syllable envelope, for beats in the head and hands. */
  private get beat() {
    return this.mouth;
  }

  /**
   * Turn the gaze into a model-space yaw and pitch for the eyes, and let the
   * head follow more slowly: eyes jump, the head catches up.
   */
  private aim(
    cue: FigureCue,
    eyeY: number,
    headLimit: number,
    dt: number,
    reduced: boolean,
  ) {
    const s = this.rig.scale;
    let target: THREE.Vector3 | null = cue.look;
    if (this.glance >= 0 && this.glance < cue.glances.length)
      target = cue.glances[this.glance]!;
    let yaw = 0,
      pitch = 0;
    if (target) {
      const wx = target.x - this.x,
        wz = target.z - this.z;
      const c = Math.cos(this.yaw),
        sn = Math.sin(this.yaw);
      const lx = (wx * c - wz * sn) / s,
        lz = (wx * sn + wz * c) / s;
      const ly = (target.y - this.rig.root.position.y) / s - eyeY;
      yaw = Math.atan2(-lx, -lz);
      pitch = Math.atan2(ly, Math.max(0.2, Math.hypot(lx, lz)));
    }
    yaw = clamp(yaw + this.glanceYaw, -1.25, 1.25);
    pitch = clamp(pitch + this.glancePitch, -0.5, 0.4);
    const k = reduced ? 1 : 1 - Math.exp(-5.5 * dt);
    this.headYaw += (clamp(yaw, -headLimit, headLimit) - this.headYaw) * k;
    this.headPitch += (clamp(pitch, -0.35, 0.3) - this.headPitch) * k;
    const ke = reduced ? 1 : 1 - Math.exp(-26 * dt);
    this.eyeYaw += (clamp(yaw - this.headYaw, -0.42, 0.42) - this.eyeYaw) * ke;
    this.eyePitch += (clamp(pitch - this.headPitch, -0.3, 0.25) - this.eyePitch) * ke;
  }

  /* ------------------------------------------------------------------ */
  /* The humans                                                          */
  /* ------------------------------------------------------------------ */

  private reset() {
    const { bones, rest } = this.rig;
    for (let i = 0; i < bones.length; i++) {
      const b = bones[i]!;
      b.position.set(rest[i * 3]!, rest[i * 3 + 1]!, rest[i * 3 + 2]);
      b.quaternion.identity();
      b.scale.set(1, 1, 1);
    }
  }

  private poseHuman(cue: FigureCue, dt: number, reduced: boolean) {
    const rig = this.rig;
    const bones = rig.bones;
    this.reset();
    const s = rig.scale;
    const speed = this.speed / s;
    const t = this.t;

    /* ------------------------------------------------------- gait */
    const moving = smooth(0.08, 0.6, speed);
    // Turning on the spot is taken in small steps rather than a pivot on planted feet.
    const turning = smooth(0.7, 2.2, Math.abs(this.yawRate)) * (1 - moving);
    const run = smooth(1.9, 3.1, speed);
    const duty = 0.62 - 0.24 * run;
    const lift = 0.05 + 0.1 * run;
    const steps = 1.75 + 1.1 * run + 0.15 * turning;
    const pace = Math.max(0.25, speed);
    const period = Math.min(2 / steps, MAX_EXCURSION / (pace * duty));
    const excursion = speed * duty * period;
    const stepping = Math.max(moving, turning);
    if (stepping > 0.01)
      this.gait = (this.gait + (Math.PI * 2 * dt) / period) % (Math.PI * 2);

    // Idle weight shift: the hips drift over one foot and back, the feet stay put.
    const sway = Math.sin((t * Math.PI * 2) / 7.3 + this.phase0) * (1 - stepping);
    const breathe = Math.sin(
      (t * Math.PI * 2) / (cue.speaking ? 3.0 : 4.2) + this.phase0,
    );

    const cosY = Math.cos(this.yaw),
      sinY = Math.sin(this.yaw);
    for (let i = 0; i < 2; i++) {
      const side = i ? 1 : -1;
      const plan = _plan[i]!;
      const u = (this.gait / (Math.PI * 2) + (i ? 0.5 : 0)) % 1;
      let along: number, height: number, pitch: number;
      if (u < duty) {
        // Planted: the foot holds still on the floor, so relative to the hips
        // it moves back at exactly body speed.
        const st = u / duty;
        along = (FRONT_BIAS - st) * excursion;
        height = stanceRise(st);
        pitch = stanceRoll(st);
      } else {
        const sw = (u - duty) / (1 - duty);
        along = (FRONT_BIAS - 1 + sw * sw * (3 - 2 * sw)) * excursion;
        height = swingRise(sw) + lift * Math.sin(Math.PI * sw);
        pitch = swingRoll(sw);
      }
      const x = side * rig.stance;
      const z = ANKLE_Z - along * moving;
      let floor = 0;
      if (cue.groundAt) {
        const wx = this.x + (x * cosY + z * sinY) * s,
          wz = this.z + (-x * sinY + z * cosY) * s;
        floor = clamp((cue.groundAt(wx, wz) - cue.ground) / s, -0.15, 0.15);
      }
      plan.target.set(x, floor + ANKLE_Y + height * stepping, z);
      plan.pitch = pitch * stepping;
    }

    /* ----------------------------------------------------- pelvis */
    const bob =
      Math.cos(2 * (this.gait - Math.PI * duty)) * (0.011 + 0.02 * run) * moving;
    const sg = Math.sin(this.gait);
    const hipRoll = sg * 0.05 * moving + sway * 0.03;
    const hipYaw = -sg * 0.1 * moving;
    // Leaning into the walk: negative X tips the torso forward.
    const hipPitch = -(0.02 * moving + 0.08 * run * moving);
    _pelvisQ.setFromEuler(_e.set(hipPitch, hipYaw, hipRoll, "YXZ"));
    const shift = sway * 0.016;
    let pelvisY = PELVIS_Y + bob;
    // Drop the hips until both feet are in reach, solved rather than iterated.
    for (let i = 0; i < 2; i++) {
      const thigh = i ? B.thighR : B.thighL;
      const target = _plan[i]!.target;
      _hip.copy(bones[thigh]!.position).applyQuaternion(_pelvisQ);
      const hx = _hip.x + shift - target.x,
        hz = _hip.z + PELVIS_Z - target.z;
      const need =
        target.y - _hip.y + Math.sqrt(Math.max(0, REACH * REACH - hx * hx - hz * hz));
      if (need < pelvisY) pelvisY = Math.max(need, PELVIS_Y - 0.25);
    }
    _pelvisPos.set(shift, pelvisY, PELVIS_Z);
    _pelvisInv.copy(_pelvisQ).invert();
    bones[B.pelvis]!.position.copy(_pelvisPos);
    bones[B.pelvis]!.quaternion.copy(_pelvisQ);

    /* ------------------------------------------------------- legs */
    for (let i = 0; i < 2; i++) {
      const side = i ? 1 : -1;
      const plan = _plan[i]!;
      const thigh = i ? B.thighR : B.thighL,
        shin = i ? B.shinR : B.shinL,
        foot = i ? B.footR : B.footL;
      _foot.copy(plan.target).sub(_pelvisPos).applyQuaternion(_pelvisInv);
      // The knee goes where the foot points, splayed a touch: the pole is the only thing deciding it.
      _pole
        .set(side * 0.18, 0, -1)
        .normalize()
        .applyQuaternion(_pelvisInv);
      solveTwoBone(
        bones[thigh]!,
        bones[shin]!,
        thigh,
        shin,
        bones[thigh]!.position,
        _foot,
        _pole,
        THIGH,
        SHIN,
        _shinQ,
      );
      _footQ
        .setFromEuler(_e.set(plan.pitch, -side * 0.06, 0, "YXZ"))
        .premultiply(_pelvisInv);
      bones[foot]!.quaternion.copy(_shinQ).invert().multiply(_footQ);
    }

    /* ------------------------------------------------------ spine */
    // The chest counter-rotates the hips, and straightens against the sway.
    const lean = -(0.03 * moving + 0.07 * run * moving);
    addEuler(
      bones[B.spine1]!,
      lean * 0.5 + breathe * 0.004,
      -hipYaw * 0.5,
      -hipRoll * 0.45,
    );
    addEuler(
      bones[B.spine2]!,
      lean * 0.3 + breathe * 0.01,
      -hipYaw * 0.45,
      -hipRoll * 0.3,
    );
    addEuler(
      bones[B.spine3]!,
      breathe * 0.008 + this.beat * 0.008 * (cue.speaking ? 1 : 0),
      -hipYaw * 0.3,
      sg * 0.02 * moving,
    );

    /* -------------------------------------------- neck and head */
    this.aim(cue, EYE_Y, 0.85, dt, reduced);
    // The head steadies itself against the hips' yaw, then takes the look.
    const nod = cue.speaking ? this.beat * 0.03 : 0;
    setEuler(
      bones[B.neck]!,
      this.headPitch * 0.4 - lean * 0.6,
      this.headYaw * 0.38 + hipYaw * 0.2,
      -hipRoll * 0.2,
    );
    setEuler(
      bones[B.head]!,
      this.headPitch * 0.6 - nod,
      this.headYaw * 0.62,
      -sway * 0.02,
    );

    /* ------------------------------------------------------- arms */
    const swing = 0.32 + 0.3 * run;
    for (let i = 0; i < 2; i++) {
      const side = i ? 1 : -1;
      const L = !i;
      const clav = L ? B.clavicleL : B.clavicleR,
        upper = L ? B.upperArmL : B.upperArmR,
        fore = L ? B.foreArmL : B.foreArmR,
        twist = L ? B.foreTwistL : B.foreTwistR,
        hand = L ? B.handL : B.handR;
      // Opposite to the leg on the same side: the left arm is back when the left foot strikes.
      const arm = -Math.cos(this.gait + (i ? Math.PI : 0)) * swing * moving;
      const g =
        this.gestureWeight *
        (this.gesture === "both" ? 0.78 : (this.gesture === "right") === !L ? 1 : 0) *
        (1 - 0.6 * moving);
      const beat = this.beat * g;
      // Shrug with the breath; abduct a little so the hands clear the hips.
      setEuler(bones[clav]!, 0, 0, side * (breathe * 0.012 + 0.012));
      setEuler(
        bones[upper]!,
        0.04 + arm + g * 0.42,
        // About the vertical: the forearm comes in across the body.
        side * g * 0.32,
        side * (0.08 + 0.04 * run + g * 0.14),
      );
      setEuler(
        bones[fore]!,
        0.2 +
          0.12 * moving +
          1.05 * run * moving +
          Math.max(0, arm) * 0.35 +
          g * (1.05 + beat * 0.16),
        0,
        0,
      );
      // An open palm turned up and in while it gestures; relaxed toward the thigh otherwise.
      setEuler(bones[twist]!, 0, side * g * 0.85, 0);
      setEuler(bones[hand]!, 0.06 + g * -0.18, 0, -side * (0.08 - g * 0.1));
    }

    /* ----------------------------------------------- scarf tail */
    const tail = rig.tail;
    for (let k = 0; k < tail.length; k++) {
      const bone = bones[tail[k]!]!;
      const idle = Math.sin(t * 1.9 + k * 0.7 + this.phase0) * (0.03 + 0.02 * k);
      const step = sg * 0.06 * moving * (k + 1);
      setEuler(
        bone,
        Math.max(0, 0.08 * moving + 0.25 * run + idle * 0.4),
        0,
        step + idle,
      );
    }
  }

  /* ------------------------------------------------------------------ */
  /* James                                                               */
  /* ------------------------------------------------------------------ */

  private poseOctopus(cue: FigureCue, dt: number, reduced: boolean) {
    const rig = this.rig;
    const oc = rig.octopus!;
    const bones = rig.bones;
    this.reset();
    const t = this.t;
    const speed = this.speed / rig.scale;
    const moving = smooth(0.06, 0.5, speed);
    const turning = smooth(0.6, 2, Math.abs(this.yawRate)) * (1 - moving);
    const stepping = Math.max(moving, turning);
    // A crawl: half the arms reach while the other half push, twice a second at a walk.
    const cadence = 1.1 + speed * 0.9;
    if (stepping > 0.01)
      this.gait = (this.gait + Math.PI * 2 * cadence * dt) % (Math.PI * 2);

    // The head — mantle and face — bobs with the crawl and leans into it; the
    // arms hang from the hub, which stays put so their tips stay on the floor.
    const head = bones[oc.head]!;
    head.position.y +=
      Math.sin(this.gait * 2) * 0.018 * stepping +
      Math.sin(t * 1.3 + this.phase0) * 0.008;
    const breath = Math.sin((t * Math.PI * 2) / 3.2 + this.phase0) * 0.016;
    bones[oc.mantle]!.scale.set(1 + breath, 1 + breath * 0.6, 1 + breath);

    // The head — mantle and face together — turns toward what James attends to.
    this.aim(cue, 1.0, 0.45, dt, reduced);
    setEuler(
      head,
      this.headPitch * 0.5 - (cue.speaking ? this.beat * 0.02 : 0) - 0.1 * moving,
      this.headYaw,
      Math.sin(t * 0.9 + this.phase0) * 0.015 + Math.sin(this.gait) * 0.03 * moving,
    );

    // The arms: the client's sway (a wave that grows toward the tip, each arm
    // out of phase with the next), quicker while he talks; a crawl; and one
    // front arm raised to talk with.
    const omega = (Math.PI * 2) / (cue.speaking ? 1.6 : 3.6);
    oc.arms.forEach((chainBones, i) => {
      const a = oc.angles[i]!;
      const dir = _dir.set(Math.sin(a), 0, Math.cos(a));
      // Lift: about cross(dir, up), positive raises the arm.
      const liftAxis = _lift.crossVectors(dir, _up).normalize();
      const group = i % 2 ? Math.PI : 0;
      const crawl = Math.sin(this.gait + group);
      const raise = i === this.gestureArm ? this.gestureWeight : 0;
      chainBones.forEach((index, k) => {
        const bone = bones[index]!;
        const reach = (k + 1) / chainBones.length;
        const wave = reduced
          ? 0
          : Math.sin(omega * t + k * 0.55 + i * 1.7) * 0.11 * reach;
        let up = reduced
          ? 0.02
          : 0.025 +
            0.03 * (0.5 + 0.5 * Math.sin(omega * 0.7 * t + k * 0.8 + i * 2.3)) * reach;
        let yaw = wave * (1 - raise);
        if (k === 0) {
          up += Math.max(0, crawl) * 0.28 * stepping;
          // Swing the reaching arms forward: about +y, forward needs the sign of the arm's x.
          yaw += Math.cos(this.gait + group) * 0.22 * moving * Math.sign(dir.x || 1);
        }
        // A raised arm: up at the root, the tip curling over.
        up +=
          raise *
          (k === 0 ? 1.15 : k === 1 ? 0.55 : k === 2 ? 0.2 : -0.32 - this.beat * 0.1);
        _q.setFromAxisAngle(liftAxis, up);
        bone.quaternion.setFromAxisAngle(_up, yaw).multiply(_q);
      });
    });
  }

  /* ------------------------------------------------------------------ */
  /* Faces                                                               */
  /* ------------------------------------------------------------------ */

  private poseFace(reduced: boolean) {
    const { bones, face } = this.rig;
    // Lids: half, closed, half over 0.19 s, as in the client.
    let close = 0;
    if (!reduced)
      for (const start of [this.blinkAt, this.blinkAgain]) {
        const bt = this.t - start;
        if (bt >= 0 && bt < 0.19)
          close = Math.max(close, bt >= 0.05 && bt < 0.14 ? 1 : 0.5);
      }
    // The lids follow the eyes down, a little.
    const follow = Math.min(0, this.eyePitch) * 0.6 + Math.max(0, this.eyePitch) * 0.2;
    for (const lid of [face.lidL, face.lidR])
      setEuler(bones[lid]!, -close * 0.98 - follow, 0, 0);
    for (const eye of [face.eyeL, face.eyeR])
      setEuler(bones[eye]!, this.eyePitch, this.eyeYaw, 0);
    const m = bones[face.mouth]!;
    m.scale.set(1 - 0.15 * this.mouth, 1 + 2.3 * this.mouth, 1);
  }
}
