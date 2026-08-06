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
import { modeRing, noiseBurst, sineSweep, transientClick } from "./synth";

/**
 * The audio front end: one engine, and the map from sound id to the function
 * that synthesises it.
 */

/* ------------------------------------------------------------------ */
/* Feedback                                                            */
/* ------------------------------------------------------------------ */

/** A hit confirmation. Short, dry and above the mix — never in the world. */
function renderHitmarker(v: VoiceRender): number {
  return transientClick(v.ctx, v.dest, v.when, {
    freq: 2600,
    q: 3,
    gain: 0.3,
    decay: 0.045,
    rand: v.rand,
  });
}

function renderHeadshot(v: VoiceRender): number {
  const end = renderHitmarker(v);
  return Math.max(
    end,
    modeRing(
      v.ctx,
      v.dest,
      v.when + 0.01,
      [
        { hz: 3400, q: 24, gain: 0.24 },
        { hz: 5100, q: 20, gain: 0.14 },
      ],
      { decay: 0.16, rand: v.rand },
    ),
  );
}

function renderKill(v: VoiceRender): number {
  // Two rising partials: the genre's "confirmed" cue without a melody.
  const end = modeRing(
    v.ctx,
    v.dest,
    v.when,
    [
      { hz: 880, q: 20, gain: 0.2 },
      { hz: 1320, q: 18, gain: 0.14 },
    ],
    { decay: 0.2, rand: v.rand },
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
