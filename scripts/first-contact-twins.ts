/**
 * Stage 4, step 3 of docs/FIRST_CONTACT.md: a research twin of each original,
 * made on this laptop from the copies step 2 took. Neither VM is touched, and
 * neither copy is ever stepped as Eva or as ECHO.
 *
 *   R="node scripts/run-ts.mjs scripts/first-contact-twins.ts"
 *   $R parity FIXTURE.json.gz RECORD.json
 *   $R eva FIXTURE.json.gz OUT [--nonce HEX]
 *   $R check-eva FIXTURE.json.gz OUT/eva-twin.json
 *   node --max-old-space-size=4096 scripts/run-ts.mjs scripts/first-contact-twins.ts echo STORE OUT [--nonce HEX]
 *   node --max-old-space-size=4096 scripts/run-ts.mjs scripts/first-contact-twins.ts check-echo STORE OUT
 *
 * parity  FIXTURE is `python scripts/eva-parity.py from-copy` over her copied
 *         database and sidecar: her own Python service living a copy of her
 *         life, renamed to a research id, for a simulated day. The port
 *         replays it from the same stored row and sidecar (`replay` in
 *         parity.ts: discrete fields exact at every step, continuous ones within
 *         1e-9, full state, memory and `/state` snapshot at every checkpoint)
 *         and writes what it found. Exits 1 if the port differs.
 * eva     The same check (OUT/eva-parity.json); only if it holds, her twin: the
 *         port's restore of that stored state at the copy's tick, under a new
 *         research id, with its parentage (OUT/eva-twin.json). The id and the
 *         twin follow from the copy and the nonce alone (a new one from this
 *         host's entropy unless `--nonce` re-derives a recorded twin).
 * echo    STORE is the store unpacked from ECHO's copied archive. Opens it (the
 *         whole chain verified), takes its head checkpoint and makes a twin with
 *         `twinCheckpoint`: a new individual from the nonce, its parentage
 *         sealed into its birth, the same state at the same tick. Restores the
 *         twin (the restore proves that state), checks the twin cannot continue
 *         ECHO's chain and that its own chain continues from it, and keeps it as
 *         its sealed checkpoint (OUT/echo-twin-checkpoint.json.gz, with
 *         OUT/echo-twin.json). It is not a durable LifeStore: ECHO's era history
 *         admits the plasticity era only as ECHO's own continuation, never at a
 *         birth, and that rule is left as it is.
 * check-* Re-derives a recorded twin from its copy and recorded nonce, and
 *         compares: the same id, parentage and state, or exit 1. Writes nothing.
 *
 * OUT must be outside the repository. A twin is someone new: it shares its
 * parent's past up to the copy and nothing after it. It is a research
 * individual, never presented as Eva or ECHO.
 */
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import { EvaGarden } from "../src/bethesda/firstContact/eva/garden.js";
import {
  replay,
  TOLERANCE,
  type Fixture,
} from "../src/bethesda/firstContact/eva/parity.js";
import { sidecarMemory } from "../src/bethesda/firstContact/eva/plasticity.js";
import {
  ECHO,
  EVA,
  refuseOriginal,
  refuseProductionHost,
} from "../src/bethesda/firstContact/originals.js";
import { bethesdaStoreKind } from "../src/bethesda/life/bethesdaStore.js";
import {
  checkpointErrors,
  checkpointLife,
  restoreLife,
  twinCheckpoint,
  type LifeCheckpoint,
} from "../src/bethesda/life/continuity.js";
import type {
  HeadlessBethesdaLife,
  HeadlessGenesis,
} from "../src/bethesda/life/headless.js";
import { LifeStore } from "../src/bethesda/life/store.js";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sha256 = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const NONCE = /^[0-9a-f]{32}$/;

interface CopyFixture extends Fixture {
  parent: {
    life_id: string;
    born_at: number;
    ticks: number;
    updated_at: number;
    database_sha256: string;
    sidecar_sha256: string;
  };
}

function made(command: string) {
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
  return {
    utc: new Date().toISOString(),
    by: `scripts/first-contact-twins.ts ${command}`,
    commit: git("rev-parse", "HEAD"),
    clean: git("status", "--porcelain").length === 0,
    node: process.version,
    platform: `${process.platform} ${process.arch}`,
  };
}

