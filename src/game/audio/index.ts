import type { SoundId } from "../core/types";
import {
  AudioEngine,
  type AudioEngineOptions,
  type VoiceRender,
  type VoiceRenderer,
} from "./engine";
import {
  renderDryFire,
  renderFire,
  renderReloadBolt,
  renderReloadMagIn,
  renderReloadMagOut,
  renderReloadStart,
  renderSuppressedFire,
  renderWeaponRaise,
} from "./weapons";
import {
  renderExplosion,
  renderFootstep,
  renderImpact,
  renderLand,
  renderRicochet,
  renderShellDrop,
  renderSlide,
  renderVault,
  renderWhizz,
} from "./world";
import {
  boneCrunch,
  metallicHitPing,
  modeRing,
  noiseBurst,
  proceduralRadioCallout,
  sineSweep,
  transientClick,
} from "./synth";

/**
 * The audio front end: one engine, and the map from sound id to the function
 * that synthesises it.
 */

/* ------------------------------------------------------------------ */
/* Feedback                                                            */
/* ------------------------------------------------------------------ */

/**
 * Signature Call of Duty hitmarker metallic ping.
 * Short, crisp, dry and above the mix — immediate hit confirmation.
 */
function renderHitmarker(v: VoiceRender): number {
  return metallicHitPing(v.ctx, v.dest, v.when, {
    gain: 0.52 * (v.request.gain ?? 1),
    pitch: v.request.pitch,
    rand: v.rand,
  });
}

/**
 * Heavy skull crunch and bass thud for headshot kills.
 * Visceral bone break + low sub-thump + high-Q helmet ding.
 */
function renderHeadshot(v: VoiceRender): number {
  return boneCrunch(v.ctx, v.dest, v.when, {
    gain: 0.78 * (v.request.gain ?? 1),
    rand: v.rand,
  });
}

function renderKill(v: VoiceRender): number {
  // Triple rising harmonic confirmation chord (880Hz, 1320Hz, 1760Hz) + crisp ping
  const end = modeRing(
    v.ctx,
    v.dest,
    v.when,
    [
      { hz: 880, q: 24, gain: 0.28 },
      { hz: 1320, q: 22, gain: 0.22 },
      { hz: 1760, q: 20, gain: 0.16 },
    ],
    { decay: 0.22, rand: v.rand },
  );
  return Math.max(end, renderHitmarker(v));
}

/** Taking a hit: a dull thump plus a brief ring, felt more than heard. */
function renderDamage(v: VoiceRender): number {
  let end = sineSweep(v.ctx, v.dest, v.when, {
    from: 200,
    to: 70,
    seconds: 0.14,
    gain: 0.5 * (v.request.gain ?? 1),
    attack: 0.001,
    decay: 0.22,
    rand: v.rand,
  });
  end = Math.max(
    end,
    noiseBurst(v.ctx, v.dest, v.when, {
      kind: "brown",
      filter: "lowpass",
      freq: 900,
      gain: 0.3,
      attack: 0.001,
      decay: 0.12,
      rand: v.rand,
    }),
  );
  return end;
}

function renderDeath(v: VoiceRender): number {
  return sineSweep(v.ctx, v.dest, v.when, {
    from: 320,
    to: 44,
    seconds: 0.9,
    gain: 0.55,
    attack: 0.004,
    decay: 1.1,
    harmonic: 0.25,
    rand: v.rand,
  });
}

function renderUiSelect(v: VoiceRender): number {
  return transientClick(v.ctx, v.dest, v.when, {
    freq: 1800,
    q: 6,
    gain: 0.18,
    decay: 0.03,
    rand: v.rand,
  });
}

/** Critical low-health dual-thump heartbeat. */
function renderHeartbeat(v: VoiceRender): number {
  const g = v.request.gain ?? 1;
  // First thump (lub)
  let end = sineSweep(v.ctx, v.dest, v.when, {
    from: 82,
    to: 36,
    seconds: 0.13,
    gain: 0.75 * g,
    attack: 0.005,
    decay: 0.14,
    rand: v.rand,
  });
  end = Math.max(
    end,
    noiseBurst(v.ctx, v.dest, v.when, {
      kind: "brown",
      filter: "lowpass",
      freq: 140,
      gain: 0.35 * g,
      attack: 0.004,
      decay: 0.11,
      rand: v.rand,
    }),
  );
  // Second thump (dub) slightly lighter, 140ms later
  end = Math.max(
    end,
    sineSweep(v.ctx, v.dest, v.when + 0.14, {
      from: 96,
      to: 44,
      seconds: 0.1,
      gain: 0.55 * g,
      attack: 0.004,
      decay: 0.11,
      rand: v.rand,
    }),
  );
  end = Math.max(
    end,
    noiseBurst(v.ctx, v.dest, v.when + 0.14, {
      kind: "brown",
      filter: "lowpass",
      freq: 160,
      gain: 0.25 * g,
      attack: 0.004,
      decay: 0.09,
      rand: v.rand,
    }),
  );
  return end;
}

