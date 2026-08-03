import { mulberry32 } from "@/lib/noise";
import type { WeaponClass, WeaponDef } from "../core/types";
import { damageAtRange } from "../core/types";
import { getWeapon } from "../weapons/arsenal";
import type { VoiceRender } from "./engine";
import {
  biquad,
  clamp,
  connectChain,
  db,
  gainNode,
  jitter,
  lerp,
  modeRing,
  noiseBurst,
  patter,
  range,
  scheduleEnv,
  sineSweep,
  slapBack,
  transientClick,
  waveshaper,
  type EnvironmentId,
  type Rand,
} from "./synth";

/**
 * Gunshot synthesis.
 *
 * A shot is four layers plus an environment, mixed live from the weapon's own
 * numbers — calibre (inferred from damage x muzzle velocity), barrel length
 * (inferred from class and velocity), rate of fire, and the deterministic
 * `seed` the arsenal already carries for its procedural model.
 *
 *   crack      2-4 ms attack, 20-45 ms decay, waveshaped filtered noise.
 *              The muzzle blast's shock front. Dominates inside ~30 m.
 *   body       60-180 Hz thump: lowpassed noise through a resonant bank plus
 *              a descending sine. The pressure wave; it is what carries.
 *   mechanism  2-4 bandpass noise transients at 1.2-4.5 kHz, 6-25 ms decay.
 *              Bolt unlock, carrier, ejection. Unmistakably "a gun", not "a bang".
 *   tail       convolved reverb for the space, plus discrete slap-backs off
 *              nearby structures at 40-400 ms.
 *
 * Distance is not a filter sweep. Three tuned variants — NEAR (crack-dominated),
 * MID and FAR (boom + tail, no crack at all) — are blended by weight, so a
 * rifle at 250 m is a different *sound*, not a quieter one.
 */

/* ------------------------------------------------------------------ */
/* Per-weapon timbre                                                   */
/* ------------------------------------------------------------------ */

export interface WeaponTone {
  id: string;
  weaponClass: WeaponClass;
  /** Fundamental of the pressure thump, 60-180 Hz. */
  bodyHz: number;
  /** Sub-octave for the chest punch. */
  subHz: number;
  bodyDecay: number;
  bodyLevel: number;
  /** Centre of the shock-front noise band. */
  crackHz: number;
  crackQ: number;
  crackDecay: number;
  crackLevel: number;
  /** Mechanism transients: [hz, delaySeconds, level]. */
  mech: readonly (readonly [number, number, number])[];
  mechLevel: number;
  /** Waveshaper drive on the crack. */
  drive: number;
  /** Overall level trim. */
  level: number;
  tailLevel: number;
  slapLevel: number;
  /** 0..1 — how bright the whole shot sits. */
  brightness: number;
  /** Rough calibre index, 0.25 (PDW) .. 3.2 (.50 BMG). */
  calibre: number;
  seed: number;
}

interface ClassTone {
  bodyHz: number;
  bodyDecay: number;
  bodyLevel: number;
  crackHz: number;
  crackQ: number;
  crackDecay: number;
  crackLevel: number;
  mechHz: readonly number[];
  mechLevel: number;
  drive: number;
  level: number;
  tailLevel: number;
  slapLevel: number;
  brightness: number;
}

/**
 * Class archetypes. These are the numbers that make an SMG instantly
 * distinguishable from an LMG before you have consciously identified either.
 */
