import { SURFACE_PROFILES, type SurfaceType } from "../core/types";
import type { VoiceRender } from "./engine";
import {
  modeRing,
  noiseBurst,
  patter,
  range,
  reverbSend,
  sineSweep,
  transientClick,
  type Mode,
} from "./synth";

/**
 * World sounds: impacts, ricochets, supersonic cracks, explosions, footsteps.
 *
 * The through-line is that a material is characterised by *what rings*, not by
 * a colour of noise. Concrete has no modes worth hearing and reads as a dry
 * crack plus falling grit; sheet metal has strong, long-lived modes and reads
 * almost entirely as pitch; sand has neither and is a pure thud. So each
 * surface here is a short transient plus a resonator bank tuned to it, and the
 * balance between the two is what tells you what you just hit.
 */

interface SurfaceVoice {
  /** Resonant modes; empty for materials that do not ring. */
  modes: readonly Mode[];
  ringDecay: number;
  /** Centre frequency of the impact transient. */
  crackHz: number;
  crackDecay: number;
  crackGain: number;
  /** Loose debris thrown off the impact. */
  debris: number;
  debrisHz: number;
}

const SURFACE_VOICES: Readonly<Record<SurfaceType, SurfaceVoice>> = {
  concrete: { modes: [], ringDecay: 0.05, crackHz: 2100, crackDecay: 0.07, crackGain: 0.55, debris: 8, debrisHz: 3600 },
  metal: {
    modes: [{ hz: 780, q: 42, gain: 0.5 }, { hz: 1730, q: 38, gain: 0.34 }, { hz: 3120, q: 30, gain: 0.2 }],
    ringDecay: 0.42, crackHz: 3400, crackDecay: 0.035, crackGain: 0.42, debris: 0, debrisHz: 0,
  },
  "thin-metal": {
    modes: [{ hz: 1180, q: 30, gain: 0.55 }, { hz: 2460, q: 26, gain: 0.3 }],
    ringDecay: 0.3, crackHz: 3900, crackDecay: 0.03, crackGain: 0.5, debris: 0, debrisHz: 0,
  },
  sand: { modes: [], ringDecay: 0.03, crackHz: 420, crackDecay: 0.09, crackGain: 0.4, debris: 5, debrisHz: 1400 },
  gravel: { modes: [], ringDecay: 0.04, crackHz: 900, crackDecay: 0.08, crackGain: 0.45, debris: 12, debrisHz: 2600 },
  glass: {
    modes: [{ hz: 2600, q: 34, gain: 0.4 }, { hz: 4400, q: 28, gain: 0.28 }],
    ringDecay: 0.22, crackHz: 5200, crackDecay: 0.04, crackGain: 0.6, debris: 16, debrisHz: 5200,
  },
  wood: {
    modes: [{ hz: 320, q: 14, gain: 0.4 }, { hz: 680, q: 11, gain: 0.22 }],
    ringDecay: 0.12, crackHz: 1500, crackDecay: 0.06, crackGain: 0.5, debris: 4, debrisHz: 2000,
  },
  rubber: { modes: [], ringDecay: 0.03, crackHz: 260, crackDecay: 0.05, crackGain: 0.35, debris: 0, debrisHz: 0 },
  fabric: { modes: [], ringDecay: 0.03, crackHz: 620, crackDecay: 0.05, crackGain: 0.22, debris: 0, debrisHz: 0 },
  flesh: { modes: [], ringDecay: 0.03, crackHz: 190, crackDecay: 0.08, crackGain: 0.5, debris: 0, debrisHz: 0 },
  foliage: { modes: [], ringDecay: 0.03, crackHz: 2400, crackDecay: 0.07, crackGain: 0.2, debris: 3, debrisHz: 3200 },
};

function surfaceOf(v: VoiceRender): SurfaceType {
  return v.request.surface ?? "concrete";
}

/* ------------------------------------------------------------------ */
/* Impacts                                                            */
/* ------------------------------------------------------------------ */

export function renderImpact(v: VoiceRender): number {
  const surface = surfaceOf(v);
  const spec = SURFACE_VOICES[surface];
  let end = v.when;

  end = Math.max(end, transientClick(v.ctx, v.dest, v.when, {
    freq: spec.crackHz,
    q: 1.4,
    gain: spec.crackGain,
    decay: spec.crackDecay,
    drive: 1.6,
    rand: v.rand,
  }));

  if (spec.modes.length > 0) {
    end = Math.max(end, modeRing(v.ctx, v.dest, v.when + 0.001, spec.modes, {
      decay: spec.ringDecay,
      detune: 0.04,
      rand: v.rand,
    }));
  }

  if (spec.debris > 0) {
    end = Math.max(end, patter(v.ctx, v.dest, v.when + 0.018, {
      count: spec.debris,
      seconds: 0.22,
      freq: spec.debrisHz,
      gain: 0.13,
      decay: 0.035,
      rand: v.rand,
    }));
  }

  const send = reverbSend(v.ctx, v.reverb as never, v.env, v.when, v.indoor ? 0.32 : 0.08, 0.04);
  if (send) {
    v.dest.connect(send);
    v.own(send);
  }
  return end + 0.05;
}