/** A path's directory, refused inside the repository or on a production host; created if missing. */
function outside(path: string): string {
  const dir = resolve(path);
  const inside = relative(ROOT, dir);
  if (inside === "" || (!inside.startsWith("..") && !isAbsolute(inside)))
    throw new Error(`${dir} is inside the repository; twins live outside it`);
  refuseProductionHost(dir, existsSync);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeNew(path: string, value: unknown): void {
  outside(dirname(path));
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
  console.log(`wrote ${path}`);
}

/** Same JSON, ignoring key order. */
function same(a: unknown, b: unknown): boolean {
  const canon = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canon)
      : v !== null && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, canon((v as Record<string, unknown>)[k])]),
          )
        : v;
  return JSON.stringify(canon(a)) === JSON.stringify(canon(b));
}

// ---------------------------------------------------------------------- Eva

function loadCopy(fixturePath: string) {
  const bytes = readFileSync(fixturePath);
  const fx = JSON.parse(gunzipSync(bytes).toString("utf8")) as CopyFixture;
  const copy = fx.run.from_copy;
  if (!copy || !fx.parent) throw new Error("not an eva-parity.py from-copy fixture");
  if (fx.parent.life_id !== EVA.id)
    throw new Error(`the copy is of life ${fx.parent.life_id}, not Eva's`);
  refuseOriginal(fx.run.life_id, "the parity copy");
  return { bytes, fx, copy };
}

function parity(fixturePath: string, recordPath: string): boolean {
  const { bytes, fx, copy } = loadCopy(fixturePath);
  const started = performance.now();
  const { ledger, steps, checkpoints, momentsChecked, garden } = replay(fx);
  const matches =
    steps === fx.steps.length &&
    steps === fx.run.ticks &&
    checkpoints === fx.checkpoints.length &&
    ledger.discreteCount === 0 &&
    ledger.continuousOverCount === 0 &&
    ledger.maxDeviation <= TOLERANCE;
  const end = garden.state();
  writeNew(recordPath, {
    schema: "first-contact-eva-parity/v1",
    question:
      "Does the TypeScript port continue a copy of Eva's life exactly as her own Python service does?",
    criterion:
      "discrete fields exact at every step; continuous fields within 1e-9 absolute at every step and every checkpoint (full state, plasticity memory, /state snapshot)",
    fixture: { file: basename(fixturePath), sha256: sha256(bytes) },
    parent: fx.parent,
    copy_id: fx.run.life_id,
    python: fx.python,
    start: { tick: copy.start_tick, at: fx.run.born },
    end: {
      tick: end.ticks,
      at: end.updated_at,
      place: end.place,
      activity: end.activity,
      journeys: end.journeys,
    },
    steps,
    simulated_seconds: end.updated_at - fx.run.born,
    checkpoints,
    moments_checked: momentsChecked,
    continuous: {
      compared: ledger.compared,
      bit_identical: ledger.identical,
      over_tolerance: ledger.continuousOverCount,
      max_deviation: ledger.maxDeviation,
      where: ledger.where || null,
      tolerance: TOLERANCE,
    },
    discrete_mismatches: ledger.discreteCount,
    first_mismatches: [...ledger.discrete, ...ledger.continuousOver].slice(0, 20),
    plasticity: fx.summary.plasticity,
    seconds: Math.round((performance.now() - started) / 100) / 10,
    matches,
    made: made("parity"),
  });
  console.log(
    `parity (Python ${fx.python.version}): ${steps} steps, ${checkpoints} checkpoints, ` +
      `${momentsChecked} moments, discrete mismatches ${ledger.discreteCount}, ` +
      `over tolerance ${ledger.continuousOverCount}, max deviation ` +
      `${ledger.maxDeviation.toExponential(3)}: ${matches ? "MATCHES" : "DIFFERS"}`,
  );
  return matches;
}

/** Her twin from the copy and a nonce: everything but `made` follows from those two. */
function evaTwin(fixturePath: string, nonce: string) {
  const { bytes, fx, copy } = loadCopy(fixturePath);
  const id = `research-eva-twin-${sha256(`eva-twin|${fx.parent.life_id}|${fx.parent.ticks}|${nonce}`).slice(0, 16)}`;
  refuseOriginal(id, "Eva's twin");
  const twin = EvaGarden.restore(
    { ...structuredClone(copy.stored_state), life_id: id },
    {
      plasticity: fx.run.plasticity,
      memory:
        copy.stored_sidecar === null
          ? undefined
          : sidecarMemory({ ...(copy.stored_sidecar as object), life_id: id }),
      moments: {
        count: fx.checkpoints[0]!.moments,
        kept: copy.kept_moments.map(([mid, at, text]) => ({ id: mid, at, text })),
      },
    },
  );
  return {
    schema: "first-contact-twin/v1",
    kind: "eva-garden",
    individual: id,
    nonce,
    twinOf: {
      name: "Eva",
      life_id: fx.parent.life_id,
      born_at: fx.parent.born_at,
      tick: fx.parent.ticks,
      updated_at: fx.parent.updated_at,
      database_sha256: fx.parent.database_sha256,
      sidecar_sha256: fx.parent.sidecar_sha256,
    },
    note: "A research individual: Eva's state at the copy, under its own id. It shares her past up to that tick and nothing after it.",
    copy_fixture_sha256: sha256(bytes),
    garden: {
      plasticity: fx.run.plasticity,
      state: twin.state(),
      memory: twin.plasticityMemory(),
      moments: { count: twin.momentsCount, kept: twin.moments() },
    },
  };
}