const CLASS_TONE: Readonly<Record<WeaponClass, ClassTone>> = {
  assault: {
    bodyHz: 118, bodyDecay: 0.15, bodyLevel: 0.62,
    crackHz: 3500, crackQ: 0.85, crackDecay: 0.03, crackLevel: 1,
    mechHz: [2400, 3600, 1500], mechLevel: 0.3,
    drive: 2.6, level: 1, tailLevel: 0.5, slapLevel: 0.42, brightness: 0.72,
  },
  smg: {
    bodyHz: 152, bodyDecay: 0.095, bodyLevel: 0.46,
    crackHz: 3050, crackQ: 0.95, crackDecay: 0.021, crackLevel: 0.92,
    mechHz: [2800, 4100, 1900], mechLevel: 0.44,
    drive: 2.2, level: 0.86, tailLevel: 0.38, slapLevel: 0.3, brightness: 0.78,
  },
  lmg: {
    bodyHz: 84, bodyDecay: 0.29, bodyLevel: 0.86,
    crackHz: 3150, crackQ: 0.8, crackDecay: 0.038, crackLevel: 1.02,
    mechHz: [1750, 2900, 4400, 1150], mechLevel: 0.5,
    drive: 3.1, level: 1.1, tailLevel: 0.66, slapLevel: 0.55, brightness: 0.66,
  },
  marksman: {
    bodyHz: 99, bodyDecay: 0.25, bodyLevel: 0.74,
    crackHz: 4200, crackQ: 0.75, crackDecay: 0.034, crackLevel: 1.12,
    mechHz: [2200, 3400], mechLevel: 0.26,
    drive: 3, level: 1.12, tailLevel: 0.7, slapLevel: 0.6, brightness: 0.8,
  },
  sniper: {
    bodyHz: 70, bodyDecay: 0.42, bodyLevel: 0.95,
    crackHz: 4700, crackQ: 0.7, crackDecay: 0.046, crackLevel: 1.2,
    mechHz: [1900, 3100], mechLevel: 0.2,
    drive: 3.4, level: 1.22, tailLevel: 0.95, slapLevel: 0.78, brightness: 0.84,
  },
  shotgun: {
    bodyHz: 96, bodyDecay: 0.3, bodyLevel: 1.0,
    crackHz: 2150, crackQ: 0.5, crackDecay: 0.058, crackLevel: 0.98,
    mechHz: [1400, 2300], mechLevel: 0.34,
    drive: 3.6, level: 1.14, tailLevel: 0.62, slapLevel: 0.5, brightness: 0.5,
  },
  pistol: {
    bodyHz: 163, bodyDecay: 0.085, bodyLevel: 0.44,
    crackHz: 3400, crackQ: 1, crackDecay: 0.019, crackLevel: 0.86,
    mechHz: [2600, 3900], mechLevel: 0.42,
    drive: 2.1, level: 0.8, tailLevel: 0.36, slapLevel: 0.3, brightness: 0.76,
  },
  launcher: {
    bodyHz: 56, bodyDecay: 0.6, bodyLevel: 1.1,
    crackHz: 1250, crackQ: 0.45, crackDecay: 0.09, crackLevel: 0.7,
    mechHz: [900, 1600], mechLevel: 0.18,
    drive: 2.4, level: 1.15, tailLevel: 1, slapLevel: 0.8, brightness: 0.34,
  },
  melee: {
    bodyHz: 220, bodyDecay: 0.05, bodyLevel: 0.1,
    crackHz: 5200, crackQ: 1.4, crackDecay: 0.05, crackLevel: 0.16,
    mechHz: [3800], mechLevel: 0.12,
    drive: 1.2, level: 0.35, tailLevel: 0.05, slapLevel: 0, brightness: 0.9,
  },
};

const toneCache = new Map<string, WeaponTone>();

/**
 * Fold a `WeaponDef` into a timbre. Deterministic: same def, same tone, and
 * the per-weapon jitter comes from `def.seed`, so two 5.56 rifles with the
 * same class archetype still have their own voice.
 */
export function weaponTone(weaponId: string | undefined): WeaponTone {
  const def: WeaponDef = getWeapon(weaponId ?? "");
  const cached = toneCache.get(def.id);
  if (cached) return cached;

  const base = CLASS_TONE[def.weaponClass];
  const rand = mulberry32(def.seed >>> 0);
  const mv = Math.max(1, def.ballistics.muzzleVelocity);
  const pellets = Math.max(1, def.ballistics.pellets);
  const perShot = damageAtRange(def.ballistics.damage, 0) * pellets;

  // Momentum proxy, normalised so the reference 5.56 rifle lands on 1.0.
  const calibre = clamp((perShot * mv) / (33 * 880), 0.22, 3.2);
  // Faster round, sharper shock front; slower round, blunter.
  const velocityK = clamp(mv / 850, 0.3, 1.3);
  // Slow cyclic rate implies a heavy, long action.
  const rpmK = clamp(600 / Math.max(40, def.rpm), 0.5, 2.4);

  const bodyHz = jitter(
    rand,
    base.bodyHz * clamp(Math.pow(calibre, -0.26), 0.58, 1.5) * clamp(Math.pow(rpmK, -0.16), 0.8, 1.2),
    0.06,
  );
  const crackHz = jitter(rand, base.crackHz * (0.72 + 0.38 * velocityK), 0.07);
  const mech = base.mechHz.map((hz, i) => {
    const f = jitter(rand, hz, 0.11);
    // Heavier actions cycle later and louder.
    const delay = i === 0 ? 0.004 * rpmK : (0.012 + i * 0.017) * rpmK * range(rand, 0.85, 1.2);
    const level = i === 0 ? 1 : Math.pow(0.72, i) * range(rand, 0.75, 1.15);
    return [f, delay, level] as const;
  });

  const tone: WeaponTone = {
    id: def.id,
    weaponClass: def.weaponClass,
    bodyHz,
    subHz: bodyHz * 0.5 * range(rand, 0.94, 1.06),
    bodyDecay: base.bodyDecay * clamp(Math.pow(calibre, 0.38), 0.6, 2.1) * range(rand, 0.92, 1.1),
    bodyLevel: base.bodyLevel,
    crackHz,
    crackQ: base.crackQ * range(rand, 0.9, 1.12),
    crackDecay: base.crackDecay * clamp(Math.pow(calibre, 0.2), 0.72, 1.5) * range(rand, 0.9, 1.12),
    crackLevel: base.crackLevel,
    mech,
    mechLevel: base.mechLevel * clamp(Math.pow(rpmK, 0.18), 0.75, 1.35),
    drive: base.drive,
    level: base.level * clamp(Math.pow(calibre, 0.16), 0.72, 1.3),
    tailLevel: base.tailLevel,
    slapLevel: base.slapLevel,
    brightness: base.brightness,
    calibre,
    seed: def.seed >>> 0,
  };
  toneCache.set(def.id, tone);
  return tone;
}

