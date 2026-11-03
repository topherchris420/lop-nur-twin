/**
 * Regression checks for the adaptation-and-continuity benchmarks that run in
 * CI on every change. A full split takes minutes per individual, so CI checks
 * what can be checked quickly and exactly:
 *
 * - the judging rules are the ones fixed before any result;
 * - the originals' judge decides only what its inputs can decide;
 * - a research life survives a checkpoint, text and restore unchanged, and a
 *   copy of it is someone else, on short lives of every release;
 * - the published report follows from its archived records, byte for byte.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { format, resolveConfig } from "prettier";
import { describe, expect, it } from "vitest";
import {
  birth,
  checkpointLife,
  restoreLife,
  twinCheckpoint,
  type LifeEvent,
} from "../life/continuity.js";
import { relocationLife } from "../life/individuality.js";
import {
  BENCHMARKS,
  DEV,
  HELDOUT,
  INDIVIDUALS,
  judgeResearch,
  type ResearchMeasures,
} from "./benchmarks.js";
import {
  judgeOriginals,
  measureEcho,
  measureEva,
  type OriginalsInput,
  type RecordedResponse,
} from "./originals.js";
import { buildReport, publishedCommit, RESULTS_DIR } from "./publish.js";
import { RELEASES } from "./releases.js";
import { renderReadme } from "./report.js";
import { genesisOf, liveEpochs } from "./study.js";

const est = (low: number, mean = low + 1) => ({
  n: 24,
  mean,
  ci95: [low, low + 2] as [number, number],
});
const measures = (o: Partial<ResearchMeasures> = {}): ResearchMeasures => ({
  b1: est(0.1),
  b2: est(0.5),
  m1: { n: 24, mean: 0.2, ci95: [0.1, 0.3] },
  c1: { identical: 24, n: 24 },
  c2: null,
  c3: null,
  c4: { someoneElse: 24, n: 24 },
  ...o,
});

describe("the benchmarks as fixed", () => {
  it("has thirteen, each with a question, a measure and a rule", () => {
    expect(BENCHMARKS.map((b) => b.id)).toEqual([
      "B1",
      "B2",
      "M1",
      "C1",
      "C2",
      "C3",
      "C4",
      "E1",
      "E2",
      "E3",
      "O1",
      "O2",
      "O3",
    ]);
    for (const b of BENCHMARKS) expect(b.question && b.measure && b.passes).toBeTruthy();
  });

  it("keeps the splits apart and complete", () => {
    expect(DEV.genesisSeed).not.toBe(HELDOUT.genesisSeed);
    for (const s of [DEV, HELDOUT]) {
      expect(s.training).toHaveLength(INDIVIDUALS);
      expect(s.relocation).toHaveLength(INDIVIDUALS);
      expect(s.nonces).toHaveLength(INDIVIDUALS);
      for (const n of s.nonces) expect(n).toMatch(/^[0-9a-f]{32}$/);
    }
    expect(DEV.relocation.filter((d) => HELDOUT.relocation.includes(d))).toEqual([]);
  });

  it("passes an interval only when its lower bound is above zero", () => {
    expect(judgeResearch(measures()).B2).toBe("pass");
    expect(judgeResearch(measures({ b2: est(0) })).B2).toBe("fail");
    expect(judgeResearch(measures({ b2: est(-1) })).B2).toBe("fail");
    expect(judgeResearch(measures({ b1: { n: 1, mean: 1, ci95: null } })).B1).toBe(
      "fail",
    );
  });

  it("needs every individual for an all-or-nothing benchmark", () => {
    expect(judgeResearch(measures({ c1: { identical: 23, n: 24 } })).C1).toBe("fail");
    expect(judgeResearch(measures({ c4: { someoneElse: 0, n: 0 } })).C4).toBe("fail");
  });

  it("holds M1 below its threshold, and C2 and C3 not applicable to the baseline", () => {
    expect(judgeResearch(measures({ m1: { n: 24, mean: 0.5, ci95: null } })).M1).toBe(
      "fail",
    );
    const v = judgeResearch(measures());
    expect([v.C2, v.C3]).toEqual(["not applicable", "not applicable"]);
    expect(
      judgeResearch(measures({ c2: { kept: 24, n: 24 }, c3: est(-0.5) })),
    ).toMatchObject({ C2: "pass", C3: "fail" });
  });
});

// ---------------------------------------------------------------- originals

const FIXTURE = "src/bethesda/firstContact/fixtures/joint-2026-10-31.json";
const fixture = (): RecordedResponse[] =>
  (
    JSON.parse(readFileSync(FIXTURE, "utf8")) as {
      responses: (RecordedResponse & { body: string })[];
    }
  ).responses;

/** The same responses a day later: the clocks advanced by one day, nothing else. */
function dayLater(rs: RecordedResponse[], o: { epoch?: number; lifeId?: string } = {}) {
  return rs.map((r) => {
    const body = JSON.parse(r.body) as Record<string, unknown>;
    const receivedUtc = new Date(Date.parse(r.receivedUtc) + 86_400_000).toISOString();
    if (r.stream === "eva") {
      const ticks = (body.ticks as number) + 17_280;
      body.ticks = ticks;
      body.updated_at = (body.born_at as number) + 5 * ticks;
      body.server_time = (body.server_time as number) + 86_400;
      if (o.lifeId) body.life_id = o.lifeId;
    } else {
      const ob = body.observation as Record<string, unknown> | null;
      if (ob) {
        ob.tick = (ob.tick as number) + 864_000;
        ob.simulatedSeconds = (ob.tick as number) * 0.1;
        ob.observedUtc = new Date(
          Date.parse(ob.observedUtc as string) + 86_400_000,
        ).toISOString();
        if (o.epoch !== undefined) ob.epoch = o.epoch;
      }
      body.servedUtc = receivedUtc;
    }
    return { ...r, receivedUtc, body: JSON.stringify(body) };
  });
}

