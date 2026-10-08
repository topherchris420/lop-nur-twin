import * as THREE from "three";
import { game } from "../core/gameState";
import type { SoundId, SoundRequest } from "../core/types";
import {
  ConvolverPool,
  gainNode,
  seededRand,
  type EnvironmentId,
  type Rand,
} from "./synth";

/**
 * The audio engine.
 *
 * Sounds are synthesised, never sampled — there are no audio files in this
 * repository and there will not be. Each `SoundRequest` drained from
 * `game.soundQueue` becomes a *voice*: a short-lived graph built by a renderer
 * function, scheduled at an absolute context time, and torn down when it has
 * finished sounding.
 *
 * Two decisions shape everything else here.
 *
 * **Voices are scheduled, not started.** Every renderer takes a `when` and
 * writes its whole envelope with `setValueAtTime`/`linearRampToValueAtTime`
 * ahead of the clock. That is what lets a 900 rpm weapon fire on time: the
 * main thread runs at whatever frame rate it manages, and a shot scheduled
 * 15 ms out lands exactly on the audio clock regardless.
 *
 * **Distance is a delay, not just a filter.** Sound covers 343 m/s, so a
 * firefight 200 m away arrives well over half a second late. Getting that
 * right is most of why a distant gunfight reads as distant, more than the
 * low-pass everyone reaches for first.
 */

/* ------------------------------------------------------------------ */
/* The contract renderers code against                                 */
/* ------------------------------------------------------------------ */

export interface ReverbPort {
  bus(env: EnvironmentId): AudioNode | null;
}

/** Everything a renderer needs to build one voice. */
export interface VoiceRender {
  ctx: BaseAudioContext;
  /** Where this voice's dry signal goes. */
  dest: AudioNode;
  /** Absolute context time the voice should begin. */
  when: number;
  request: SoundRequest;
  /** Metres from the listener. */
  distance: number;
  env: EnvironmentId;
  indoor: boolean;
  /** Round-trip distance to nearby structures, for slap-back timing. */
  structureDistanceM: number;
  rand: Rand;
  reverb: ReverbPort | null;
  /**
   * Register nodes so the engine disconnects them once the voice has finished
   * sounding. A renderer builds a whole graph per shot; without this the
   * engine would only know about the handful of nodes it made itself.
   */
  own(...nodes: AudioNode[]): void;
  /** True when the local player made this sound (no position, so no panning). */
  isLocal: boolean;
  /**
   * The level the engine applies to this voice's dry signal *after* `dest`:
   * request gain, occlusion and the panner's distance roll-off. A renderer that
   * taps a reverb send off `dest` scales the send by this, so the wet level
   * follows the dry one instead of arriving at full strength from 300 m away
   * or from behind a wall. Absent means 1 (the offline measurement harness).
   */
  wetGain?: number;
}

export type VoiceRenderer = (v: VoiceRender) => number;

/* ------------------------------------------------------------------ */
/* Buses                                                               */
/* ------------------------------------------------------------------ */

export type BusId = "weapons" | "world" | "ui" | "music";

interface Voice {
  nodes: AudioNode[];
  endsAt: number;
  priority: number;
}

const SPEED_OF_SOUND = 343;

/** Panner settings shared by `play()` and `pannerDistanceGain()`. */
const PANNER_REF_DISTANCE = 6;
const PANNER_ROLLOFF = 0.9;
const PANNER_MAX_DISTANCE = 400;

/**
 * Relative depth of the tinnitus flutter: the ring's level wobbles by this
 * fraction of itself. A fraction, not an absolute gain, so a silent ring stays
 * silent — an absolute LFO summed into a gain whose base is 0 is a 4 kHz tone
 * that never stops.
 */
export const TINNITUS_FLUTTER_DEPTH = 0.2;

/**
 * The gain an `inverse`-model `PannerNode` applies at `distance`, per the Web
 * Audio spec: ref / (ref + rolloff * (clamp(d, ref, max) - ref)).
 */