/* ------------------------------------------------------------------ */
/* Distance variants                                                   */
/* ------------------------------------------------------------------ */

interface ShotTuning {
  crack: number;
  crackHzScale: number;
  crackDecayScale: number;
  crackAttack: number;
  body: number;
  bodyLp: number;
  bodyDecayScale: number;
  bodyAttack: number;
  mech: number;
  tail: number;
  slap: number;
  /** The far-only rolling boom: a slow, lowpassed swell with no transient. */
  boom: number;
  /** Absolute lowpass across the whole shot. */
  airLp: number;
  /** Absolute highpass — distance eats the sub before it eats the mids. */
  airHp: number;
}

/** Inside ~25 m: all shock front. This is the sound of being shot at. */
const NEAR: ShotTuning = {
  crack: 1, crackHzScale: 1, crackDecayScale: 1, crackAttack: 0.0022,
  body: 1, bodyLp: 900, bodyDecayScale: 1, bodyAttack: 0.003,
  mech: 1, tail: 0.6, slap: 0.5, boom: 0,
  airLp: 19000, airHp: 28,
};

/** 40-110 m: the crack has rolled off, the body has taken over. */
const MID: ShotTuning = {
  crack: 0.46, crackHzScale: 0.72, crackDecayScale: 1.5, crackAttack: 0.004,
  body: 1.25, bodyLp: 620, bodyDecayScale: 1.55, bodyAttack: 0.006,
  mech: 0.16, tail: 1.15, slap: 1.15, boom: 0.35,
  airLp: 5200, airHp: 46,
};

/** Past ~180 m: no crack at all, just a rolling boom and its reflections. */
const FAR: ShotTuning = {
  crack: 0.05, crackHzScale: 0.4, crackDecayScale: 2.6, crackAttack: 0.012,
  body: 1.05, bodyLp: 330, bodyDecayScale: 2.8, bodyAttack: 0.016,
  mech: 0, tail: 1.5, slap: 1.35, boom: 1,
  airLp: 1500, airHp: 62,
};

function blendTuning(distance: number): ShotTuning {
  // Two overlapping crossfades: near->mid across 18-70 m, mid->far across 70-220 m.
  const nearW = 1 - clamp((distance - 18) / 52, 0, 1);
  const farW = clamp((distance - 70) / 150, 0, 1);
  const midW = clamp(1 - nearW - farW, 0, 1);
  const sum = nearW + midW + farW || 1;
  const a = nearW / sum;
  const b = midW / sum;
  const c = farW / sum;
  const mix = (k: keyof ShotTuning): number => NEAR[k] * a + MID[k] * b + FAR[k] * c;
  return {
    crack: mix("crack"),
    crackHzScale: mix("crackHzScale"),
    crackDecayScale: mix("crackDecayScale"),
    crackAttack: mix("crackAttack"),
    body: mix("body"),
    bodyLp: mix("bodyLp"),
    bodyDecayScale: mix("bodyDecayScale"),
    bodyAttack: mix("bodyAttack"),
    mech: mix("mech"),
    tail: mix("tail"),
    slap: mix("slap"),
    boom: mix("boom"),
    airLp: mix("airLp"),
    airHp: mix("airHp"),
  };
}

