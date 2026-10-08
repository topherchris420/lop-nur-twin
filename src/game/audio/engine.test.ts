import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { game } from "../core/gameState";
import { AudioEngine, pannerDistanceGain, TINNITUS_FLUTTER_DEPTH } from "./engine";
import type { VoiceRender } from "./engine";

/*
 * A Web Audio stand-in that records the graph and nothing else. It does not
 * synthesise: `peakAt()` walks the recorded connections and answers the
 * largest amplitude a source can reach a node with, treating every
 * oscillator as unit amplitude and every gain as its base value plus whatever
 * is connected into its AudioParam. That is enough to catch a modulator wired
 * into a gain whose base is 0 — the bug that left a 4 kHz tone playing.
 */

class FakeParam {
  readonly inputs: FakeNode[] = [];
  constructor(public value = 0) {}
  setValueAtTime(v: number): this {
    this.value = v;
    return this;
  }
  linearRampToValueAtTime(v: number): this {
    this.value = v;
    return this;
  }
  exponentialRampToValueAtTime(v: number): this {
    this.value = v;
    return this;
  }
  setTargetAtTime(v: number): this {
    this.value = v;
    return this;
  }
  cancelScheduledValues(): this {
    return this;
  }
}

class FakeNode {
  readonly inputs: FakeNode[] = [];
  outputs: (FakeNode | FakeParam)[] = [];
  constructor(readonly kind: string) {}
  connect<T extends FakeNode | FakeParam>(dest: T): T {
    this.outputs.push(dest);
    dest.inputs.push(this);
    return dest;
  }
  disconnect(): void {
    for (const out of this.outputs) {
      const i = out.inputs.indexOf(this);
      if (i >= 0) out.inputs.splice(i, 1);
    }
    this.outputs = [];
  }
}

class FakeGain extends FakeNode {
  readonly gain = new FakeParam(1);
  constructor() {
    super("gain");
  }
}

class FakeOscillator extends FakeNode {
  type = "sine";
  readonly frequency = new FakeParam(440);
  readonly detune = new FakeParam(0);
  constructor() {
    super("oscillator");
  }
  start(): void {}
  stop(): void {}
}

/** Peak amplitude reaching `node` from `source`, or from any oscillator. */
function peakAt(node: FakeNode, source?: FakeNode): number {
  if (node instanceof FakeOscillator)
    return source === undefined || node === source ? 1 : 0;
  let sum = 0;
  for (const input of node.inputs) sum += peakAt(input, source);
  if (node instanceof FakeGain) {
    let mod = 0;
    for (const input of node.gain.inputs) mod += peakAt(input);
    return sum * (Math.abs(node.gain.value) + mod);
  }
  return sum;
}

class FakeListener {
  readonly setPosition = vi.fn();
  readonly setOrientation = vi.fn();
}

class FakeAudioContext {
  static last: FakeAudioContext | null = null;
  state: string = "suspended";
  currentTime = 0;
  readonly sampleRate = 8000;
  readonly destination = new FakeNode("destination");
  listener: unknown = new FakeListener();
  readonly oscillators: FakeOscillator[] = [];
  readonly resume = vi.fn(async () => {
    this.state = "running";
  });
  private readonly handlers = new Set<() => void>();

  constructor() {
    FakeAudioContext.last = this;
  }
  addEventListener(_type: string, fn: () => void): void {
    this.handlers.add(fn);
  }
  removeEventListener(_type: string, fn: () => void): void {
    this.handlers.delete(fn);
  }
  setState(state: string): void {
    this.state = state;
    for (const fn of this.handlers) fn();
  }
  async close(): Promise<void> {
    this.state = "closed";
  }
  createGain(): FakeGain {
    return new FakeGain();
  }
  createOscillator(): FakeOscillator {
    const osc = new FakeOscillator();
    this.oscillators.push(osc);
    return osc;
  }
  createDynamicsCompressor(): FakeNode {
    return Object.assign(new FakeNode("compressor"), {
      threshold: new FakeParam(),
      knee: new FakeParam(),
      ratio: new FakeParam(),
      attack: new FakeParam(),
      release: new FakeParam(),
    });
  }
  createBiquadFilter(): FakeNode {
    return Object.assign(new FakeNode("biquad"), {
      type: "lowpass",
      frequency: new FakeParam(350),
      Q: new FakeParam(1),
      gain: new FakeParam(0),
    });
  }
  createPanner(): FakeNode {
    return Object.assign(new FakeNode("panner"), {
      positionX: new FakeParam(),
      positionY: new FakeParam(),
      positionZ: new FakeParam(),
    });
  }
  createConvolver(): FakeNode {
    return Object.assign(new FakeNode("convolver"), { normalize: true, buffer: null });
  }
  createBuffer(channels: number, frames: number): unknown {
    const data = Array.from({ length: channels }, () => new Float32Array(frames));
    return {
      numberOfChannels: channels,
      length: frames,
      getChannelData: (c: number) => data[c],
    };
  }
}