export function pannerDistanceGain(distance: number): number {
  const d = Math.min(PANNER_MAX_DISTANCE, Math.max(PANNER_REF_DISTANCE, distance));
  return (
    PANNER_REF_DISTANCE /
    (PANNER_REF_DISTANCE + PANNER_ROLLOFF * (d - PANNER_REF_DISTANCE))
  );
}

/** Higher wins when the voice cap is reached. */
const PRIORITY: Partial<Record<SoundId, number>> = {
  fire: 8,
  "fire-suppressed": 8,
  explosion: 10,
  death: 7,
  kill: 9,
  headshot: 9,
  hitmarker: 9,
  damage: 8,
  whizz: 7,
  "reload-mag-in": 6,
  "reload-bolt": 6,
  impact: 4,
  ricochet: 4,
  slide: 5,
  footstep: 2,
  heartbeat: 9,
  "radio-chirp": 7,
  "shell-drop": 1,
  "radio-contact": 8,
  "radio-reloading": 7,
  "radio-hostile-down": 7,
  "radio-frag-out": 8,
  "radio-chatter": 6,
};

export interface AudioEngineOptions {
  maxVoices?: number;
  /** Injected so the engine never depends on the physics module. */
  hasLineOfSight?: (from: THREE.Vector3, to: THREE.Vector3) => boolean;
}

const _listener = new THREE.Vector3();
const _source = new THREE.Vector3();

export class AudioEngine {
  readonly ctx: AudioContext;
  private readonly master: GainNode;
  private readonly suppressionLp: BiquadFilterNode;
  /** Envelope: 0 when there is no ringing, driven by `update()`. */
  private readonly tinnitusGain: GainNode;
  /** Flutter: 1 + lfo * depth, applied after the envelope. */
  private readonly tinnitusFlutter: GainNode;
  private readonly tinnitusOsc: OscillatorNode;
  private readonly tinnitusLfo: OscillatorNode;
  private readonly limiter: DynamicsCompressorNode;
  private readonly buses = new Map<BusId, GainNode>();
  private readonly reverb: ConvolverPool;
  private readonly voices: Voice[] = [];
  private readonly renderers = new Map<SoundId, VoiceRenderer>();
  private readonly maxVoices: number;
  private hasLineOfSight: AudioEngineOptions["hasLineOfSight"];
  private tinnitusIntensity = 0;
  /** True once a gesture has started the context at least once. */
  private unlocked = false;
  private readonly onStateChange = (): void => {
    // Safari and iOS suspend or "interrupt" a running context (a call, the tab
    // backgrounded). Once the user has unlocked audio, try to bring it back;
    // where the browser insists on a gesture, the host's next `unlock()` does.
    const state = this.ctx.state;
    if (!this.unlocked || state === "running" || state === "closed") return;
    this.ctx.resume().catch(() => {
      /* needs a gesture; unlock() will retry */
    });
  };