/* ------------------------------------------------------------------ */
/* Slap-back geometry                                                  */
/* ------------------------------------------------------------------ */

/**
 * Round-trip echo times off the nearest structures. `structureDistanceM` is a
 * hint the game can update as the player moves from the open apron (60 m+) to
 * an alley between two hangars (8 m).
 */
function slapTaps(
  env: EnvironmentId,
  structureDistanceM: number,
  level: number,
  rand: Rand,
): (readonly [number, number])[] {
  const c = 343;
  const taps: (readonly [number, number])[] = [];
  if (level <= 0.001) return taps;
  const spread = env === "open-desert" ? [0.5, 1, 1.75, 2.7, 3.9] : [0.35, 0.7, 1.15, 1.9];
  const count = env === "hangar" ? 2 : env === "small-room" ? 1 : spread.length;
  for (let i = 0; i < count; i += 1) {
    const d = structureDistanceM * (spread[i] ?? 1) * range(rand, 0.9, 1.12);
    const t = (2 * d) / c;
    if (t < 0.035 || t > 0.45) continue;
    // Inverse-square on the round trip, plus the wall's own absorption.
    const g = level * Math.pow(0.62, i) * clamp(30 / (30 + d), 0.15, 1);
    taps.push([t, g] as const);
  }
  return taps;
}

/* ------------------------------------------------------------------ */
/* The shot                                                            */
/* ------------------------------------------------------------------ */

export interface ShotOptions {
  weaponId?: string;
  distance: number;
  env: EnvironmentId;
  /** Round-trip reference for slap-backs, metres. */
  structureDistanceM?: number;
  suppressed?: boolean;
  gain?: number;
  pitch?: number;
  variant?: number;
  indoor?: boolean;
}

/**
 * Render one shot into `dest`. Used by the engine for `fire` and by
 * `__offline.ts` for measurement; there is no second code path.
 */
