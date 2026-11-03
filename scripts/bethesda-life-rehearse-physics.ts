/**
 * A rehearsal of the physics repair on a disposable copy of the deployed fly's
 * backup (docs/ECHO_COLLISION.md). It copies the store it is given and works on
 * the copy, so it cannot touch the original; a backup is not the life, and what a
 * copy does is never part of the individual's history. Nothing here reaches the VM.
 *
 * In order, each writing lines to --out as soon as it knows them:
 *
 *   chain       the copy's whole chain verifies, on this release's rules
 *   refusal     this release will not run the old checkpoint under its new physics
 *   source      the checkpoint restores on the release that wrote it
 *   boundary    the continuation: what changed, and what the old and new hold
 *   restart     two restores of the continuation stay the same life
 *   lockstep    old and new engine, side by side, until they first differ, and why
 *   sample      one line each simulated minute on the new engine, committed like the runner
 *   solid       each time the body enters or leaves a solid
 *   runner      the real runner resumes the copy, and it still verifies
 *   summary     what came of it
 *
 *   node --max-old-space-size=8192 scripts/run-ts.mjs scripts/bethesda-life-rehearse-physics.ts \
 *     --store DIR --from-release DIR --out FILE [--hours 72] [--lockstep-ticks 72000] [--wall-minutes 300]
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { arch, platform, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { sha256Json } from "../src/rain/sha256.js";
import {
  checkpointLife,
  divergence,
  restoreLife,
  type LifeCheckpoint,
  type LifeEvent,
  type LifeKind,
} from "../src/bethesda/life/continuity.js";
import type { HeadlessGenesis } from "../src/bethesda/life/headless.js";
import {
  BODY_ENTERED_SOLID,
  BODY_LEFT_SOLID,
  ORGANISM_LIFE,
  ORGANISM_V1_LIFE,
  PHYSICS_REPAIR_SOURCE,
  type OrganismLife,
} from "../src/bethesda/life/organism.js";
import { continueOnRepairedPhysics } from "../src/bethesda/life/physicsRepair.js";
import { LifeStore } from "../src/bethesda/life/store.js";

const self = process.argv.findIndex((a) =>
  a.endsWith("bethesda-life-rehearse-physics.ts"),
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
const HOURS = Number(option("hours") ?? 72);
const LOCKSTEP_TICKS = Number(option("lockstep-ticks") ?? 72_000);
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
  bornUtc: c.birth,
  genesisDigest: c.genesisDigest,
  versions: c.versions,
});

/** What a life holds, the self-model's label of its fly aside, for comparing engines. */
function held(life: OrganismLife) {
  const a = life.organism;
  const adapter = JSON.parse(JSON.stringify(a.state)) as Record<string, unknown>;
  delete (adapter.self as Record<string, unknown>).fly;
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

function sample(life: OrganismLife, tick0: number) {
  const fly = life.cityFly.fly;
  const s = fly.state;
  const a = life.organism;
  const status = life.organismStatus();
  const S = a.model!.state;
  return {
    section: "sample",
    h: (life.city.tick - tick0) / 36000,
    tick: life.city.tick,
    p: s.p,
    mode: s.mode,
    why: (fly.lastCommand?.reason ?? "").slice(0, 60),
    inside: life.cityFly.world.solid(s.p),
    edge: s.edge,
    contact: s.contact?.id ?? null,
    reserve: s.reserve / fly.params.reserveJ,
    counts: s.counts,
    physiology: status.physiology,
    mushroomBody: status.mushroomBody,
    olfaction: status.olfaction,
    places: a.inner.state.nav.places.length,
    selfModel: {
      counts: S.counts,
      episodes: S.episodes.length,
      inquiring: S.inquiry !== null,
    },
  };
}

async function run() {
  write({
    section: "machine",
    platform: platform(),
    arch: arch(),
    node: process.version,
    heartbeat: new Date().toISOString(),
  });
  const copy = mkdtempSync(join(tmpdir(), "rehearsal-"));
  const dir = join(copy, "store");
  cpSync(resolve(given!), dir, { recursive: true });
  say("verifying the copy's whole chain");
  const store = LifeStore.open<HeadlessGenesis, OrganismLife>(dir, ORGANISM_LIFE);
  const chain = store.verify();
  const { checkpoint: source, committedUtc: stoppedUtc } = store.headRecord();
  write({ section: "chain", ...chain, head: header(source), committedUtc: stoppedUtc });

  say("refusing the old checkpoint under the new physics");
  const refusal = (kind: LifeKind<HeadlessGenesis, OrganismLife>) => {
    try {
      restoreLife(kind, source);
      return null;
    } catch (e) {
      return e instanceof Error ? e.message.slice(0, 200) : String(e);
    }
  };
  const refused = { current: refusal(ORGANISM_LIFE), frozen: refusal(ORGANISM_V1_LIFE) };
  write({ section: "refusal", ...refused });
  if (!refused.current || !refused.frozen)
    throw new Error("this release ran an old checkpoint under its new physics");

  say("restoring the source on the release that wrote it");
  if (
    !readFileSync(resolve(previous!, "RELEASE"), "utf8")
      .split(/\r?\n/)
      .includes(`commit ${PHYSICS_REPAIR_SOURCE}`)
  )
    throw new Error(`the source must be the exact ${PHYSICS_REPAIR_SOURCE} release`);
  const old = (await import(
    pathToFileURL(resolve(previous!, "src/bethesda/life/organism.ts")).href
  )) as { ORGANISM_LIFE: LifeKind<HeadlessGenesis, OrganismLife> };
  const oldContinuity = (await import(
    pathToFileURL(resolve(previous!, "src/bethesda/life/continuity.ts")).href
  )) as {
    restoreLife(
      kind: LifeKind<HeadlessGenesis, OrganismLife>,
      c: LifeCheckpoint<HeadlessGenesis>,
    ): OrganismLife;
  };
  let before: OrganismLife | null = oldContinuity.restoreLife(old.ORGANISM_LIFE, source);
  const flyVersionOf = (l: OrganismLife) => l.organism.model!.state.fly;
  write({
    section: "source",
    release: PHYSICS_REPAIR_SOURCE,
    label: flyVersionOf(before),
    p: before.cityFly.fly.state.p,
    mode: before.cityFly.fly.state.mode,
    edge: before.cityFly.fly.state.edge,
    inside: before.cityFly.world.solid(before.cityFly.fly.state.p),
    above:
      before.cityFly.world.raycast(before.cityFly.fly.state.p, [0, 1, 0], 500)?.id ??
      null,
  });

  say("continuing onto the repaired physics, in memory");
  const upgradedUtc = new Date().toISOString();
  const repair = continueOnRepairedPhysics(source, upgradedUtc, stoppedUtc);
  const c = repair.checkpoint;
  const a = held(before),
    b = held(repair.life);
  write({
    section: "boundary",
    checkpoint: header(c),
    event: c.events[0],
    sameIndividual: c.birth.individual === source.birth.individual,
    sameBirth: JSON.stringify(c.birth) === JSON.stringify(source.birth),
    sameGenesis: c.genesisDigest === source.genesisDigest,
    sameTick: c.tick === source.tick,
    follows: c.parent === source.digest && c.sequence === source.sequence + 1,
    preservedGraphDigest: repair.preservedGraphDigest,
    sourceGraphDigest: source.graphDigest,
    labelBefore: flyVersionOf(before),
    labelAfter: flyVersionOf(repair.life),
    fieldsThatDiffer: differing(a, b, 3),
    digests: {
      flyState: sha256Json(a.fly),
      adapterState: sha256Json(a.adapter),
      flyStateAfter: sha256Json(b.fly),
      adapterStateAfter: sha256Json(b.adapter),
      city: a.city,
      cityAfter: b.city,
      archive: a.archive,
      archiveAfter: b.archive,
    },
  });
  if (differing(a, b, 3).length)
    throw new Error("the continuation changed what the fly holds");

  say("two restores of the continuation stay the same life");
  {
    const x = restoreLife(ORGANISM_LIFE, c),
      y = restoreLife(ORGANISM_LIFE, c);
    const ticks = [1, 10, 100, 500];
    const mismatch = divergence(ORGANISM_LIFE, x, y, ticks);
    write({ section: "restart", ticks, mismatch });
    if (mismatch) throw new Error("the continuation does not restore to the same life");
  }

  say(`old and new engine in step, up to ${LOCKSTEP_TICKS} ticks`);
  {
    let next: OrganismLife | null = restoreLife(ORGANISM_LIFE, c);
    let first: object | null = null;
    let ticks = 0;
    while (ticks < LOCKSTEP_TICKS && !first) {
      old.ORGANISM_LIFE.step(before, LOCKSTEP_STEP);
      ORGANISM_LIFE.step(next, LOCKSTEP_STEP);
      ticks += LOCKSTEP_STEP;
      const x = held(before),
        y = held(next);
      const fields = differing(x, y, 3);
      if (fields.length) {
        const f = (l: OrganismLife) => ({
          p: l.cityFly.fly.state.p,
          mode: l.cityFly.fly.state.mode,
          contact: l.cityFly.fly.state.contact?.id ?? null,
          edge: l.cityFly.fly.state.edge,
          perch: l.cityFly.fly.state.perch,
          why: l.cityFly.fly.lastCommand?.reason ?? null,
          counts: l.cityFly.fly.state.counts,
        });
        first = { ticks, fields: fields.slice(0, 30), old: f(before), new: f(next) };
      }
    }
    write({ section: "lockstep", ticks, identicalThroughout: first === null, first });
    before = next = null;
  }

  say("the new engine, committed like the runner");
  const genesis = source.genesis,
    birth = source.birth;
  store.acquire();
  store.commit(c);
  store.release();
  store.verify();
  let life: OrganismLife = restoreLife(ORGANISM_LIFE, c);
  let previousCheckpoint = c;
  const tick0 = life.city.tick;
  const target = tick0 + Math.round(HOURS * 36000);
  const restartAt = tick0 + Math.round((HOURS * 36000) / 2);
  let restarted = false;
  let since = 0;
  const seen: Record<string, number> = {};
  let exit: object | null = null;
  let reentries = 0;
  write(sample(life, tick0));
  const writer = LifeStore.open<HeadlessGenesis, OrganismLife>(dir, ORGANISM_LIFE);
  writer.acquire();
  const commit = () => {
    const events: LifeEvent[] = life.takeArchive();
    for (const e of events) {
      seen[e.kind] = (seen[e.kind] ?? 0) + 1;
      if (e.kind === BODY_LEFT_SOLID || e.kind === BODY_ENTERED_SOLID) {
        write({
          section: "solid",
          kind: e.kind,
          tick: e.tick,
          h: (e.tick - tick0) / 36000,
          ...e.data,
        });
        if (e.kind === BODY_LEFT_SOLID && !exit)
          exit = { tick: e.tick, h: (e.tick - tick0) / 36000, ...e.data };
        if (e.kind === BODY_ENTERED_SOLID) reentries++;
      }
    }
    const next = checkpointLife(ORGANISM_LIFE, life, {
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
    ORGANISM_LIFE.step(life, Math.min(SAMPLE_TICKS, left));
    since += Math.min(SAMPLE_TICKS, left);
    writer.renew();
    write(sample(life, tick0));
    if (since >= CHECKPOINT_TICKS) commit();
    if (!restarted && life.city.tick >= restartAt) {
      // A stop and a start, as the service does them: nothing but the store carries over.
      commit();
      const hash = ORGANISM_LIFE.hash(life);
      const head = writer.head();
      life = restoreLife(ORGANISM_LIFE, head);
      restarted = true;
      write({
        section: "restart",
        kind: "stop and start from the store",
        tick: life.city.tick,
        sameHash: ORGANISM_LIFE.hash(life) === hash,
      });
      if (ORGANISM_LIFE.hash(life) !== hash)
        throw new Error("the restart changed the life");
    }
  }
  commit();
  writer.release();
  const verified = LifeStore.open<HeadlessGenesis, OrganismLife>(
    dir,
    ORGANISM_LIFE,
  ).verify();
  const last = sample(life, tick0);

  say("the real runner resumes the copy");
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
  const after = LifeStore.open<HeadlessGenesis, OrganismLife>(dir, ORGANISM_LIFE);
  const resumed = after.verify();
  write({
    section: "runner",
    status: runner.status,
    stderr: runner.stderr.slice(-400),
    head: header(after.head()),
    verified: resumed,
    sameIndividual: after.head().birth.individual === source.birth.individual,
  });

  write({
    section: "summary",
    stopped,
    simulatedHours: (life.city.tick - tick0) / 36000,
    wallS: (Date.now() - started) / 1000,
    exit,
    reentries,
    events: seen,
    verified,
    last,
    fromEvents: {
      firstEvent: c.events[0]?.kind,
    },
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
