/**
 * A rehearsal of the plasticity continuation on a disposable copy of the deployed
 * fly's backup (docs/EVA_ECHO_ACTIVATION.md). It copies the store it is given and
 * works on the copy, so it cannot touch the original; a backup is not the life,
 * and what a copy does is never part of the individual's history. Nothing here
 * reaches the VM. Meant for the VM's platform (Linux arm64), where the deployed
 * fly's numbers reproduce (.github/workflows/echo-plasticity-rehearsal.yml).
 *
 * In order, each writing lines to --out as soon as it knows them:
 *
 *   chain       the copy's whole chain verifies, on this release's rules
 *   source      the head restores on the release that wrote it
 *   engine      this release's organism lives on from it exactly as that release's
 *   boundary    the continuation: what it adds, what it keeps, byte for byte
 *   refusal     neither organism engine will restore the continued checkpoint
 *   restart     two restores of the continuation stay the same life
 *   lockstep    the source release's organism beside the continued life in shadow
 *               mode: everything but the addition must stay identical throughout
 *   projection  after the lockstep, the continued graph minus the addition is the
 *               organism's graph, random streams included
 *   sample      one line each simulated minute in shadow mode, committed like the runner,
 *               with a stop and start from the store halfway
 *   policy      on the copy: shadow to active to disabled, each a recorded checkpoint
 *   runner      the real runner resumes the copy on this release; it still verifies
 *   old         the source release's runner refuses the continued store
 *   summary     what came of it
 *
 *   node --max-old-space-size=8192 scripts/run-ts.mjs scripts/bethesda-life-rehearse-plasticity.ts \
 *     --store DIR --from-release DIR --out FILE [--hours 24] [--lockstep-ticks 36000] [--wall-minutes 300]
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { arch, platform, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { sha256, sha256Json } from "../src/rain/sha256.js";
import {
  checkpointLife,
  divergence,
  restoreLife,
  type LifeCheckpoint,
  type LifeEvent,
  type LifeKind,
} from "../src/bethesda/life/continuity.js";
import { bethesdaStoreKind } from "../src/bethesda/life/bethesdaStore.js";
import type { HeadlessGenesis } from "../src/bethesda/life/headless.js";
import { ORGANISM_LIFE, type OrganismLife } from "../src/bethesda/life/organism.js";
import {
  PLASTICITY_CONTINUATION_SOURCE,
  PLASTICITY_LIFE,
  plasticityModeOf,
  plasticityProjection,
  type PlasticityOrganismLife,
} from "../src/bethesda/life/plasticOrganism.js";
import {
  changePlasticityPolicy,
  continueWithPlasticity,
} from "../src/bethesda/life/plasticityContinuation.js";
import { indexGraph, snapshotGraph } from "../src/bethesda/life/snapshot.js";
import { LifeStore } from "../src/bethesda/life/store.js";

const self = process.argv.findIndex((a) =>
  a.endsWith("bethesda-life-rehearse-plasticity.ts"),
);
const args = process.argv.slice(self + 1);
function option(name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}
const given = option("store"),
  previous = option("from-release"),
  out = option("out");
if (!given || !previous || !out)
  throw new Error("needs --store, --from-release and --out");
const HOURS = Number(option("hours") ?? 24);
const LOCKSTEP_TICKS = Number(option("lockstep-ticks") ?? 36_000);
const WALL_MS = Number(option("wall-minutes") ?? 300) * 60_000;
/** As the runner: a checkpoint every five simulated minutes, a sample each minute. */
const CHECKPOINT_TICKS = 3000;
const SAMPLE_TICKS = 600;
const LOCKSTEP_STEP = 100;

const started = Date.now();
const write = (row: object) => appendFileSync(out, `${JSON.stringify(row)}\n`);
const say = (what: string) =>
  process.stderr.write(`[${Math.round((Date.now() - started) / 1000)} s] ${what}\n`);
const header = (c: LifeCheckpoint<HeadlessGenesis>) => ({
  sequence: c.sequence,
  tick: c.tick,
  parent: c.parent,
  digest: c.digest,
  stateHash: c.stateHash,
  graphDigest: c.graphDigest,
  individual: c.birth.individual,
  genesisDigest: c.genesisDigest,
  versions: c.versions,
});