  constructor(options: AudioEngineOptions = {}) {
    this.hasLineOfSight = options.hasLineOfSight;
    this.maxVoices = options.maxVoices ?? 48;
    this.ctx = new AudioContext({ latencyHint: "interactive" });
    this.ctx.addEventListener("statechange", this.onStateChange);

    // A limiter, not a compressor doing limiter duty: eight simultaneous
    // gunshots must not clip, and nothing quieter should be touched.
    this.limiter = this.ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -6;
    this.limiter.knee.value = 3;
    this.limiter.ratio.value = 12;
    this.limiter.attack.value = 0.002;
    this.limiter.release.value = 0.14;

    this.master = gainNode(this.ctx, 0.8);
    this.master.connect(this.limiter);
    this.limiter.connect(this.ctx.destination);

    // Suppression / Acoustic trauma muffled lowpass filter
    this.suppressionLp = this.ctx.createBiquadFilter();
    this.suppressionLp.type = "lowpass";
    this.suppressionLp.frequency.value = 20000;
    this.suppressionLp.Q.value = 0.7071;
    this.suppressionLp.connect(this.master);

    // High-pitched 4kHz tinnitus ringing with subtle amplitude flutter:
    // osc -> envelope (intensity, base 0) -> flutter (1 + lfo * depth) -> master.
    // The LFO modulates a gain whose base is 1, downstream of the envelope, so
    // the flutter scales with the ring and is silent when the ring is.
    this.tinnitusOsc = this.ctx.createOscillator();
    this.tinnitusOsc.type = "sine";
    this.tinnitusOsc.frequency.value = 4080;
    this.tinnitusGain = gainNode(this.ctx, 0);
    this.tinnitusFlutter = gainNode(this.ctx, 1);

    this.tinnitusLfo = this.ctx.createOscillator();
    this.tinnitusLfo.type = "sine";
    this.tinnitusLfo.frequency.value = 4.2;
    const lfoDepth = gainNode(this.ctx, TINNITUS_FLUTTER_DEPTH);
    this.tinnitusLfo.connect(lfoDepth);
    lfoDepth.connect(this.tinnitusFlutter.gain);

    this.tinnitusOsc.connect(this.tinnitusGain);
    this.tinnitusGain.connect(this.tinnitusFlutter);
    this.tinnitusFlutter.connect(this.master);
    this.tinnitusOsc.start(0);
    this.tinnitusLfo.start(0);

    for (const id of ["weapons", "world", "ui", "music"] as BusId[]) {
      const bus = gainNode(this.ctx, id === "music" ? 0.5 : 1);
      // Route through suppression filter, except UI which remains crisp
      if (id === "ui") {
        bus.connect(this.master);
      } else {
        bus.connect(this.suppressionLp);
      }
      this.buses.set(id, bus);
    }

    this.reverb = new ConvolverPool(this.ctx, this.suppressionLp, 0.9);
  }

  /** Trigger acute explosion or heavy suppressive fire tinnitus ringing (fades over 2-3s). */
  triggerTinnitus(intensity = 1): void {
    this.tinnitusIntensity = Math.min(1, Math.max(this.tinnitusIntensity, intensity));
  }

  /** Register the renderer for a sound id. */
  register(id: SoundId, renderer: VoiceRenderer): void {
    this.renderers.set(id, renderer);
  }

  /**
   * Browsers block audio until a gesture; call this from every click or key.
   * Not one-shot: Safari and iOS suspend or interrupt a context that was
   * already running, and only a later gesture may resume it, so every call
   * resumes whenever the context is not running.
   */
  async unlock(): Promise<void> {
    const state = this.ctx.state;
    if (state === "closed") return;
    if (state !== "running") {
      try {
        await this.ctx.resume();
      } catch {
        return;
      }
    }
    if (this.ctx.state !== "running") return;
    if (!this.unlocked) this.reverb.warm();
    this.unlocked = true;
  }

  /**
   * Install or replace the occlusion test after construction. The engine is a
   * singleton, so whichever caller happens to create it first must not decide
   * for good whether occlusion exists.
   */
  setLineOfSight(fn: AudioEngineOptions["hasLineOfSight"]): void {
    this.hasLineOfSight = fn;
  }

  setMasterVolume(value: number): void {
    this.master.gain.setTargetAtTime(Math.max(0, value), this.ctx.currentTime, 0.02);
  }

  setBusVolume(id: BusId, value: number): void {
    this.buses
      .get(id)
      ?.gain.setTargetAtTime(Math.max(0, value), this.ctx.currentTime, 0.02);
  }

  private busFor(id: SoundId): GainNode {
    if (id.startsWith("ui-")) return this.buses.get("ui")!;
    if (
      id === "fire" ||
      id === "fire-suppressed" ||
      id.startsWith("reload") ||
      id === "dry-fire"
    ) {
      return this.buses.get("weapons")!;
    }
    return this.buses.get("world")!;
  }

