import { afterEach, describe, expect, it, vi } from "vitest";
import { HeadlessBethesdaLife } from "../life/headless";
import { witness, type LifeObservation } from "../life/observation";
import {
  addSample,
  followWitness,
  presentPose,
  span,
  type Feed,
  type Sample,
} from "./witnessFeed";

const life = new HeadlessBethesdaLife({
  seed: 393977,
  pedestrians: 12,
  vehicles: 2,
  buses: 1,
  statisticalPopulation: 30,
});
const base = life.observation({
  individual: "c".repeat(64),
  epoch: 2,
  checkpoint: { sequence: 0, tick: 0, committedUtc: "2026-10-26T15:00:00.000Z" },
  checkpointing: false,
  observedUtc: "2026-10-26T15:00:00.000Z",
});
const at = (tick: number, x: number, z: number, yaw = 0): LifeObservation => ({
  ...base,
  tick,
  fly: { ...base.fly, position: [x, 0, z], yaw },
});

describe("presenting the fly between observations", () => {
  it("keeps one sample per tick, the newest few", () => {
    let s: Sample[] = [];
    s = addSample(s, at(10, 0, 0), 0);
    s = addSample(s, at(10, 5, 5), 100);
    s = addSample(s, at(9, 5, 5), 200);
    expect(s).toHaveLength(1);
    for (let i = 0; i < 20; i++) s = addSample(s, at(11 + i, i, 0), 1000 * (i + 1), 8);
    expect(s).toHaveLength(8);
    expect(s.at(-1)!.tick).toBe(30);
  });

  it("interpolates behind the newest, and never goes past it", () => {
    const s = [at(10, 0, 0), at(20, 1, 2)].reduce<Sample[]>(
      (acc, o, i) => addSample(acc, o, i * 1000),
      [],
    );
    expect(presentPose(s, 500, 0)).toMatchObject({ x: 0.5, z: 1 });
    expect(presentPose(s, 5000, 0)).toMatchObject({ x: 1, z: 2 });
    expect(presentPose(s, -10, 0)).toMatchObject({ x: 0, z: 0 });
    expect(presentPose([], 0)).toBeNull();
  });

  it("turns the short way round", () => {
    const s = [at(10, 0, 0, 3.0), at(20, 0, 0, -3.0)].reduce<Sample[]>(
      (acc, o, i) => addSample(acc, o, i * 1000),
      [],
    );
    const { yaw } = presentPose(s, 500, 0)!;
    expect(Math.abs(Math.cos(yaw) + 1)).toBeLessThan(0.01);
  });

  it("jumps across a pause or a restart instead of gliding", () => {
    const far = [at(10, 0, 0), at(20, 50, 0)].reduce<Sample[]>(
      (acc, o, i) => addSample(acc, o, i * 1000),
      [],
    );
    expect(presentPose(far, 500, 0)).toMatchObject({ x: 50 });
    const late = [at(10, 0, 0), at(900, 1, 0)].reduce<Sample[]>(
      (acc, o, i) => addSample(acc, o, i * 1000),
      [],
    );
    expect(presentPose(late, 500, 0)).toMatchObject({ x: 1 });
  });
});

class FakeSource {
  static CLOSED = 2;
  static made: FakeSource[] = [];
  readyState = 1;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(readonly url: string) {
    FakeSource.made.push(this);
  }
  close() {
    this.closed = true;
  }
}

describe("following the witness", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    FakeSource.made = [];
  });

  it("passes on each witness it can read, reports the rest, and reopens a refused stream", () => {
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", FakeSource);
    const feeds: Feed[] = [];
    const stop = followWitness((f) => feeds.push(f), {
      origin: "https://observer.test",
      retryMs: 1000,
      now: () => 7,
    });
    const s = FakeSource.made[0]!;
    expect(s.url).toBe("https://observer.test/v1/stream");
    s.onmessage!({ data: JSON.stringify(witness(base, Date.parse(base.observedUtc))) });
    s.onmessage!({ data: JSON.stringify({ status: "live" }) });
    s.readyState = FakeSource.CLOSED;
    s.onerror!();
    expect(feeds.map((f) => f.kind)).toEqual(["connecting", "witness", "lost", "lost"]);
    expect(feeds[1]).toMatchObject({
      kind: "witness",
      at: 7,
      witness: { status: "live" },
    });
    expect(feeds[3]).toMatchObject({ last: { status: "live" } });
    vi.advanceTimersByTime(1000);
    expect(FakeSource.made).toHaveLength(2);
    stop();
    expect(FakeSource.made[1]!.closed).toBe(true);
  });
});

describe("spans", () => {
  it("reads as people say them", () => {
    expect([12, 125, 7500, 200_000].map(span)).toEqual([
      "12 s",
      "2 min",
      "2 h 5 min",
      "2 d 7 h",
    ]);
  });
});