/** What a life holds, the plasticity aside, for comparing engines. */
function held(life: OrganismLife) {
  const adapter = JSON.parse(JSON.stringify(life.organism.state)) as Record<
    string,
    unknown
  >;
  delete adapter.plasticity;
  return {
    fly: JSON.parse(JSON.stringify(life.cityFly.fly.state)) as Record<string, unknown>,
    adapter,
    city: life.city.stateHash(),
    archive: sha256Json(life.archive),
  };
}

/** The names of the parts of two holdings that differ, to the depth that says something. */
function differing(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
  depth = 2,
): string[] {
  const names: string[] = [];
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[key],
      y = b[key];
    if (JSON.stringify(x) === JSON.stringify(y)) continue;
    if (depth > 0 && x && y && typeof x === "object" && typeof y === "object")
      names.push(
        ...differing(
          x as Record<string, unknown>,
          y as Record<string, unknown>,
          depth - 1,
        ).map((n) => `${key}.${n}`),
      );
    else names.push(key);
  }
  return names;
}

function sample(life: PlasticityOrganismLife, tick0: number) {
  const fly = life.cityFly.fly;
  const s = fly.state;
  const status = life.organismStatus();
  return {
    section: "sample",
    h: (life.city.tick - tick0) / 36000,
    tick: life.city.tick,
    mode: s.mode,
    reserve: s.reserve / fly.params.reserveJ,
    meals: s.counts.meals,
    walkedM: s.counts.walkedM,
    rejected: s.counts.rejected,
    mushroomBody: status.mushroomBody,
    plasticity: status.plasticity,
  };
}

const graphDigest = <L extends object>(
  life: L,
  kind: LifeKind<HeadlessGenesis, L>,
  g: HeadlessGenesis,
) =>
  sha256(JSON.stringify(snapshotGraph(life, indexGraph(kind.build(structuredClone(g))))));

