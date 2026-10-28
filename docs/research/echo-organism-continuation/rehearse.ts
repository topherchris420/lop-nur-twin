/**
 * Rehearsal of the organism continuation on the deployed individual's final
 * pre-v3 backup, which stays read-only. Everything happens in memory or in
 * throwaway files here: never a store, never a lease, never a second writer.
 * What is lived forward here is a disposable continuation on this laptop's
 * numerics (Windows arm64), not the fly's life, which continued on the VM.
 *
 *   node scripts/run-ts.mjs <this file> verify|source|v3|organism|restart|deplete|smell
 *
 *   verify    the backup's whole chain, on the engine that wrote it and on this branch's kinds
 *   source    what head 269 holds, restored on the engine that wrote it
 *   v3        head 269 on its own engine (3db627b), continued to v3 by the
 *             deployed release's own continuation (d25e1f3), lived forward in memory
 *   organism  the --check steps on that v3 checkpoint, the confirmations, a longer run
 *   restart   a new process restores the last organism checkpoint and continues
 *   deplete   on a copy, a near-empty reserve recovers by artificial maintenance
 *   smell     on a copy set down within smelling range of food: SMELL_PLACEMENT=n near the
 *             n-th patch, SMELL_RESERVE its reserve, SMELL_TICKS its length, SMELL_KIND=v3
 *             the same placement on ECHO v3, as a control
 */
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const SCRATCH = process.env.REHEARSAL_SCRATCH!;
const REPO = pathToFileURL(`${process.env.REHEARSAL_REPO}/`).href;
const BACKUP = `${SCRATCH}/backup-v2-121504Z/store`;
const V2 = `${SCRATCH}/releases/3db627bc125415093d6507988a2d8f61949f5240`;
const V3 = `${SCRATCH}/releases/d25e1f3b9e40c5ded3f8ce1f435365d5c6c80592`;
const OUT = `${SCRATCH}/rehearsal/out`;
const INDIVIDUAL = "04f8c797b6971a46138dabc3fdfde5baae2aa224d3a8f9c0099a7c207dec1921";
mkdirSync(OUT, { recursive: true });

const from = (root: string, f: string) => import(pathToFileURL(join(root, f)).href);
const here = (f: string) => import(REPO + f);
const t0 = performance.now();
const cpu0 = process.cpuUsage();
function usage(label: string) {
  const c = process.cpuUsage(cpu0);
  return {
    label,
    wallS: +((performance.now() - t0) / 1000).toFixed(1),
    cpuS: +((c.user + c.system) / 1e6).toFixed(1),
    maxRssMB: Math.round(process.resourceUsage().maxRSS / 1024),
    heapUsedMB: Math.round(process.memoryUsage().heapUsed / 1048576),
  };
}
const report: Record<string, unknown> = {
  node: process.version,
  platform: `${process.platform} ${process.arch}`,
  heapLimitMB: Math.round(
    (await import("node:v8")).getHeapStatistics().heap_size_limit / 1048576,
  ),
};
const log = (k: string, v: unknown) => {
  report[k] = v;
  process.stderr.write(`${k}: ${JSON.stringify(v)}\n`);
};
const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const writeJson = (p: string, v: unknown) => {
  writeFileSync(p, JSON.stringify(v));
  return statSync(p).size;
};
const header = (c: { graph: unknown }) => ({ ...c, graph: null });

const { sha256Json } = await here("src/rain/sha256.ts");
/** What the fly has learned and holds, as fingerprints and counts. */
function learned(life: any) {
  const fly = life.cityFly.fly,
    a = fly.adapter,
    S = a.model.state,
    places = a.inner.state.nav.places;
  return {
    tick: life.city.tick,
    rememberedPlaces: places.length,
    landmarkPlaces: places.filter((p: any) => p.landmarks.length > 0).length,
    placesDigest: sha256Json(places),
    controllerDigest: sha256Json(a.inner.state),
    selfModelDigest: sha256Json(S),
    replaced: a.state.replaced.length,
    episodesKept: S.episodes.length,
    lastEpisode: S.episodes.at(-1)?.id ?? null,
    inquiries: S.counts.inquiries,
    inquiryOpen: S.inquiry !== null,
    beliefs: Object.keys(S.beliefs ?? {}).length,
    bodyDigest: sha256Json(fly.state),
    logDigest: sha256Json(fly.log),
    cityHash: life.city.stateHash(),
    reserveFraction: +(fly.state.reserve / fly.params.reserveJ).toFixed(4),
    rejectedCommands: fly.state.counts.rejected,
    failed: life.cityFly.failed,
  };
}