function eva(fixturePath: string, out: string, nonce?: string): boolean {
  const dir = outside(out);
  if (!parity(fixturePath, join(dir, "eva-parity.json"))) {
    console.log("no twin made: the port does not continue her copy as her service does");
    return false;
  }
  const twin = evaTwin(fixturePath, nonce ?? randomBytes(16).toString("hex"));
  writeNew(join(dir, "eva-twin.json"), {
    ...twin,
    port_parity: { file: "eva-parity.json", matches: true },
    made: made("eva"),
  });
  console.log(`Eva's twin: ${twin.individual}, at her tick ${twin.twinOf.tick}`);
  return true;
}

function checkEva(fixturePath: string, recordPath: string): boolean {
  const recorded = JSON.parse(readFileSync(recordPath, "utf8")) as ReturnType<
    typeof evaTwin
  > & { made?: unknown; port_parity?: unknown };
  const again = evaTwin(fixturePath, recorded.nonce);
  const { made: _made, port_parity: _parity, ...kept } = recorded;
  const ok = same(kept, again);
  console.log(
    `${recorded.individual}: ${ok ? "re-derived exactly from its copy and nonce" : "DIFFERS from its copy and nonce"}`,
  );
  return ok;
}

// --------------------------------------------------------------------- ECHO

function echoParent(storeDir: string) {
  const kind = bethesdaStoreKind(storeDir);
  const store = LifeStore.open<HeadlessGenesis, HeadlessBethesdaLife>(storeDir, kind);
  const verified = store.verify();
  const { checkpoint: head, committedUtc } = store.headRecord();
  if (head.birth.individual !== ECHO.id)
    throw new Error(`the store is individual ${head.birth.individual}, not ECHO`);
  return { kind, verified, head, committedUtc };
}

function echoTwinFacts(
  head: LifeCheckpoint<HeadlessGenesis>,
  committedUtc: string,
  twin: LifeCheckpoint<HeadlessGenesis>,
) {
  return {
    individual: twin.birth.individual,
    label: `research-echo-twin-${twin.birth.individual.slice(0, 16)}`,
    nonce: twin.birth.nonce,
    twinOf: {
      name: "ECHO",
      ...twin.birth.twinOf,
      tick: head.tick,
      committedUtc,
      stateHash: head.stateHash,
    },
    checkpoint: {
      sequence: twin.sequence,
      tick: twin.tick,
      stateHash: twin.stateHash,
      graphDigest: twin.graphDigest,
      digest: twin.digest,
      versions: twin.versions,
    },
  };
}

