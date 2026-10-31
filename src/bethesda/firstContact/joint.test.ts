import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PLACE_IDS } from "../../garden/core/observation";
import { STAGES } from "../../garden/core/stage";
import { fitSimilarity2D } from "./frames";
import { GARDEN_SCALE, JointObserver, representations } from "./joint";
import { ECHO, EVA } from "./originals";
import fixture from "./fixtures/joint-2026-10-31.json" with { type: "json" };

interface Row {
  receivedUtc: string;
  stream: "eva" | "echo";
  sha256: string;
  status: number;
  body: string;
}
const rows = (fixture as { responses: Row[] }).responses;
const at = (iso: string) => Date.parse(iso) / 1000;

function loaded(mutate?: (stream: Row["stream"], body: Record<string, unknown>) => void) {
  const o = new JointObserver();
  for (const r of rows) {
    const body = JSON.parse(r.body) as Record<string, unknown>;
    mutate?.(r.stream, body);
    if (r.stream === "eva") o.addEva(body, at(r.receivedUtc));
    else o.addEcho(body, at(r.receivedUtc));
  }
  return o;
}

describe("the recorded fixture", () => {
  it("is what the endpoints sent", () => {
    for (const r of rows)
      expect(createHash("sha256").update(r.body).digest("hex")).toBe(r.sha256);
    expect(rows.filter((r) => r.stream === "eva")).toHaveLength(4);
    expect(rows.filter((r) => r.stream === "echo")).toHaveLength(15);
  });
});

describe("the joint observer", () => {
  it("accepts both originals' real states and keeps each one's own clock contract", () => {
    const o = loaded();
    expect(o.refusals).toEqual([]);
    expect(o.eva).toHaveLength(4);
    expect(o.echo.length).toBeGreaterThan(10);
    expect(o.eva.every((s) => s.clock.consistent)).toBe(true);
    expect(o.echo.every((s) => s.clock.consistent)).toBe(true);
    const c = o.clocks();
    expect(c.eva.gaps).toEqual([]);
    expect(c.echo.gaps).toEqual([]);
  });

  it("labels observed, interpolated, held and unavailable, and never extrapolates", () => {
    const o = loaded();
    const e0 = o.eva[0]!,
      e1 = o.eva[1]!;
    expect(o.viewAt(e0.utcS).eva.kind).toBe("observed");
    const mid = o.viewAt((e0.utcS + e1.utcS) / 2).eva;
    expect(mid.kind).toBe("interpolated");
    if (mid.kind === "interpolated") {
      expect(mid.u).toBeCloseTo(0.5, 9);
      // Discrete facts belong to the earlier state.
      expect(mid.later.activity).toBe(e0.activity);
    }
    const newest = o.eva.at(-1)!;
    const held = o.viewAt(newest.utcS + 3).eva;
    expect(held.kind).toBe("held");
    if (held.kind === "held") expect(held.sample).toBe(newest);
    expect(o.viewAt(newest.utcS + 31).eva.kind).toBe("unavailable");
    expect(o.viewAt(e0.utcS - 1).eva.kind).toBe("unavailable");
    const v = o.viewAt(e1.utcS);
    expect(v.separateWorlds).toBe(true);
  });

  it("refuses another individual instead of blending it in", () => {
    const o = loaded((stream, body) => {
      if (stream === "eva") body.life_id = "00000000-0000-0000-0000-000000000000";
      else (body.observation as Record<string, unknown>).individual = "f".repeat(64);
    });
    expect(o.eva).toHaveLength(0);
    expect(o.echo).toHaveLength(0);
    expect(o.refusals.filter((r) => /another individual/.test(r.reason)).length).toBe(
      rows.length,
    );
  });

  it("refuses a changed birth for the same life_id", () => {
    let n = 0;
    const o = loaded((stream, body) => {
      if (stream === "eva" && n++ === 2) body.born_at = (body.born_at as number) + 1;
    });
    expect(o.eva).toHaveLength(3);
    expect(o.refusals.some((r) => /born_at changed/.test(r.reason))).toBe(true);
  });

  it("refuses a witness that is not live", () => {
    const o = loaded((stream, body) => {
      if (stream === "echo") {
        body.status = "stale";
        body.reason = "the life stopped writing";
      }
    });
    expect(o.echo).toHaveLength(0);
  });

  it("computes each one's representation of the other and delivers it to neither", () => {
    const o = loaded();
    const from = Math.max(o.eva[0]!.utcS, o.echo[0]!.utcS),
      to = Math.min(o.eva.at(-1)!.utcS, o.echo.at(-1)!.utcS);
    expect(to).toBeGreaterThan(from);
    // Before both streams have a state there is nothing to represent.
    expect(representations(o.viewAt(from - 5), o.viewAt(to))).toBeNull();
    const reps = representations(o.viewAt(from), o.viewAt(to))!;
    expect(reps.map((x) => x.for)).toEqual(["Eva", "ECHO"]);
    expect(reps.every((x) => x.delivered === false)).toBe(true);
    // Eva slept at the windowsill throughout this recording.
    expect(reps[1]!.otherDisplacementM).toEqual([0, 0]);
  });

  it("names the right individuals", () => {
    expect(JSON.parse(rows.find((r) => r.stream === "eva")!.body).life_id).toBe(EVA.id);
    expect(
      JSON.parse(rows.find((r) => r.stream === "echo")!.body).observation.individual,
    ).toBe(ECHO.id);
  });
});

describe("the garden's metric scale", () => {
  it("is the clay page's staging, re-derived", () => {
    const fit = fitSimilarity2D(
      PLACE_IDS.map((p) => STAGES[p].plan),
      PLACE_IDS.map((p) => [STAGES[p].anchor[0], STAGES[p].anchor[2]] as const),
    );
    expect(Math.abs(fit.scale - GARDEN_SCALE.metresPerFraction)).toBeLessThan(1e-12);
    // atan2 may differ in the last bit between JavaScript engines (Bun's and Node's).
    expect(Math.abs(fit.angle - GARDEN_SCALE.angle)).toBeLessThan(1e-12);
    expect(Math.abs(fit.rmsResidual - GARDEN_SCALE.rmsResidualM)).toBeLessThan(1e-12);
    expect(PLACE_IDS.length).toBe(GARDEN_SCALE.places);
  });
});

describe("the originals' ids are the ones the repository records", () => {
  it("matches every file named in recordedIn", () => {
    for (const o of [EVA, ECHO])
      for (const f of o.recordedIn) expect(readFileSync(f, "utf8")).toContain(o.id);
  });
});