const phase = process.argv.at(-1);

if (phase === "verify") {
  // The whole chain on the engine that wrote its head (as backup.sh checks it) ...
  const oldStore = await from(V2, "src/bethesda/life/store.ts");
  const oldUp = await from(V2, "src/bethesda/life/echoUpgrade.ts");
  const own = oldStore.LifeStore.open(BACKUP, oldUp.ECHO_UPGRADED_LIFE);
  const head = own.headRecord();
  log("ownEngine", {
    verified: true,
    head: head.checkpoint.sequence,
    tick: head.checkpoint.tick,
    epoch: head.epoch,
    committedUtc: head.committedUtc,
    individual: head.checkpoint.birth.individual,
    versions: head.checkpoint.versions,
    ...usage("verified on 3db627b"),
  });
  // ... and on the kinds this branch opens it with: before the cutover (v3) and after (organism).
  const { LifeStore } = await here("src/bethesda/life/store.ts");
  const { ECHO_UPGRADED_LIFE } = await here("src/bethesda/life/echoUpgrade.ts");
  const { ORGANISM_LIFE } = await here("src/bethesda/life/organism.ts");
  const { bethesdaStoreKind } = await here("src/bethesda/life/bethesdaStore.ts");
  LifeStore.open(BACKUP, ECHO_UPGRADED_LIFE);
  log("thisBranchV3Kind", { verified: true, ...usage("verified as ECHO_UPGRADED_LIFE") });
  const s = LifeStore.open(BACKUP, ORGANISM_LIFE);
  const events = s.events();
  log("thisBranchOrganismKind", {
    verified: true,
    storeKindSelected: bethesdaStoreKind(BACKUP) === ECHO_UPGRADED_LIFE ? "ECHO_UPGRADED_LIFE" : "other",
    events: events.filter((e: any) => e.kind !== "gap").map((e: any) => `${e.kind}@${e.tick}`),
    gaps: events.filter((e: any) => e.kind === "gap").length,
    ...usage("verified as ORGANISM_LIFE"),
  });
}

if (phase === "source") {
  // What the deployed individual held at its last backed-up checkpoint, on the engine that wrote it.
  const oldCont = await from(V2, "src/bethesda/life/continuity.ts");
  const oldUp = await from(V2, "src/bethesda/life/echoUpgrade.ts");
  const c269 = readJson(`${BACKUP}/checkpoints/000000000269.json`).checkpoint;
  log("sourceLearned", learned(oldCont.restoreLife(oldUp.ECHO_UPGRADED_LIFE, c269)));
}

if (phase === "v3") {
  const oldCont = await from(V2, "src/bethesda/life/continuity.ts");
  const oldUp = await from(V2, "src/bethesda/life/echoUpgrade.ts");
  const stored = readJson(`${BACKUP}/checkpoints/000000000269.json`);
  const c269 = stored.checkpoint;
  if (c269.birth.individual !== INDIVIDUAL) throw new Error("not the deployed individual");
  let old: unknown = oldCont.restoreLife(oldUp.ECHO_UPGRADED_LIFE, c269);
  log("restoredOnOwnEngine", { sequence: c269.sequence, tick: c269.tick, ...usage("269 on 3db627b") });
  old = null;
  // The deployed release's own v3 continuation, as it ran on the VM (its UTC is this rehearsal's).
  const v3Up = await from(V3, "src/bethesda/life/echoUpgrade.ts");
  const v3Cont = await from(V3, "src/bethesda/life/continuity.ts");
  const { life, checkpoint: c270 } = v3Up.continueEchoSelfModel(
    c269,
    "2026-10-27T12:19:00.000Z",
    stored.committedUtc,
  );
  log("v3Continuation", {
    sequence: c270.sequence,
    tick: c270.tick,
    graphDigest: c270.graphDigest,
    events: c270.events.map((e: any) => e.kind),
    ...usage("270 by d25e1f3"),
  });
  const ticks = Number(process.env.V3_TICKS ?? 36000);
  const t = performance.now();
  for (let left = ticks; left > 0; left -= 3600) v3Up.ECHO_UPGRADED_LIFE.step(life, Math.min(3600, left));
  const msPerTick = (performance.now() - t) / ticks;
  const c271 = v3Cont.checkpointLife(v3Up.ECHO_UPGRADED_LIFE, life, {
    genesis: c269.genesis,
    birth: c269.birth,
    previous: c270,
  });
  log("v3Lived", { ticks, msPerTick: +msPerTick.toFixed(3), ...usage("lived on d25e1f3") });
  log("v3Learned", learned(life));
  const bytes = writeJson(`${OUT}/v3-271.json`, c271);
  writeJson(`${OUT}/headers.json`, { c269: header(c269), c269CommittedUtc: stored.committedUtc, c270: header(c270) });
  log("v3Checkpoint", { sequence: c271.sequence, tick: c271.tick, bytes, ...usage("written") });
}