const LEDGER_INDIVIDUAL =
  "04f8c797b6971a46138dabc3fdfde5baae2aa224d3a8f9c0099a7c207dec1921";
const replayLine = (passed: boolean, required: boolean) =>
  JSON.stringify({
    schema: "bethesda-life-replay/v1",
    seenUtc: "2026-11-02T22:23:01Z",
    passed,
    reason: null,
    individual: LEDGER_INDIVIDUAL,
    from: { sequence: 10, tick: 100, digest: "a".repeat(64) },
    to: passed
      ? { sequence: 11, tick: 200, digest: "b".repeat(64) }
      : { sequence: 10, tick: 100, digest: "a".repeat(64) },
    head: { sequence: 11, tick: 200, digest: "b".repeat(64) },
    reproduced: passed ? 1 : 0,
    ticks: passed ? 100 : 0,
    seals: { required, reproduced: passed && required ? 1 : 0 },
    machine: { node: "v24", platform: "linux", arch: "arm64" },
    difference: passed ? null : { sequence: 11, field: "graphDigest" },
    stopped: null,
    run: "https://github.com/topherchris420/lop-nur-twin/actions/runs/1",
  });

function judge(responses: RecordedResponse[], replays = "") {
  const input: OriginalsInput = { responses, ledger: "", replays };
  return judgeOriginals(measureEva(input), measureEcho(input));
}

