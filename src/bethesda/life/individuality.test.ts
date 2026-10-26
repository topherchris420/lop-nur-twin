import { describe, expect, it } from "vitest";
import { streamPosition } from "../../lib/noise";
import {
  eraseMemory,
  GENESIS,
  live,
  mindDigest,
  mindOf,
  probe,
  relocationLife,
  SITE_NAMES,
  SITES,
  trainingLife,
  YARD_LIFE,
  YardLife,
} from "./individuality";
import { signTest } from "./individualityReport";
import { restoreGraph } from "./snapshot";

describe("individuality: lives from one genesis", () => {
  it("draws distinct lives, each re-lived exactly from its record", () => {
    const a = trainingLife("east", 1),
      b = trainingLife("east", 2);
    expect(a).not.toEqual(b);
    const [x, z] = SITES.east;
    const at = a.journal[0]!.data.at as [number, number];
    expect(Math.hypot(at[0] - x, at[1] - z)).toBeLessThanOrEqual(0.3);
    const short = { ...a, end: Math.min(a.end, a.journal[0]!.tick + 1500) };
    const one = new YardLife(GENESIS),
      again = new YardLife(GENESIS),
      other = new YardLife(GENESIS);
    live(one, short.journal, short.end);
    live(again, short.journal, short.end);
    live(other, b.journal, short.end);
    expect(mindDigest(again)).toBe(mindDigest(one));
    expect(mindDigest(other)).not.toBe(mindDigest(one));
    expect(one.nav.places.length).toBeGreaterThan(0);
  }, 60_000);

  it("moves food among the sites, never to where it just was", () => {
    const { journal, epochs, end } = relocationLife(8, 3);
    expect(epochs).toHaveLength(8);
    expect(journal.map((e) => e.data.site)).toEqual(epochs.map((e) => e.site));
    for (let k = 1; k < epochs.length; k++) {
      expect(epochs[k]!.site).not.toBe(epochs[k - 1]!.site);
      expect(epochs[k]!.from).toBe(epochs[k - 1]!.to);
    }
    expect(end).toBe(epochs[7]!.to);
    expect(SITE_NAMES.every((s) => s in SITES)).toBe(true);
    expect(() =>
      YARD_LIFE.apply!(new YardLife(GENESIS), { tick: 0, kind: "gap", data: {} }),
    ).toThrow(/food events/);
  });

  it("erases remembered places and nothing else, and carries a mind into a probe", () => {
    const { journal, end } = trainingLife("west", 4);
    const life = new YardLife(GENESIS);
    live(life, journal, Math.min(end, journal[0]!.tick + 2000));
    const copy = new YardLife(GENESIS);
    restoreGraph(mindOf(life), copy.mind);
    expect(mindDigest(copy)).toBe(mindDigest(life));
    eraseMemory(copy.nav);
    expect(copy.nav.places).toEqual([]);
    expect(copy.nav.est).toEqual(life.nav.est);
    const rng = (l: YardLife) =>
      streamPosition((l.mind as unknown as { rng: () => number }).rng);
    expect(rng(copy)).toBe(rng(life));
    // Probes are deterministic, and an unlived mind probes alike whoever asks.
    const p = probe(mindOf(life), 0, 30),
      q = probe(mindOf(life), 0, 30);
    expect(q.digest).toBe(p.digest);
    expect(probe(null, 0, 30).digest).toBe(probe(null, 0, 30).digest);
  }, 60_000);

  it("computes an exact two-sided sign test", () => {
    expect(signTest([1, 1, 1, 1, 1])).toEqual({ up: 5, down: 0, p: 0.0625 });
    expect(signTest([1, -1, 0])).toEqual({ up: 1, down: 1, p: 1 });
    expect(signTest([0, 0]).p).toBeNull();
  });
});