if (phase === "organism") {
  const { restoreLife, checkpointErrors, checkpointLife, divergence, historicalCheckpointErrors } =
    await here("src/bethesda/life/continuity.ts");
  const { ECHO_UPGRADED_LIFE } = await here("src/bethesda/life/echoUpgrade.ts");
  const { ORGANISM_LIFE, ORGANISM_EVENT } = await here("src/bethesda/life/organism.ts");
  const { continueAsOrganism, valuationOf } = await here("src/bethesda/life/organismContinuation.ts");
  const v3Up = await from(V3, "src/bethesda/life/echoUpgrade.ts");
  const v3Cont = await from(V3, "src/bethesda/life/continuity.ts");
  const c271 = readJson(`${OUT}/v3-271.json`);
  const { c269, c270 } = readJson(`${OUT}/headers.json`);
  const before = readJson(`${OUT}/report-v3.json`).v3Learned;
  // 1. This release continues the v3 fly exactly as the deployed engine does (the script's check).
  let deployed: any = v3Cont.restoreLife(v3Up.ECHO_UPGRADED_LIFE, c271);
  let mine: any = restoreLife(ECHO_UPGRADED_LIFE, c271);
  v3Up.ECHO_UPGRADED_LIFE.step(deployed, 600);
  ECHO_UPGRADED_LIFE.step(mine, 600);
  const sameEngine = v3Up.ECHO_UPGRADED_LIFE.hash(deployed) === ECHO_UPGRADED_LIFE.hash(mine);
  deployed = mine = null;
  log("sameEngine", { ticks: 600, same: sameEngine, ...usage("same-engine check") });
  if (!sameEngine) throw new Error("this release does not continue the v3 fly as d25e1f3 does");
  // 2. The continuation, its preserved graph and its exact restore.
  const stoppedUtc = "2026-10-27T13:20:00.000Z",
    upgradedUtc = "2026-10-27T13:25:00.000Z";
  const tc = performance.now();
  let { life, checkpoint: c272, preservedGraphDigest } = continueAsOrganism(c271, upgradedUtc, stoppedUtc);
  const continuationS = +((performance.now() - tc) / 1000).toFixed(1);
  c271.graph = null; // its digest stays in the header; the graph was checked by the continuation
  const after = learned(life);
  log("continuation", {
    seconds: continuationS,
    preservedGraphDigest,
    sourceGraphDigest: c271.graphDigest,
    preserved: preservedGraphDigest === c271.graphDigest,
    ...usage("continued"),
  });
  let restored: any = restoreLife(ORGANISM_LIFE, c272);
  const mismatch = divergence(ORGANISM_LIFE, life, restored, [1, 10, 100, 500]);
  restored = null;
  life = null as any;
  log("restoreDivergence", { intervals: [1, 10, 100, 500], mismatch, ...usage("restore check") });
  // Confirmations 1, 2, 3, 7: identity, integrity, learning, nothing lost.
  const transition = ORGANISM_LIFE.history.transition;
  const chain = [
    ["269 -> 270 (v3)", transition(c269, c270)],
    ["270 -> 271 (v3)", transition(c270, c271)],
    ["271 -> 272 (organism)", transition(c271, c272)],
  ];
  log("identity", {
    individual: c272.birth.individual,
    sameIndividual: c272.birth.individual === INDIVIDUAL,
    sameBirth: JSON.stringify(c272.birth) === JSON.stringify(c271.birth),
    sameGenesisDigest: c272.genesisDigest === c271.genesisDigest,
    parentIsV3Head: c272.parent === c271.digest,
    sequence: c272.sequence,
    tickUnchanged: c272.tick === c271.tick,
    events: c272.events.map((e: any) => e.kind),
  });
  log("integrity", {
    organismCheckpointErrors: checkpointErrors(ORGANISM_LIFE, c272),
    historicalErrors: [c269, c270, c271].map((c: any) => historicalCheckpointErrors(ORGANISM_LIFE, c)),
    transitions: chain,
  });
  const same = Object.fromEntries(Object.keys(before).map((k) => [k, before[k] === after[k]]));
  log("learningPreserved", { before, after, same });
  const event = c272.events.find((e: any) => e.kind === ORGANISM_EVENT);
  log("introduced", event.data.introduced);
  log("kept", event.data.kept);
  const c272Bytes = writeJson(`${OUT}/organism-272.json`, c272);
  log("checkpointBytes", { v3: statSync(`${OUT}/v3-271.json`).size, organism: c272Bytes });
  // Confirmations 4, 5, 6, 10: a longer run, restored and verified at every checkpoint, as the runner does.
  life = restoreLife(ORGANISM_LIFE, c272);
  const a = life.organism,
    fly = life.cityFly.fly;
  const rejected0 = fly.state.counts.rejected;
  let previous = c272;
  const runs: unknown[] = [];
  const kinds: Record<string, number> = {};
  for (const run of (process.env.ORGANISM_RUNS ?? "3600,7200,14400,36000").split(",").map(Number)) {
    const t = performance.now();
    const archived: any[] = [];
    for (let left = run; left > 0; left -= 48) {
      life.advanceTicks(Math.min(48, left));
      if (life.archive.length >= 1024) archived.push(...life.takeArchive());
    }
    archived.push(...life.takeArchive());
    const msPerTick = (performance.now() - t) / run;
    for (const e of archived) kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
    const next = checkpointLife(ORGANISM_LIFE, life, {
      genesis: c272.genesis,
      birth: c272.birth,
      previous,
      events: archived,
    });
    const errors = [...checkpointErrors(ORGANISM_LIFE, next), ...transition(previous, next)];
    const back: any = restoreLife(ORGANISM_LIFE, next);
    const restoresExactly = ORGANISM_LIFE.hash(back) === ORGANISM_LIFE.hash(life);
    life = back; // continue from the restored copy, as a restarted runner does
    previous = { ...next, graph: null };
    const status = life.organismStatus();
    runs.push({
      ticks: run,
      msPerTick: +msPerTick.toFixed(3),
      sequence: next.sequence,
      archived: archived.length,
      errors,
      restoresExactly,
      valuationKept: valuationOf(life.organism) === life.organism.valuation,
      status,
      ...usage(`run ${run}`),
    });
    process.stderr.write(`run ${run}: ${JSON.stringify(runs.at(-1))}\n`);
  }
  log("runs", runs);
  log("archiveKinds", kinds);
  log("commands", { rejectedDuringRuns: life.cityFly.fly.state.counts.rejected - rejected0 });
  log("afterRuns", learned(life));
  void a;
  // For the restart phase: the last checkpoint, and where the same life goes 600 ticks on.
  writeJson(
    `${OUT}/organism-last.json`,
    checkpointLife(ORGANISM_LIFE, life, { genesis: c272.genesis, birth: c272.birth, previous, events: life.takeArchive() }),
  );
  ORGANISM_LIFE.step(life, 600);
  writeJson(`${OUT}/organism-last-plus600.json`, { hash: ORGANISM_LIFE.hash(life), tick: life.city.tick });
  log("final", usage("organism phase done"));
}