export function renderShot(
  ctx: BaseAudioContext,
  dest: AudioNode,
  when: number,
  options: ShotOptions,
  rand: Rand,
  reverbBus: AudioNode | null,
  own?: (...nodes: AudioNode[]) => void,
): number {
  const tone = weaponTone(options.weaponId);
  const t = blendTuning(options.distance);
  const suppressed = options.suppressed ?? false;
  const pitch = options.pitch ?? 1;
  const gain = (options.gain ?? 1) * tone.level;
  const indoor = options.indoor ?? (options.env === "hangar" || options.env === "small-room");

  // Per-shot variation. Small, but enough that full-auto never loops.
  const vHz = range(rand, 0.965, 1.035);
  const vLevel = range(rand, 0.9, 1.06);
  const vDecay = range(rand, 0.92, 1.1);

  /* --- summing point, so slap-backs and the reverb send hear everything - */
  const sum = gainNode(ctx, gain * vLevel);
  const airLp = biquad(ctx, "lowpass", t.airLp, 0.62);
  const airHp = biquad(ctx, "highpass", t.airHp, 0.7);
  connectChain([sum, airLp, airHp]);
  airHp.connect(dest);
  const owned: AudioNode[] = [sum, airLp, airHp];

  let end = when;
  const mark = (v: number): void => {
    if (v > end) end = v;
  };

  if (suppressed) {
    /* -------------------------------------------------- suppressed -- */
    // A can turns the shock front into a blunt "thwip": most of the energy
    // dumped into a 700-1400 Hz band, and the action becomes the loudest thing.
    mark(
      noiseBurst(ctx, sum, when, {
        kind: "white",
        filter: "bandpass",
        freq: clamp(tone.bodyHz * 7 * pitch * vHz, 420, 1800),
        freqEnd: clamp(tone.bodyHz * 3.4 * pitch, 240, 900),
        q: 1.5,
        gain: 0.5 * tone.crackLevel,
        attack: 0.0035,
        decay: 0.055 * vDecay,
        drive: 1.4,
      }),
    );
    mark(
      noiseBurst(ctx, sum, when + 0.001, {
        kind: "white",
        filter: "highpass",
        freq: 5200,
        q: 0.7,
        gain: 0.1,
        attack: 0.001,
        decay: 0.022,
        rand,
      }),
    );
    mark(
      sineSweep(ctx, sum, when, {
        from: tone.bodyHz * 1.5 * pitch,
        to: tone.bodyHz * 0.72 * pitch,
        seconds: 0.05,
        gain: 0.3 * tone.bodyLevel,
        decay: 0.075 * vDecay,
      }),
    );
    // The mechanism is no longer masked — it is the signature of a can.
    for (const [hz, delay, level] of tone.mech) {
      mark(
        transientClick(ctx, sum, when + delay * 1.15, {
          freq: hz * pitch * vHz,
          q: 6.5,
          gain: 1.5 * tone.mechLevel * level,
          decay: 0.014 * vDecay,
          rand,
        }),
      );
    }
    mark(
      modeRing(ctx, sum, when + 0.002, [
        { hz: tone.crackHz * 0.55, q: 12, gain: 0.05 },
        { hz: tone.crackHz * 0.82, q: 14, gain: 0.035 },
      ], { decay: 0.09, rand }),
    );
  } else {
    /* ------------------------------------------------------- crack -- */
    if (t.crack > 0.02) {
      const crackHz = tone.crackHz * t.crackHzScale * pitch * vHz;
      const shaper = waveshaper(ctx, "asym", tone.drive, "2x");
      const crackOut = gainNode(ctx, 1);
      connectChain([shaper, crackOut]);
      crackOut.connect(sum);
      owned.push(shaper, crackOut);
      mark(
        noiseBurst(ctx, shaper, when, {
          kind: "white",
          filter: "bandpass",
          freq: crackHz,
          freqEnd: crackHz * 0.42,
          q: tone.crackQ,
          gain: 1.05 * tone.crackLevel * t.crack,
          attack: t.crackAttack,
          decay: tone.crackDecay * t.crackDecayScale * vDecay,
          rand,
        }),
      );
      // Shock-front snap: a 1.5 ms sliver of top end that sells "supersonic".
      mark(
        noiseBurst(ctx, shaper, when, {
          kind: "white",
          filter: "highpass",
          freq: clamp(crackHz * 1.7, 2000, 11000),
          q: 0.7,
          gain: 0.55 * tone.crackLevel * t.crack * tone.brightness,
          attack: 0.0006,
          decay: 0.0085 * vDecay,
          rand,
        }),
      );
      // Muzzle-blast mid: the "bark" between crack and body.
      mark(
        noiseBurst(ctx, sum, when + 0.0012, {
          kind: "pink",
          filter: "bandpass",
          freq: clamp(crackHz * 0.28, 320, 2400),
          freqEnd: clamp(crackHz * 0.14, 180, 1200),
          q: 0.9,
          gain: 0.62 * t.crack,
          attack: 0.0018,
          decay: 0.055 * vDecay,
          drive: 1.6,
          rand,
        }),
      );
    }

    /* -------------------------------------------------------- body -- */
    const bodyHz = tone.bodyHz * pitch * vHz;
    const bodyLp = biquad(ctx, "lowpass", clamp(t.bodyLp, 120, 4000), 1.1);
    const bodyOut = gainNode(ctx, t.body);
    connectChain([bodyLp, bodyOut]);
    bodyOut.connect(sum);
    owned.push(bodyLp, bodyOut);
    mark(
      noiseBurst(ctx, bodyLp, when, {
        kind: "brown",
        filter: "peaking",
        freq: bodyHz,
        q: 1.6,
        filterGainDb: 9,
        gain: 1.5 * tone.bodyLevel,
        attack: t.bodyAttack,
        decay: tone.bodyDecay * t.bodyDecayScale * vDecay,
        drive: 1.3,
        rand,
      }),
    );
    mark(
      sineSweep(ctx, bodyOut, when, {
        from: bodyHz * 2.4,
        to: bodyHz * 0.78,
        seconds: 0.055 + tone.bodyDecay * 0.5,
        gain: 0.66 * tone.bodyLevel,
        attack: t.bodyAttack,
        decay: tone.bodyDecay * t.bodyDecayScale * 1.1 * vDecay,
        harmonic: 0.22,
      }),
    );
    // Chest punch. Big calibres only; it is what a .50 has that a 9 mm doesn't.
    if (tone.calibre > 0.7) {
      mark(
        sineSweep(ctx, bodyOut, when + 0.004, {
          from: tone.subHz * 1.6 * pitch,
          to: tone.subHz * 0.7 * pitch,
          seconds: 0.09,
          gain: 0.5 * tone.bodyLevel * clamp(tone.calibre - 0.5, 0, 1.6),
          attack: 0.006,
          decay: tone.bodyDecay * 1.4 * t.bodyDecayScale,
        }),
      );
    }

    /* --------------------------------------------------- mechanism -- */
    if (t.mech > 0.02) {
      for (const [hz, delay, level] of tone.mech) {
        mark(
          transientClick(ctx, sum, when + delay * range(rand, 0.9, 1.12), {
            freq: hz * pitch * vHz,
            q: 5.5,
            gain: tone.mechLevel * level * t.mech,
            decay: (0.009 + level * 0.011) * vDecay,
            rand,
          }),
        );
      }
      // Belt links and a heavy carrier: the LMG's rattle.
      if (tone.weaponClass === "lmg") {
        mark(
          patter(ctx, sum, when + 0.02, {
            count: 4,
            seconds: 0.05,
            freq: 4200,
            q: 7,
            gain: 0.11 * t.mech,
            decay: 0.008,
            rand,
          }),
        );
      }
      // Shotgun: the wad and shot column leaving the choke.
      if (tone.weaponClass === "shotgun") {
        mark(
          noiseBurst(ctx, sum, when + 0.004, {
            kind: "white",
            filter: "bandpass",
            freq: 1500,
            freqEnd: 620,
            q: 0.8,
            gain: 0.5 * t.crack,
            attack: 0.004,
            decay: 0.1 * vDecay,
            rand,
          }),
        );
      }
    }
  }

  /* ------------------------------------------------ far-field boom -- */
  if (t.boom > 0.02) {
    // No transient at all: the wavefront has spread, the ground has absorbed
    // the top, and what is left is a slow swell with a long fall.
    const boomLp = biquad(ctx, "lowpass", 380, 0.9);
    const boomOut = gainNode(ctx, t.boom * 0.9);
    connectChain([boomLp, boomOut]);
    boomOut.connect(sum);
    owned.push(boomLp, boomOut);
    mark(
      noiseBurst(ctx, boomLp, when + 0.004, {
        kind: "brown",
        filter: "peaking",
        freq: tone.bodyHz * 0.85,
        q: 1.1,
        filterGainDb: 7,
        gain: 1.4 * tone.bodyLevel,
        attack: 0.02,
        decay: 0.34 + tone.bodyDecay * 1.6,
        shape: "exp",
        rand,
      }),
    );
    mark(
      sineSweep(ctx, boomOut, when + 0.006, {
        from: tone.bodyHz * 1.1,
        to: tone.bodyHz * 0.55,
        seconds: 0.3,
        gain: 0.5 * tone.bodyLevel,
        attack: 0.022,
        decay: 0.42,
      }),
    );
  }

  /* ------------------------------------------------------ mix trim -- */
  if (options.pitch !== undefined && options.pitch !== 1) {
    // Pitch trim also trims level slightly, the way a hotter load reads louder.
    sum.gain.value = sum.gain.value * clamp(1 / Math.pow(pitch, 0.4), 0.85, 1.18);
  }

  /* ---------------------------------------------------------- tail -- */
  const structureD = options.structureDistanceM ?? (indoor ? 14 : 48);
  const slapLevel = tone.slapLevel * t.slap * (suppressed ? 0.25 : 1) * (indoor ? 0.5 : 1);
  const taps = slapTaps(options.env, structureD, slapLevel, rand);
  if (taps.length > 0) {
    const slapNodes = slapBack(ctx, airHp, dest, taps, {
      cutoff: lerp(2600, 5200, tone.brightness),
      cutoffFalloff: 0.6,
      rand,
    });
    owned.push(...slapNodes);
    const lastTap = taps[taps.length - 1];
    if (lastTap) mark(end + lastTap[0] + 0.2);
  }

  if (reverbBus) {
    const wet = tone.tailLevel * t.tail * (suppressed ? 0.2 : 1) * (indoor ? 1.35 : 1);
    if (wet > 0.004) {
      const send = gainNode(ctx, wet);
      airHp.connect(send);
      send.connect(reverbBus);
      owned.push(send);
      mark(end + (options.env === "hangar" ? 2 : 0.9));
    }
  }

  own?.(...owned);
  return end;
}