/** A deflection: the same transient, then a descending whine as it spins away. */
export function renderRicochet(v: VoiceRender): number {
  const surface = surfaceOf(v);
  const profile = SURFACE_PROFILES[surface];
  const start = range(v.rand, 2400, 3600);
  let end = renderImpact(v);
  end = Math.max(end, noiseBurst(v.ctx, v.dest, v.when + 0.01, {
    kind: "white",
    filter: "bandpass",
    freq: start,
    freqEnd: start * 0.32,
    q: 14,
    gain: 0.3 * (0.4 + profile.ricochetChance),
    attack: 0.004,
    decay: range(v.rand, 0.22, 0.42),
    rand: v.rand,
  }));
  return end;
}

/**
 * A round going past your head.
 *
 * This is a shockwave, not a whistle: the pitch sweeps *down* hard as the
 * round passes, and the whole event is under 40 ms. Getting the direction of
 * the sweep wrong is the difference between "someone is shooting at me" and a
 * cartoon ricochet.
 */
export function renderWhizz(v: VoiceRender): number {
  return noiseBurst(v.ctx, v.dest, v.when, {
    kind: "white",
    filter: "bandpass",
    freq: range(v.rand, 2600, 4200),
    freqEnd: range(v.rand, 700, 1100),
    q: 6,
    gain: 0.5,
    attack: 0.0015,
    decay: 0.035,
    rate: 1.25,
    rateEnd: 0.7,
    rand: v.rand,
  });
}

/* ------------------------------------------------------------------ */
/* Explosions                                                          */
/* ------------------------------------------------------------------ */

export function renderExplosion(v: VoiceRender): number {
  let end = v.when;
  end = Math.max(end, sineSweep(v.ctx, v.dest, v.when, {
    from: 140,
    to: 26,
    seconds: 0.7,
    gain: 0.9,
    attack: 0.002,
    decay: 0.9,
    harmonic: 0.3,
    rand: v.rand,
  }));
  end = Math.max(end, noiseBurst(v.ctx, v.dest, v.when, {
    kind: "brown",
    filter: "lowpass",
    freq: 2600,
    freqEnd: 320,
    gain: 0.85,
    attack: 0.001,
    decay: 1.1,
    drive: 2.4,
    rand: v.rand,
  }));
  end = Math.max(end, patter(v.ctx, v.dest, v.when + 0.18, {
    count: 26,
    seconds: 1.3,
    freq: 2200,
    gain: 0.1,
    decay: 0.05,
    rand: v.rand,
  }));
  const send = reverbSend(v.ctx, v.reverb as never, v.env, v.when, 0.7, 0.3);
  if (send) {
    v.dest.connect(send);
    v.own(send);
  }
  return end + 0.4;
}

/* ------------------------------------------------------------------ */
/* Movement                                                            */
/* ------------------------------------------------------------------ */

const STEP_TONE: Partial<Record<SurfaceType, { freq: number; decay: number; grit: number }>> = {
  concrete: { freq: 720, decay: 0.05, grit: 4 },
  gravel: { freq: 1500, decay: 0.07, grit: 12 },
  sand: { freq: 380, decay: 0.06, grit: 7 },
  metal: { freq: 1100, decay: 0.09, grit: 0 },
};

export function renderFootstep(v: VoiceRender): number {
  const surface = surfaceOf(v);
  const tone = STEP_TONE[surface] ?? STEP_TONE["sand"]!;
  const gain = v.request.gain ?? 0.5;
  let end = noiseBurst(v.ctx, v.dest, v.when, {
    kind: "brown",
    filter: "lowpass",
    freq: tone.freq,
    gain: 0.34 * gain,
    attack: 0.002,
    decay: tone.decay,
    rand: v.rand,
  });
  if (tone.grit > 0) {
    end = Math.max(end, patter(v.ctx, v.dest, v.when + 0.008, {
      count: tone.grit,
      seconds: 0.05,
      freq: 3200,
      gain: 0.06 * gain,
      decay: 0.02,
      rand: v.rand,
    }));
  }
  // Gear rattle: the cue that a *soldier* walked past rather than a footstep.
  end = Math.max(end, noiseBurst(v.ctx, v.dest, v.when + 0.02, {
    kind: "white",
    filter: "bandpass",
    freq: 4200,
    q: 2,
    gain: 0.05 * gain,
    attack: 0.003,
    decay: 0.05,
    rand: v.rand,
  }));
  return end;
}

export function renderLand(v: VoiceRender): number {
  const gain = v.request.gain ?? 0.6;
  let end = sineSweep(v.ctx, v.dest, v.when, {
    from: 150,
    to: 52,
    seconds: 0.11,
    gain: 0.5 * gain,
    attack: 0.001,
    decay: 0.16,
    rand: v.rand,
  });
  end = Math.max(end, renderFootstep(v));
  return end;
}

export function renderSlide(v: VoiceRender): number {
  return noiseBurst(v.ctx, v.dest, v.when, {
    kind: "pink",
    filter: "bandpass",
    freq: 1600,
    freqEnd: 520,
    q: 1.2,
    gain: 0.34,
    attack: 0.02,
    decay: 0.75,
    rand: v.rand,
  });
}

export function renderVault(v: VoiceRender): number {
  return noiseBurst(v.ctx, v.dest, v.when, {
    kind: "brown",
    filter: "lowpass",
    freq: 900,
    gain: 0.3,
    attack: 0.006,
    decay: 0.24,
    rand: v.rand,
  });
}

export function renderShellDrop(v: VoiceRender): number {
  return modeRing(v.ctx, v.dest, v.when, [
    { hz: range(v.rand, 3100, 4300), q: 26, gain: 0.22 },
    { hz: range(v.rand, 6200, 7600), q: 20, gain: 0.12 },
  ], { decay: 0.12, rand: v.rand });
}