describe("the originals' judge", () => {
  it("cannot judge identity from one day, and never judges adaptation", () => {
    const v = judge(fixture());
    expect(v).toMatchObject({
      E1: "untestable",
      E2: "untestable",
      E3: "untestable",
      O1: "untestable",
      O2: "untestable",
      O3: "untestable",
    });
  });

  it("passes E1 across two days of the same life, and fails a new life", () => {
    expect(judge([...fixture(), ...dayLater(fixture())]).E1).toBe("pass");
    expect(
      judge([...fixture(), ...dayLater(fixture(), { lifeId: "someone-else" })]).E1,
    ).toBe("fail");
  });

  it("needs a restart between the observations before O1 can pass", () => {
    const fx = fixture();
    expect(judge([...fx, ...dayLater(fx)]).O1).toBe("untestable");
    const epoch = (
      JSON.parse(fx.find((r) => r.stream === "echo")!.body) as {
        observation: { epoch: number };
      }
    ).observation.epoch;
    expect(judge([...fx, ...dayLater(fx, { epoch: epoch + 1 })]).O1).toBe("pass");
  });

  it("fails O2 on any failed sealed replay, and ignores unsealed ones", () => {
    const fx = fixture();
    expect(judge(fx, replayLine(true, true)).O2).toBe("pass");
    expect(
      judge(fx, [replayLine(true, true), replayLine(false, true)].join("\n")).O2,
    ).toBe("fail");
    expect(judge(fx, replayLine(false, false)).O2).toBe("untestable");
  });
});

// ------------------------------------------------------------- continuity

/** A short relocation life: Study B's first two moves, cut to 60 s each. */
function shortLife() {
  const r = relocationLife(2, DEV.relocation[0]!);
  const epochs = r.epochs.map((e, i) => ({ ...e, from: i * 600, to: (i + 1) * 600 }));
  const journal: LifeEvent[] = r.journal.map((e, i) => ({ ...e, tick: i * 600 }));
  return { epochs, journal };
}

describe.each(Object.keys(RELEASES))("a research life on %s", (name) => {
  const { kind } = RELEASES[name]!;
  const g = genesisOf(DEV);
  const b0 = birth(kind.id, g, DEV.nonces[0]!);

  it("is the same individual after a checkpoint, text and restore", () => {
    const { epochs, journal } = shortLife();
    const life = kind.build(structuredClone(g));
    const born = checkpointLife(kind, life, { genesis: g, birth: b0, previous: null });
    liveEpochs(life, epochs.slice(0, 1), journal, 0);
    const cp = checkpointLife(kind, life, {
      genesis: g,
      birth: b0,
      previous: born,
      events: journal.filter((e) => e.tick < life.tick),
    });
    const restored = restoreLife(kind, JSON.parse(JSON.stringify(cp)) as typeof cp);
    const a = liveEpochs(life, epochs, journal, 1);
    const b = liveEpochs(restored, epochs, journal, 1);
    expect(b).toEqual(a);
    expect(kind.hash(restored)).toBe(kind.hash(life));

    const twin = twinCheckpoint(cp, "c".repeat(32));
    expect(twin.birth.individual).not.toBe(cp.birth.individual);
    expect(twin.birth.twinOf).toMatchObject({
      individual: b0.individual,
      digest: cp.digest,
    });
    expect(() =>
      checkpointLife(kind, restoreLife(kind, twin), {
        genesis: g,
        birth: twin.birth,
        previous: cp,
      }),
    ).toThrow(/its own individual/);
  }, 120_000);
});

// -------------------------------------------------------------- the report

describe("the published report", () => {
  const dir = RESULTS_DIR;
  const published = existsSync(join(dir, "README.md"));

  it.skipIf(!published)(
    "follows from its archived files, byte for byte",
    async () => {
      const r = buildReport(dir);
      const check = async (name: string, text: string) => {
        const path = join(dir, name);
        const formatted = await format(text, {
          ...((await resolveConfig(path)) ?? {}),
          filepath: path,
        });
        expect(formatted, `${name} no longer follows from its records`).toBe(
          readFileSync(path, "utf8"),
        );
      };
      await check("summary.json", JSON.stringify(r));
      await check("README.md", renderReadme(r, publishedCommit(dir)));
    },
    60_000,
  );

  it.skipIf(!published)("was written from a commit, and its flies ran on one", () => {
    const readme = readFileSync(join(dir, "README.md"), "utf8");
    expect(publishedCommit(dir)).toMatch(/^`[0-9a-f]{7,40}`$/);
    expect(readme).not.toMatch(/a working tree \(not a result\)/);
  });
});