/* ------------------------------------------------------------------ */
/* Engine-facing renderers                                             */
/* ------------------------------------------------------------------ */

function shotOptions(v: VoiceRender, suppressed: boolean): ShotOptions {
  return {
    weaponId: v.request.weaponId,
    distance: v.distance,
    env: v.env,
    suppressed,
    gain: 1,
    pitch: v.request.pitch,
    variant: v.request.variant,
    indoor: v.indoor,
    structureDistanceM: v.structureDistanceM,
  };
}

export function renderFire(v: VoiceRender): number {
  return renderShot(
    v.ctx,
    v.dest,
    v.when,
    shotOptions(v, false),
    v.rand,
    v.reverb?.bus(v.env) ?? null,
    v.own,
  );
}

export function renderSuppressedFire(v: VoiceRender): number {
  return renderShot(
    v.ctx,
    v.dest,
    v.when,
    shotOptions(v, true),
    v.rand,
    v.reverb?.bus(v.env) ?? null,
    v.own,
  );
}

/* ------------------------------------------------------------------ */
/* Foley                                                               */
/* ------------------------------------------------------------------ */

/** Hammer falls on an empty chamber: two clicks and a spring. */
export function renderDryFire(v: VoiceRender): number {
  const tone = weaponTone(v.request.weaponId);
  const { ctx, dest, when, rand } = v;
  let end = when;
  const mark = (t: number): void => {
    if (t > end) end = t;
  };
  mark(transientClick(ctx, dest, when, { freq: tone.crackHz * 0.62, q: 7, gain: 0.5, decay: 0.007, rand }));
  mark(transientClick(ctx, dest, when + 0.014, { freq: 1650, q: 5, gain: 0.24, decay: 0.012, rand }));
  mark(
    modeRing(ctx, dest, when + 0.002, [
      { hz: 4300 * range(rand, 0.95, 1.05), q: 16, gain: 0.06 },
      { hz: 6100, q: 20, gain: 0.03 },
    ], { decay: 0.09, rand }),
  );
  return end;
}