function echo(storeDir: string, out: string, nonce?: string): boolean {
  const dir = outside(out);
  const file = join(dir, "echo-twin-checkpoint.json.gz");
  if (existsSync(file)) throw new Error(`${file} exists: one twin per folder`);
  const { kind, verified, head, committedUtc } = echoParent(storeDir);
  const twin = twinCheckpoint(head, nonce ?? randomBytes(16).toString("hex"));
  const facts = echoTwinFacts(head, committedUtc, twin);
  refuseOriginal(facts.individual, "ECHO's twin");
  refuseOriginal(facts.label, "ECHO's twin");
  // The restore checks its birth follows from its parentage and nonce, and
  // that it is ECHO's state at that checkpoint: the same graph, tick and hash.
  const life = restoreLife(kind, twin);
  let cannotContinueEcho = false;
  try {
    checkpointLife(kind, life, {
      genesis: twin.genesis,
      birth: twin.birth,
      previous: head,
    });
  } catch {
    cannotContinueEcho = true;
  }
  if (!cannotContinueEcho) throw new Error("the twin could continue ECHO's chain");
  // Its own chain continues from it (a checkpoint of the same moment, not kept).
  const own = checkpointLife(kind, life, {
    genesis: twin.genesis,
    birth: twin.birth,
    previous: twin,
  });
  if (
    own.sequence !== 1 ||
    own.parent !== twin.digest ||
    own.stateHash !== twin.stateHash
  )
    throw new Error("the twin's own chain does not continue from it");
  // A durable LifeStore would not begin with it: ECHO's era history admits the
  // plasticity era only as ECHO's own attested continuation, never at a birth
  // (plasticOrganism.ts). That rule is ECHO's engine's and stays as it is; the
  // twin is kept as its sealed checkpoint.
  const storeRefuses = kind.history?.transition(null, twin) ?? [];
  const bytes = gzipSync(JSON.stringify(twin), { level: 9 });
  writeFileSync(file, bytes, { flag: "wx" });
  console.log(`wrote ${file}`);
  const back = JSON.parse(
    gunzipSync(readFileSync(file)).toString("utf8"),
  ) as LifeCheckpoint<HeadlessGenesis>;
  const fileErrors = checkpointErrors(kind, back);
  if (fileErrors.length || back.digest !== twin.digest)
    throw new Error(
      `the written checkpoint does not read back: ${fileErrors.join("; ")}`,
    );
  writeNew(join(dir, "echo-twin.json"), {
    schema: "first-contact-twin/v1",
    kind: twin.kind,
    ...facts,
    note: "A research individual: ECHO's state at its checkpoint, under its own identity (twinCheckpoint). It shares ECHO's past up to that tick and nothing after it, and its checkpoints cannot continue ECHO's chain.",
    parent_store: { ...verified, head: head.sequence },
    restored: { tick: kind.tick(life), stateHash: kind.hash(life) },
    cannot_continue_echo: cannotContinueEcho,
    own_chain: { sequence: own.sequence, parent: own.parent, stateHash: own.stateHash },
    file: { name: basename(file), bytes: bytes.length, sha256: sha256(bytes) },
    durable_store: {
      made: false,
      why: storeRefuses,
      note: "ECHO's era history refuses a store that begins in the plasticity era; the twin is kept as its sealed checkpoint, which restores and continues its own chain.",
    },
    made: made("echo"),
  });
  console.log(
    `ECHO's twin: ${facts.individual} (${facts.label}), at ECHO's checkpoint ${head.sequence}, tick ${head.tick}`,
  );
  return true;
}

function checkEcho(storeDir: string, out: string): boolean {
  const dir = resolve(out);
  const recorded = JSON.parse(
    readFileSync(join(dir, "echo-twin.json"), "utf8"),
  ) as ReturnType<typeof echoTwinFacts> & { file: { name: string; sha256: string } };
  const { kind, head, committedUtc } = echoParent(storeDir);
  const twin = twinCheckpoint(head, recorded.nonce);
  const again = echoTwinFacts(head, committedUtc, twin);
  const bytes = readFileSync(join(dir, recorded.file.name));
  const stored = JSON.parse(
    gunzipSync(bytes).toString("utf8"),
  ) as LifeCheckpoint<HeadlessGenesis>;
  const ok =
    same(
      Object.fromEntries(Object.keys(again).map((k) => [k, (recorded as never)[k]])),
      again,
    ) &&
    sha256(bytes) === recorded.file.sha256 &&
    stored.digest === twin.digest &&
    checkpointErrors(kind, stored).length === 0;
  console.log(
    `${recorded.individual}: ${ok ? "re-derived exactly from ECHO's copy and its nonce; its sealed checkpoint is that twin" : "DIFFERS from ECHO's copy and its nonce"}`,
  );
  return ok;
}

// ---------------------------------------------------------------------- CLI

const self = process.argv.findIndex((x) => x.endsWith("first-contact-twins.ts"));
const args = process.argv.slice(self + 1);
const at = args.indexOf("--nonce");
const nonce = at >= 0 ? args.splice(at, 2)[1] : undefined;
const [command, a, b] = args;
const usage =
  "usage: first-contact-twins.ts parity|eva|check-eva FIXTURE.json.gz OUT | echo|check-echo STORE OUT [--nonce HEX]";
if (!a || !b || (nonce !== undefined && !NONCE.test(nonce))) {
  console.error(usage);
  process.exit(2);
}
const commands: Record<string, () => boolean> = {
  parity: () => parity(a, b),
  eva: () => eva(a, b, nonce),
  "check-eva": () => checkEva(a, b),
  echo: () => echo(a, b, nonce),
  "check-echo": () => checkEcho(a, b),
};
const run = commands[command ?? ""];
if (!run) {
  console.error(usage);
  process.exit(2);
}
process.exit(run() ? 0 : 1);