if (phase === "restart") {
  const { restoreLife, checkpointErrors } = await here("src/bethesda/life/continuity.ts");
  const { ORGANISM_LIFE } = await here("src/bethesda/life/organism.ts");
  const last = readJson(`${OUT}/organism-last.json`);
  const expected = readJson(`${OUT}/organism-last-plus600.json`);
  const life: any = restoreLife(ORGANISM_LIFE, last);
  ORGANISM_LIFE.step(life, 600);
  log("restart", {
    sequence: last.sequence,
    errors: checkpointErrors(ORGANISM_LIFE, last),
    sameAfter600: ORGANISM_LIFE.hash(life) === expected.hash && life.city.tick === expected.tick,
    individual: last.birth.individual,
    ...usage("restarted"),
  });
}

if (phase === "deplete") {
  const { restoreLife } = await here("src/bethesda/life/continuity.ts");
  const { ORGANISM_LIFE } = await here("src/bethesda/life/organism.ts");
  const c = readJson(`${OUT}/organism-272.json`);
  const life: any = restoreLife(ORGANISM_LIFE, c);
  const before = learned(life);
  const fly = life.cityFly.fly,
    a = life.organism,
    S = a.model.state;
  // A test intervention on a disposable copy: the reserve nearly empty.
  fly.state.reserve = 0.02 * fly.params.reserveJ;
  const fed0 = fly.state.counts.fedJ;
  const events: any[] = [];
  let ticks = 0;
  for (; ticks < 60_000 && !events.some((e) => e.kind === "recovery-exit"); ticks += 1000) {
    life.advanceTicks(1000);
    events.push(...life.takeArchive());
  }
  const after = learned(life);
  log("deplete", {
    ticks,
    kinds: events.map((e) => `${e.kind}@${e.tick - c.tick}`),
    physiology: life.organismStatus().physiology,
    reserveFraction: after.reserveFraction,
    fedJ: fly.state.counts.fedJ - fed0,
    sameSelfModelObject: a.model.state === S,
    replaced: after.replaced,
    failed: after.failed,
    rememberedPlaces: [before.rememberedPlaces, after.rememberedPlaces],
    inquiries: [before.inquiries, after.inquiries],
    episodes: [before.episodesKept, after.episodesKept],
    rejectedCommands: after.rejectedCommands - before.rejectedCommands,
    ...usage("deplete"),
  });
}