function tinnitusOsc(ctx: FakeAudioContext): FakeOscillator {
  const osc = ctx.oscillators.find((o) => o.frequency.value === 4080);
  if (!osc) throw new Error("no tinnitus oscillator");
  return osc;
}

let engine: AudioEngine | null = null;

beforeEach(() => {
  vi.stubGlobal("AudioContext", FakeAudioContext);
  game.soundQueue.length = 0;
  game.cameraPosition.set(0, 0, 0);
  game.player.suppression = 0;
});

afterEach(() => {
  engine?.dispose();
  engine = null;
  vi.unstubAllGlobals();
});

function make(options?: ConstructorParameters<typeof AudioEngine>[0]): FakeAudioContext {
  engine = new AudioEngine(options);
  return FakeAudioContext.last!;
}

describe("tinnitus", () => {
  it("is silent until something triggers it", async () => {
    const ctx = make();
    expect(peakAt(ctx.destination, tinnitusOsc(ctx))).toBe(0);
    await engine!.unlock();
    engine!.update(0.016);
    expect(peakAt(ctx.destination, tinnitusOsc(ctx))).toBe(0);
  });

  it("rings when triggered, with a flutter proportional to the ring", async () => {
    const ctx = make();
    await engine!.unlock();
    engine!.triggerTinnitus(1);
    engine!.update(0.016);
    const peak = peakAt(ctx.destination, tinnitusOsc(ctx));
    expect(peak).toBeGreaterThan(0);
    // Remove the flutter and the ring drops by exactly its relative depth.
    const lfo = ctx.oscillators.find((o) => o.frequency.value === 4.2)!;
    lfo.disconnect();
    expect(peakAt(ctx.destination, tinnitusOsc(ctx))).toBeCloseTo(
      peak / (1 + TINNITUS_FLUTTER_DEPTH),
      9,
    );
  });
});

describe("unlock", () => {
  it("resumes again after the browser suspends a running context", async () => {
    const ctx = make();
    const renderer = vi.fn((v: VoiceRender) => v.when + 0.1);
    engine!.register("ui-select", renderer);

    await engine!.unlock();
    expect(ctx.state).toBe("running");

    // iOS interruption: the context stops, and the next gesture must restart it.
    ctx.state = "suspended";
    await engine!.unlock();
    expect(ctx.resume).toHaveBeenCalledTimes(2);
    expect(ctx.state).toBe("running");

    game.soundQueue.push({ id: "ui-select" });
    engine!.update(0.016);
    expect(renderer).toHaveBeenCalledTimes(1);
  });

  it("tries to resume on its own when an unlocked context is interrupted", async () => {
    const ctx = make();
    ctx.setState("suspended"); // before any gesture: leave it alone
    expect(ctx.resume).not.toHaveBeenCalled();
    await engine!.unlock();
    ctx.setState("interrupted");
    expect(ctx.resume).toHaveBeenCalledTimes(2);
  });
});

describe("listener", () => {
  it("falls back to setPosition/setOrientation where AudioParams are missing", () => {
    const ctx = make();
    const listener = ctx.listener as FakeListener;
    game.cameraPosition.set(3, 4, 5);
    engine!.syncListener();
    expect(listener.setPosition).toHaveBeenCalledWith(3, 4, 5);
    const f = game.cameraForward;
    const u = game.cameraUp;
    expect(listener.setOrientation).toHaveBeenCalledWith(f.x, f.y, f.z, u.x, u.y, u.z);
  });
});

describe("line of sight and the wet level", () => {
  it("accepts an occlusion test after construction and scales wetGain like the dry path", async () => {
    make();
    const seen: VoiceRender[] = [];
    engine!.register("impact", (v) => {
      seen.push(v);
      return v.when + 0.1;
    });
    await engine!.unlock();

    const hasLineOfSight = vi.fn(() => false);
    engine!.setLineOfSight(hasLineOfSight);
    game.soundQueue.push({
      id: "impact",
      position: new THREE.Vector3(0, 0, -120),
      gain: 0.5,
    });
    engine!.update(0.016);

    expect(hasLineOfSight).toHaveBeenCalledTimes(1);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.wetGain).toBeCloseTo(0.5 * 0.45 * pannerDistanceGain(120), 9);
    expect(seen[0]!.wetGain!).toBeLessThan(0.05);
  });

  it("leaves a local, unpanned sound's wet level at its request gain", async () => {
    make();
    const seen: VoiceRender[] = [];
    engine!.register("ui-select", (v) => {
      seen.push(v);
      return v.when + 0.1;
    });
    await engine!.unlock();
    game.soundQueue.push({ id: "ui-select", gain: 0.7 });
    engine!.update(0.016);
    expect(seen[0]!.wetGain).toBeCloseTo(0.7, 9);
  });
});

describe("pannerDistanceGain", () => {
  it("matches the inverse model and is 1 inside the reference distance", () => {
    expect(pannerDistanceGain(0)).toBe(1);
    expect(pannerDistanceGain(6)).toBe(1);
    expect(pannerDistanceGain(66)).toBeCloseTo(6 / (6 + 0.9 * 60), 12);
    expect(pannerDistanceGain(1000)).toBe(pannerDistanceGain(400));
  });
});