/** Hand off the grip, magazine slapped, weapon canted: cloth plus a tap. */
export function renderReloadStart(v: VoiceRender): number {
  const { ctx, dest, when, rand } = v;
  let end = clothRustle(ctx, dest, when, 0.19, 0.13, rand);
  const tap = transientClick(ctx, dest, when + 0.06, { freq: 1200, q: 3.4, gain: 0.14, decay: 0.02, rand });
  if (tap > end) end = tap;
  return end;
}

/** Catch released, magazine drops free and scrapes out of the well. */
export function renderReloadMagOut(v: VoiceRender): number {
  const tone = weaponTone(v.request.weaponId);
  const { ctx, dest, when, rand } = v;
  let end = when;
  const mark = (t: number): void => {
    if (t > end) end = t;
  };
  mark(transientClick(ctx, dest, when, { freq: 2950, q: 8, gain: 0.34, decay: 0.006, rand }));
  mark(
    noiseBurst(ctx, dest, when + 0.012, {
      kind: "white",
      filter: "bandpass",
      freq: 1350,
      freqEnd: 620,
      q: 1.9,
      gain: 0.22,
      attack: 0.004,
      decay: 0.13,
      rand,
    }),
  );
  mark(
    modeRing(ctx, dest, when + 0.01, [
      { hz: 1750 * (tone.calibre > 1.4 ? 0.8 : 1), q: 10, gain: 0.06 },
      { hz: 2830, q: 12, gain: 0.04 },
    ], { decay: 0.13, rand }),
  );
  mark(clothRustle(ctx, dest, when + 0.03, 0.12, 0.07, rand));
  return end;
}

/** Fresh magazine rocked in and struck home. */
export function renderReloadMagIn(v: VoiceRender): number {
  const tone = weaponTone(v.request.weaponId);
  const { ctx, dest, when, rand } = v;
  let end = when;
  const mark = (t: number): void => {
    if (t > end) end = t;
  };
  mark(clothRustle(ctx, dest, when, 0.1, 0.09, rand));
  // The thunk: polymer or steel against the magwell.
  mark(
    noiseBurst(ctx, dest, when + 0.05, {
      kind: "brown",
      filter: "lowpass",
      freq: 430,
      q: 1.4,
      gain: 0.62,
      attack: 0.0016,
      decay: 0.06,
      drive: 1.5,
      rand,
    }),
  );
  mark(transientClick(ctx, dest, when + 0.052, { freq: 2250, q: 4.5, gain: 0.42, decay: 0.011, rand }));
  // Latch.
  mark(transientClick(ctx, dest, when + 0.072, { freq: 3600, q: 9, gain: 0.2, decay: 0.005, rand }));
  mark(
    modeRing(ctx, dest, when + 0.052, [
      { hz: 620 * (tone.calibre > 1.4 ? 0.85 : 1), q: 8, gain: 0.07 },
      { hz: 1490, q: 11, gain: 0.045 },
    ], { decay: 0.11, rand }),
  );
  return end;
}