async function run() {
  write({
    section: "machine",
    platform: platform(),
    arch: arch(),
    node: process.version,
    heartbeat: new Date().toISOString(),
  });
  const copy = mkdtempSync(join(tmpdir(), "plasticity-rehearsal-"));
  const dir = join(copy, "store");
  cpSync(resolve(given!), dir, { recursive: true });
  say("verifying the copy's whole chain");
  const store = LifeStore.open<HeadlessGenesis, PlasticityOrganismLife>(
    dir,
    PLASTICITY_LIFE,
    {
      holder: "rehearsal",
    },
  );
  const chain = store.verify();
  const { checkpoint: source, committedUtc: stoppedUtc } = store.headRecord();
  write({ section: "chain", ...chain, head: header(source), committedUtc: stoppedUtc });

  say("restoring the source on the release that wrote it");
  if (
    !readFileSync(resolve(previous!, "RELEASE"), "utf8")
      .split(/\r?\n/)
      .includes(`commit ${PLASTICITY_CONTINUATION_SOURCE}`)
  )
    throw new Error(
      `the source must be the exact ${PLASTICITY_CONTINUATION_SOURCE} release`,
    );
  const old = (await import(
    pathToFileURL(resolve(previous!, "src/bethesda/life/organism.ts")).href
  )) as {
    ORGANISM_LIFE: LifeKind<HeadlessGenesis, OrganismLife>;
  };
  const oldContinuity = (await import(
    pathToFileURL(resolve(previous!, "src/bethesda/life/continuity.ts")).href
  )) as {
    restoreLife(
      kind: LifeKind<HeadlessGenesis, OrganismLife>,
      c: LifeCheckpoint<HeadlessGenesis>,
    ): OrganismLife;
  };
  let before: OrganismLife | null = oldContinuity.restoreLife(old.ORGANISM_LIFE, source);
  write({
    section: "source",
    release: PLASTICITY_CONTINUATION_SOURCE,
    tick: before.city.tick,
    p: before.cityFly.fly.state.p,
    mode: before.cityFly.fly.state.mode,
    meals: before.cityFly.fly.state.counts.meals,
  });

  say("this release's organism beside the source release's, 600 ticks");
  {
    const a = oldContinuity.restoreLife(old.ORGANISM_LIFE, source);
    const b = restoreLife(ORGANISM_LIFE, source);
    old.ORGANISM_LIFE.step(a, 600);
    ORGANISM_LIFE.step(b, 600);
    const same = old.ORGANISM_LIFE.hash(a) === ORGANISM_LIFE.hash(b);
    write({ section: "engine", ticks: 600, sameHash: same });
    if (!same)
      throw new Error("this release's organism differs from the source release's");
  }

  say("continuing onto plasticity, in memory");
  const upgradedUtc = new Date().toISOString();
  const continued = continueWithPlasticity(source, upgradedUtc, stoppedUtc);
  const c = continued.checkpoint;
  const fields = differing(held(before), held(continued.life), 3);
  write({
    section: "boundary",
    checkpoint: header(c),
    event: c.events[0],
    sameIndividual: c.birth.individual === source.birth.individual,
    sameBirth: JSON.stringify(c.birth) === JSON.stringify(source.birth),
    sameGenesis: c.genesisDigest === source.genesisDigest,
    sameTick: c.tick === source.tick,
    follows: c.parent === source.digest && c.sequence === source.sequence + 1,
    preservedGraphDigest: continued.preservedGraphDigest,
    sourceGraphDigest: source.graphDigest,
    exact: continued.preservedGraphDigest === source.graphDigest,
    mode: plasticityModeOf(c.graph!),
    fieldsThatDiffer: fields,
  });
  if (fields.length) throw new Error("the continuation changed what the fly holds");

  say("neither organism engine restores the continued checkpoint");
  const refusal = (f: () => unknown) => {
    try {
      f();
      return null;
    } catch (e) {
      return e instanceof Error ? e.message.slice(0, 200) : String(e);
    }
  };
  const refused = {
    current: refusal(() => restoreLife(ORGANISM_LIFE, c)),
    source: refusal(() => oldContinuity.restoreLife(old.ORGANISM_LIFE, c)),
  };
  write({ section: "refusal", ...refused });
  if (!refused.current || !refused.source)
    throw new Error("an organism engine restored the plasticity checkpoint");

  say("two restores of the continuation stay the same life");
  {
    const x = restoreLife(PLASTICITY_LIFE, c),
      y = restoreLife(PLASTICITY_LIFE, c);
    const ticks = [1, 10, 100, 500];
    const mismatch = divergence(PLASTICITY_LIFE, x, y, ticks);
    write({ section: "restart", ticks, mismatch });
    if (mismatch) throw new Error("the continuation does not restore to the same life");
  }

  say(`the source release's organism beside the shadow, up to ${LOCKSTEP_TICKS} ticks`);
  {
    let shadow: PlasticityOrganismLife | null = restoreLife(PLASTICITY_LIFE, c);
    let organism: OrganismLife | null = restoreLife(ORGANISM_LIFE, source);
    let first: object | null = null;
    let ticks = 0;
    while (ticks < LOCKSTEP_TICKS && !first) {
      old.ORGANISM_LIFE.step(before, LOCKSTEP_STEP);
      PLASTICITY_LIFE.step(shadow, LOCKSTEP_STEP);
      ORGANISM_LIFE.step(organism, LOCKSTEP_STEP);
      ticks += LOCKSTEP_STEP;
      const f = differing(held(before), held(shadow), 3);
      if (f.length) first = { ticks, fields: f.slice(0, 30) };
    }
    const p = shadow.adaptive.plasticity.status();
    write({
      section: "lockstep",
      ticks,
      identicalThroughout: first === null,
      first,
      plasticity: p,
    });
    if (first) throw new Error("shadow mode changed the organism");
    const projected = plasticityProjection(
      snapshotGraph(
        shadow,
        indexGraph(PLASTICITY_LIFE.build(structuredClone(source.genesis))),
      ),
    );
    const organismDigest = graphDigest(organism, ORGANISM_LIFE, source.genesis);
    write({
      section: "projection",
      ticks,
      projected,
      organismDigest,
      same: projected === organismDigest,
    });
    if (projected !== organismDigest)
      throw new Error("shadow mode's graph minus the addition is not the organism's");
    before = shadow = organism = null;
  }

  say("shadow mode on the copy, committed like the runner");
  const genesis = source.genesis,
    birth = source.birth;
  store.acquire();
  store.commit(c);
  store.release();
  store.verify();
  let life: PlasticityOrganismLife = restoreLife(PLASTICITY_LIFE, c);
  let previousCheckpoint = c;
  const tick0 = life.city.tick;
  const target = tick0 + Math.round(HOURS * 36000);
  const restartAt = tick0 + Math.round((HOURS * 36000) / 2);
  let restarted = false;
  let since = 0;
  write(sample(life, tick0));
  const writer = LifeStore.open<HeadlessGenesis, PlasticityOrganismLife>(
    dir,
    PLASTICITY_LIFE,
    {
      holder: "rehearsal writer",
    },
  );
  writer.acquire();
  const commit = () => {
    const events: LifeEvent[] = life.takeArchive();
    const next = checkpointLife(PLASTICITY_LIFE, life, {
      genesis,
      birth,
      previous: previousCheckpoint,
      events,
    });
    writer.renew();
    writer.commit(next);
    writer.renew();
    previousCheckpoint = next;
    since = 0;
  };
  let stopped: string | null = null;
  while (life.city.tick < target) {
    if (Date.now() - started > WALL_MS) {
      stopped = "ran out of wall-clock time";
      break;
    }
    const left = target - life.city.tick;
    PLASTICITY_LIFE.step(life, Math.min(SAMPLE_TICKS, left));
    since += Math.min(SAMPLE_TICKS, left);
    writer.renew();
    write(sample(life, tick0));
    if (since >= CHECKPOINT_TICKS) commit();
    if (!restarted && life.city.tick >= restartAt) {
      // A stop and a start, as the service does them: nothing but the store carries over.
      commit();
      const hash = PLASTICITY_LIFE.hash(life);
      const learned = JSON.stringify(life.adaptive.plasticity.state);
      life = restoreLife(PLASTICITY_LIFE, writer.head());
      restarted = true;
      const same = PLASTICITY_LIFE.hash(life) === hash;
      const sameLearning = JSON.stringify(life.adaptive.plasticity.state) === learned;
      write({
        section: "restart",
        kind: "stop and start from the store",
        tick: life.city.tick,
        same,
        sameLearning,
      });
      if (!same || !sameLearning)
        throw new Error("the restart changed the life or what it learned");
    }
  }
  commit();
  writer.release();
  const last = sample(life, tick0);

  say("policy changes on the copy");
  {
    const p = LifeStore.open<HeadlessGenesis, PlasticityOrganismLife>(
      dir,
      PLASTICITY_LIFE,
      {
        holder: "rehearsal policy",
      },
    );
    const rows: object[] = [];
    for (const to of ["active", "disabled"] as const) {
      const change = changePlasticityPolicy(
        p.head(),
        to,
        `rehearsal: ${to}`,
        new Date().toISOString(),
      );
      p.acquire();
      p.commit(change.checkpoint);
      p.release();
      rows.push({
        from: change.from,
        to: change.to,
        sequence: change.checkpoint.sequence,
        tick: change.checkpoint.tick,
      });
    }
    const verified = p.verify();
    write({
      section: "policy",
      changes: rows,
      verified,
      headMode: plasticityModeOf(p.head().graph!),
    });
  }

  say("the real runner resumes the copy");
  const selected = bethesdaStoreKind(dir) === PLASTICITY_LIFE;
  const runner = spawnSync(
    process.execPath,
    [
      "--max-old-space-size=6144",
      "scripts/run-ts.mjs",
      "scripts/bethesda-life-headless.ts",
      "--store",
      dir,
      "--ticks",
      "1000",
    ],
    { encoding: "utf8" },
  );
  const after = LifeStore.open<HeadlessGenesis, PlasticityOrganismLife>(
    dir,
    PLASTICITY_LIFE,
  );
  const resumed = after.verify();
  write({
    section: "runner",
    selectedPlasticityKind: selected,
    status: runner.status,
    stderr: runner.stderr.slice(-400),
    head: header(after.head()),
    verified: resumed,
    sameIndividual: after.head().birth.individual === source.birth.individual,
  });
  if (runner.status !== 0 || !selected)
    throw new Error("the runner did not resume the continued copy");

  say("the source release's runner refuses the continued store");
  const oldRunner = spawnSync(
    process.execPath,
    [
      "--max-old-space-size=6144",
      "scripts/run-ts.mjs",
      "scripts/bethesda-life-headless.ts",
      "--store",
      dir,
      "--check",
    ],
    { encoding: "utf8", cwd: resolve(previous!) },
  );
  write({
    section: "old",
    status: oldRunner.status,
    stderr: oldRunner.stderr.slice(-300),
  });
  if (oldRunner.status === 0)
    throw new Error("the source release accepted the continued store");

  write({
    section: "summary",
    stopped,
    simulatedHours: (life.city.tick - tick0) / 36000,
    wallS: (Date.now() - started) / 1000,
    last,
  });
  rmSync(copy, { recursive: true, force: true });
  say("done");
}

run().catch((error: unknown) => {
  write({
    section: "failed",
    error: error instanceof Error ? (error.stack ?? error.message) : String(error),
  });
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