if (phase === "smell") {
  const { restoreLife } = await here("src/bethesda/life/continuity.ts");
  const { ORGANISM_LIFE } = await here("src/bethesda/life/organism.ts");
  // SMELL_KIND=v3: the control, the same fly as ECHO v3 (no olfaction, no
  // physiology, no mushroom body) set down at the same place.
  const control = process.env.SMELL_KIND === "v3";
  const kind = control ? (await here("src/bethesda/life/echoUpgrade.ts")).ECHO_UPGRADED_LIFE : ORGANISM_LIFE;
  const c = readJson(control ? `${OUT}/v3-271.json` : `${OUT}/organism-272.json`);
  const life: any = restoreLife(kind, c);
  const fly = life.cityFly.fly,
    world = fly.world,
    a = control ? null : life.organism;
  const inner = (a ?? fly.adapter).inner;
  const food: any[] = world.spec.food ?? [];
  const p0 = [...fly.state.p];
  const dist = (p: number[], f: any) =>
    Math.hypot(p[0] - f.center[0], p[1] - f.center[1], p[2] - f.center[2]);
  const byDistance = [...food].sort((x, y) => dist(p0, x) - dist(p0, y));
  log("whereItIs", {
    p: p0.map((v) => +v.toFixed(2)),
    mode: fly.state.mode,
    reserveFraction: +(fly.state.reserve / fly.params.reserveJ).toFixed(4),
    patches: food.length,
    nearestFood: byDistance[0] && {
      id: byDistance[0].id,
      kind: byDistance[0].kind,
      surface: byDistance[0].surface,
      distanceM: +dist(p0, byDistance[0]).toFixed(1),
    },
    odourHere: world.odour(fly.state.p),
  });
  // A test intervention on a disposable copy, never the fly's history: set it
  // down at rest, on a real surface, where a real patch's odour reaches it.
  // SMELL_PLACEMENT=n: the first valid place around the n-th patch that has one (0 by default).
  const nth = Number(process.env.SMELL_PLACEMENT ?? 0);
  let placed: any = null,
    found = 0;
  search: for (const f of byDistance)
    for (const r of [12, 9, 15, 7, 18])
      for (let k = 0; k < 16; k++) {
        const th = (k / 16) * 2 * Math.PI;
        const x = f.center[0] + r * Math.cos(th),
          z = f.center[2] + r * Math.sin(th);
        const perch = world.perchAt(x, z, f.center[1] + 1);
        if (!perch || Math.abs(perch.y - f.center[1]) > 0.5) continue;
        const p = [x, perch.y + fly.standingHeight, z];
        const o = world.odour(p);
        if (o > 0.03 && o < 0.5 && !world.solid(p)) {
          if (found++ < nth) continue search;
          placed = { patch: f.id, kind: f.kind, surface: perch.kind, radiusM: r, odour: +o.toFixed(4), p };
          break search;
        }
      }
  if (!placed) throw new Error("no placement within smelling range");
  const failed = fly.settle(placed.p, "test placement within smelling range of a food patch");
  if (failed) throw new Error(failed);
  // Optionally a hungrier copy (also a test intervention): its reserve set to this fraction.
  if (process.env.SMELL_RESERVE) fly.state.reserve = Number(process.env.SMELL_RESERVE) * fly.params.reserveJ;
  placed.reserveFraction = +(fly.state.reserve / fly.params.reserveJ).toFixed(4);
  log("placed", { ...placed, p: placed.p.map((v: number) => +v.toFixed(2)) });
  const counts0 = structuredClone(fly.state.counts);
  const trials0 = a?.circuit.state.trials ?? 0;
  const patch = food.find((f) => f.id === placed.patch);
  let minPatchM = Infinity,
    minFoodM = Infinity;
  let maxOn = 0,
    maxOff = 0,
    maxOdour = 0,
    walkingTicks = 0,
    feedTicks = 0,
    firstMealTick: number | null = null;
  const events: any[] = [];
  const ticks = Number(process.env.SMELL_TICKS ?? 9000);
  for (let i = 1; i <= ticks; i++) {
    life.advanceTicks(1);
    const s = a?.olfaction.state;
    if (s) {
      maxOn = Math.max(maxOn, s.on);
      maxOff = Math.max(maxOff, s.off);
    }
    minPatchM = Math.min(minPatchM, dist(fly.state.p, patch));
    for (const f of food) minFoodM = Math.min(minFoodM, dist(fly.state.p, f));
    maxOdour = Math.max(maxOdour, world.odour(fly.state.p));
    if (fly.state.mode === "walk") walkingTicks++;
    if (fly.state.mode === "feed") {
      feedTicks++;
      firstMealTick ??= i;
    }
    if (i % 1000 === 0 && a) events.push(...life.takeArchive());
  }
  if (a) events.push(...life.takeArchive());
  const s = a?.olfaction.state;
  log("smell", {
    kind: control ? "ECHO v3 control: no olfaction" : "organism",
    ticks,
    startPatchM: placed.radiusM,
    minPatchM: +minPatchM.toFixed(2),
    finalPatchM: +dist(fly.state.p, patch).toFixed(2),
    minAnyFoodM: +minFoodM.toFixed(2),
    finalMode: fly.state.mode,
    maxOdour: +maxOdour.toFixed(4),
    maxOn: +maxOn.toFixed(4),
    maxOff: +maxOff.toFixed(4),
    modulatedDecisions: s?.modulatedDecisions ?? null,
    searchTurns: s?.searchTurns ?? null,
    walkingTicks,
    feedTicks,
    firstMealTick,
    meals: fly.state.counts.meals - counts0.meals,
    fedJ: +(fly.state.counts.fedJ - counts0.fedJ).toFixed(4),
    mushroomBodyTrials: a ? a.circuit.state.trials - trials0 : null,
    lastTrial: a?.circuit.state.last ?? null,
    rememberedPlaces: inner.state.nav.places.length,
    landmarkPlaces: inner.state.nav.places.filter((p: any) => p.landmarks.length > 0).length,
    flownM: +(fly.state.counts.flownM - counts0.flownM).toFixed(2),
    walkedM: fly.state.counts.walkedM === undefined ? null : +(fly.state.counts.walkedM - counts0.walkedM).toFixed(2),
    rejectedCommands: fly.state.counts.rejected - counts0.rejected,
    collisions: fly.state.counts.collisions - counts0.collisions,
    archive: events.map((e) => e.kind),
    failed: life.cityFly.failed,
    ...usage("smell"),
  });
}

writeFileSync(`${OUT}/report-${phase}${process.env.SMELL_KIND === "v3" ? "-v3control" : ""}${process.env.SMELL_PLACEMENT ? `-placement${process.env.SMELL_PLACEMENT}` : ""}${process.env.SMELL_RESERVE ? `-reserve${process.env.SMELL_RESERVE}` : ""}.json`, JSON.stringify(report, null, 1));
process.stdout.write(`${JSON.stringify(usage(`${phase} done`))}\n`);