/** Bolt released or charging handle run: the sharpest sound on the weapon. */
export function renderReloadBolt(v: VoiceRender): number {
  const tone = weaponTone(v.request.weaponId);
  const { ctx, dest, when, rand } = v;
  const heavy = tone.calibre > 1.3 ? 1 : 0;
  let end = when;
  const mark = (t: number): void => {
    if (t > end) end = t;
  };
  // Carrier running forward.
  mark(
    noiseBurst(ctx, dest, when, {
      kind: "white",
      filter: "bandpass",
      freq: 2100,
      freqEnd: 3400,
      q: 1.6,
      gain: 0.3,
      attack: 0.002,
      decay: 0.026,
      rand,
    }),
  );
  // Lock-up.
  mark(
    transientClick(ctx, dest, when + 0.028, {
      freq: 3500 * (heavy ? 0.78 : 1),
      q: 7,
      gain: 0.68,
      decay: 0.0075,
      drive: 1.4,
      rand,
    }),
  );
  mark(
    noiseBurst(ctx, dest, when + 0.028, {
      kind: "brown",
      filter: "lowpass",
      freq: 260,
      gain: 0.34 + heavy * 0.2,
      attack: 0.0012,
      decay: 0.05,
      rand,
    }),
  );
  // Recoil-spring ring.
  mark(
    modeRing(ctx, dest, when + 0.03, [
      { hz: 3150 * range(rand, 0.97, 1.03), q: 18, gain: 0.075 },
      { hz: 4720, q: 22, gain: 0.05 },
      { hz: 6900, q: 26, gain: 0.026 },
    ], { decay: 0.17, rand }),
  );
  return end;
}

/** Weapon coming up: sling, gear, cloth and a soft handguard tap. */
export function renderWeaponRaise(v: VoiceRender): number {
  const { ctx, dest, when, rand } = v;
  let end = clothRustle(ctx, dest, when, 0.26, 0.2, rand);
  const mark = (t: number): void => {
    if (t > end) end = t;
  };
  mark(
    patter(ctx, dest, when + 0.03, {
      count: 3,
      seconds: 0.14,
      freq: 3400,
      q: 9,
      gain: 0.07,
      decay: 0.014,
      rand,
    }),
  );
  mark(transientClick(ctx, dest, when + 0.16, { freq: 1450, q: 4, gain: 0.13, decay: 0.017, rand }));
  return end;
}

/** Weapon coming down: the same foley, reversed in emphasis and duller. */
export function renderWeaponLower(v: VoiceRender): number {
  const { ctx, dest, when, rand } = v;
  let end = when;
  const mark = (t: number): void => {
    if (t > end) end = t;
  };
  mark(transientClick(ctx, dest, when, { freq: 1150, q: 3.4, gain: 0.11, decay: 0.02, rand }));
  mark(clothRustle(ctx, dest, when + 0.02, 0.22, 0.16, rand));
  mark(
    patter(ctx, dest, when + 0.1, {
      count: 2,
      seconds: 0.1,
      freq: 2600,
      q: 8,
      gain: 0.05,
      decay: 0.015,
      rand,
    }),
  );
  return end;
}

/**
 * Cloth and nylon. Every piece of weapon handling in the genre is 30% this,
 * and leaving it out is what makes procedural foley sound like a synthesiser.
 */
export function clothRustle(
  ctx: BaseAudioContext,
  dest: AudioNode,
  when: number,
  seconds: number,
  gain: number,
  rand: Rand,
): number {
  const bp = biquad(ctx, "bandpass", range(rand, 900, 1500), 0.9);
  const out = gainNode(ctx, 0);
  connectChain([bp, out]);
  out.connect(dest);
  const end = scheduleEnv(out.gain, when, {
    peak: gain,
    attack: seconds * 0.35,
    decay: seconds * 0.75,
    shape: "lin",
  });
  noiseBurst(ctx, bp, when, {
    kind: "pink",
    filter: "highpass",
    freq: 700,
    q: 0.7,
    gain: 1,
    attack: seconds * 0.3,
    hold: seconds * 0.2,
    decay: seconds * 0.6,
    shape: "lin",
    rand,
  });
  // A few fibre ticks so it is not a flat swell.
  patter(ctx, out, when + seconds * 0.15, {
    count: 3,
    seconds: seconds * 0.7,
    freq: 2600,
    freqSpread: 0.7,
    q: 6,
    gain: gain * 0.35,
    decay: 0.01,
    rand,
  });
  return end + 0.02;
}

/** Level trim so a distant shot still reads as a shot and not a click. */
export function shotLoudnessCompensation(distance: number): number {
  return db(clamp(distance * 0.045, 0, 9));
}