  /**
   * Which space a sound is in. The compound is open desert with a handful of
   * very large sheds; being inside one changes the tail completely, so it is
   * worth the single downward raycast the caller supplies.
   */
  private environmentFor(position: THREE.Vector3 | undefined): {
    env: EnvironmentId;
    indoor: boolean;
    structureDistanceM: number;
  } {
    if (!position) return { env: "open-desert", indoor: false, structureDistanceM: 60 };
    const world = game.world;
    if (!world) return { env: "open-desert", indoor: false, structureDistanceM: 60 };
    // A ceiling directly overhead means a hangar; otherwise judge by how close
    // the nearest wall is.
    const up = _source.set(0, 1, 0);
    const from = _listener.copy(position).setY(position.y + 1.2);
    const ceiling = world.raycast(from, up, 24);
    if (ceiling) {
      return { env: "hangar", indoor: true, structureDistanceM: ceiling.distance * 2 };
    }
    return { env: "open-desert", indoor: false, structureDistanceM: 70 };
  }

  /** Drain `game.soundQueue` and schedule a voice for each request. */
  update(dt: number): void {
    if (this.unlocked && this.ctx.state === "running") {
      // 1. Suppression muffling and tinnitus ringing updates
      this.tinnitusIntensity = Math.max(0, this.tinnitusIntensity - dt * 0.38);
      const playerSupp = game.player.alive ? game.player.suppression : 0;
      const eff = Math.min(1, Math.max(playerSupp, this.tinnitusIntensity));
      const now = this.ctx.currentTime;

      if (eff > 0.03) {
        const cutoff = Math.max(420, 20000 * Math.pow(0.02, eff));
        this.suppressionLp.frequency.setTargetAtTime(cutoff, now, 0.04);
      } else {
        this.suppressionLp.frequency.setTargetAtTime(20000, now, 0.08);
      }

      if (eff > 0.12) {
        const ringGain = Math.min(0.18, (eff - 0.12) * 0.22);
        this.tinnitusGain.gain.setTargetAtTime(ringGain, now, 0.04);
      } else {
        this.tinnitusGain.gain.setTargetAtTime(0, now, 0.08);
      }
    }

    const queue = game.soundQueue;
    if (queue.length === 0) {
      this.reap();
      return;
    }
    if (!this.unlocked || this.ctx.state !== "running") {
      queue.length = 0;
      return;
    }

    for (const request of queue) {
      // Proximity to explosions causes acute acoustic trauma & tinnitus
      if (request.id === "explosion" && request.position) {
        const dist = game.cameraPosition.distanceTo(request.position);
        if (dist < 18) {
          const trauma = 1 - dist / 18;
          this.triggerTinnitus(trauma);
        }
      }
      this.play(request);
    }
    queue.length = 0;
    this.reap();
  }