/** Tactical squad radio click and squelch chirp. */
function renderRadioChirp(v: VoiceRender): number {
  const g = v.request.gain ?? 1;
  const click = transientClick(v.ctx, v.dest, v.when, {
    freq: 2200,
    q: 8,
    gain: 0.22 * g,
    decay: 0.025,
    rand: v.rand,
  });
  const noise = noiseBurst(v.ctx, v.dest, v.when + 0.01, {
    kind: "pink",
    filter: "bandpass",
    freq: 2400,
    q: 2.5,
    gain: 0.18 * g,
    attack: 0.002,
    decay: 0.04,
    rand: v.rand,
  });
  return Math.max(click, noise);
}

/* ------------------------------------------------------------------ */
/* Tactical Squad Radio Callouts                                       */
/* ------------------------------------------------------------------ */

function renderRadioContact(v: VoiceRender): number {
  return proceduralRadioCallout(v.ctx, v.dest, v.when, "contact-front", v.rand);
}

function renderRadioReloading(v: VoiceRender): number {
  return proceduralRadioCallout(v.ctx, v.dest, v.when, "reloading", v.rand);
}

function renderRadioHostileDown(v: VoiceRender): number {
  return proceduralRadioCallout(v.ctx, v.dest, v.when, "hostile-down", v.rand);
}

function renderRadioFragOut(v: VoiceRender): number {
  return proceduralRadioCallout(v.ctx, v.dest, v.when, "frag-out", v.rand);
}

function renderRadioChatter(v: VoiceRender): number {
  return proceduralRadioCallout(v.ctx, v.dest, v.when, "chatter", v.rand);
}

/* ------------------------------------------------------------------ */
/* Registry                                                            */
/* ------------------------------------------------------------------ */

const RENDERERS: Partial<Record<SoundId, VoiceRenderer>> = {
  fire: renderFire,
  "fire-suppressed": renderSuppressedFire,
  "dry-fire": renderDryFire,
  "reload-start": renderReloadStart,
  "reload-mag-out": renderReloadMagOut,
  "reload-mag-in": renderReloadMagIn,
  "reload-bolt": renderReloadBolt,
  "weapon-raise": renderWeaponRaise,

  impact: renderImpact,
  ricochet: renderRicochet,
  whizz: renderWhizz,
  explosion: renderExplosion,
  footstep: renderFootstep,
  land: renderLand,
  slide: renderSlide,
  vault: renderVault,
  "shell-drop": renderShellDrop,

  hitmarker: renderHitmarker,
  headshot: renderHeadshot,
  kill: renderKill,
  damage: renderDamage,
  death: renderDeath,
  heartbeat: renderHeartbeat,
  "radio-chirp": renderRadioChirp,
  "radio-contact": renderRadioContact,
  "radio-reloading": renderRadioReloading,
  "radio-hostile-down": renderRadioHostileDown,
  "radio-frag-out": renderRadioFragOut,
  "radio-chatter": renderRadioChatter,
  "ui-select": renderUiSelect,
  "ui-confirm": renderUiSelect,
};

let engine: AudioEngine | null = null;

/** Create the engine and register every renderer. Idempotent. */
export function createAudio(options: AudioEngineOptions = {}): AudioEngine {
  if (engine) return engine;
  engine = new AudioEngine(options);
  for (const [id, renderer] of Object.entries(RENDERERS)) {
    if (renderer) engine.register(id as SoundId, renderer);
  }
  return engine;
}

export function getAudio(): AudioEngine | null {
  return engine;
}

export function disposeAudio(): void {
  engine?.dispose();
  engine = null;
}

/** Exposed for the offline measurement harness in `tools/_audio.mjs`. */
export const __RENDERERS = RENDERERS;

export { AudioEngine };
export type { VoiceRender, VoiceRenderer };