  private play(request: SoundRequest): void {
    const renderer = this.renderers.get(request.id);
    if (!renderer) return;

    const now = this.ctx.currentTime;
    let distance = 0;
    let occluded = false;
    if (request.position) {
      _listener.copy(game.cameraPosition);
      _source.copy(request.position);
      distance = _listener.distanceTo(_source);
      if (distance > 400) return;
      if (this.hasLineOfSight && distance > 4) {
        occluded = !this.hasLineOfSight(_listener, _source);
      }
    }

    // The arrival delay is the single most important cue for distance.
    const when = now + 0.012 + distance / SPEED_OF_SOUND;
    const priority = PRIORITY[request.id] ?? 3;
    if (!this.reserve(priority)) return;

    const { env, indoor, structureDistanceM } = this.environmentFor(request.position);

    // Per-voice chain: gain for distance and occlusion, then a low-pass whose
    // corner falls with distance (air absorption) and again behind cover.
    const voiceGain = gainNode(this.ctx, 1);
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    const airCorner = 20000 * Math.pow(0.5, distance / 90);
    filter.frequency.value = Math.max(320, occluded ? airCorner * 0.28 : airCorner);
    filter.Q.value = 0.6;

    let output: AudioNode = filter;
    let panner: PannerNode | null = null;
    if (request.position && distance > 0.5) {
      panner = this.ctx.createPanner();
      panner.panningModel = "HRTF";
      panner.distanceModel = "inverse";
      panner.refDistance = PANNER_REF_DISTANCE;
      panner.rolloffFactor = PANNER_ROLLOFF;
      panner.maxDistance = PANNER_MAX_DISTANCE;
      panner.positionX.value = request.position.x;
      panner.positionY.value = request.position.y;
      panner.positionZ.value = request.position.z;
      filter.connect(panner);
      output = panner;
    }
    output.connect(voiceGain);
    const postGain = (request.gain ?? 1) * (occluded ? 0.45 : 1);
    voiceGain.gain.value = postGain;
    voiceGain.connect(this.busFor(request.id));

    const nodes: AudioNode[] = [voiceGain, filter];
    if (panner) nodes.push(panner);

    const endsAt = renderer({
      ctx: this.ctx,
      dest: filter,
      when,
      request,
      distance,
      env,
      indoor,
      structureDistanceM,
      rand: seededRand(request.id, request.weaponId ?? "", request.variant ?? 0),
      reverb: this.reverb,
      own: (...extra) => nodes.push(...extra),
      isLocal: !request.position,
      wetGain: postGain * (panner ? pannerDistanceGain(distance) : 1),
    });

    this.voices.push({ nodes, endsAt: Math.max(endsAt, when + 0.05), priority });
  }

  /** Make room for a voice of the given priority; false if it should be dropped. */
  private reserve(priority: number): boolean {
    if (this.voices.length < this.maxVoices) return true;
    let weakest = -1;
    let weakestPriority = priority;
    for (let i = 0; i < this.voices.length; i += 1) {
      const voice = this.voices[i]!;
      if (voice.priority < weakestPriority) {
        weakestPriority = voice.priority;
        weakest = i;
      }
    }
    // Never steal a louder, more important voice for a quieter one — a distant
    // footstep must not cut off the player's own gunshot.
    if (weakest < 0) return false;
    this.stop(weakest);
    return true;
  }

  private stop(index: number): void {
    const voice = this.voices[index];
    if (!voice) return;
    for (const node of voice.nodes) node.disconnect();
    this.voices.splice(index, 1);
  }

  /** Disconnect voices that have finished sounding. */
  private reap(): void {
    const now = this.ctx.currentTime;
    for (let i = this.voices.length - 1; i >= 0; i -= 1) {
      if (this.voices[i]!.endsAt <= now) this.stop(i);
    }
  }

  /** Keep the listener on the camera. */
  syncListener(): void {
    const listener = this.ctx.listener;
    const p = game.cameraPosition;
    const f = game.cameraForward;
    const u = game.cameraUp;
    // Firefox has no AudioParam position/orientation on the listener; without
    // the older setters there, the listener would sit at the origin for good.
    if (listener.positionX) {
      listener.positionX.value = p.x;
      listener.positionY.value = p.y;
      listener.positionZ.value = p.z;
      listener.forwardX.value = f.x;
      listener.forwardY.value = f.y;
      listener.forwardZ.value = f.z;
      listener.upX.value = u.x;
      listener.upY.value = u.y;
      listener.upZ.value = u.z;
    } else {
      listener.setPosition(p.x, p.y, p.z);
      listener.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z);
    }
  }

  dispose(): void {
    this.ctx.removeEventListener("statechange", this.onStateChange);
    for (let i = this.voices.length - 1; i >= 0; i -= 1) this.stop(i);
    this.reverb.dispose();
    try {
      this.tinnitusOsc.stop();
      this.tinnitusLfo.stop();
      this.tinnitusOsc.disconnect();
      this.tinnitusLfo.disconnect();
      this.tinnitusGain.disconnect();
      this.tinnitusFlutter.disconnect();
      this.suppressionLp.disconnect();
    } catch {
      /* already disconnected */
    }
    this.master.disconnect();
    this.limiter.disconnect();
    void this.ctx.close();
  }
}
