/**
 * The first-contact studies (src/bethesda/firstContact/, docs/FIRST_CONTACT.md).
 *
 *   node scripts/run-ts.mjs scripts/first-contact-evaluate.ts --study encounter
 *   node scripts/run-ts.mjs scripts/first-contact-evaluate.ts --study recognition --phase development
 *   node scripts/run-ts.mjs scripts/first-contact-evaluate.ts --study recognition --phase held-out
 *   … add --check to exit 1 unless a fresh run reproduces the committed file byte for byte.
 *   node scripts/run-ts.mjs scripts/first-contact-evaluate.ts --readme   re-render README.md only
 *
 * Seeded, so a run reproduces byte for byte on the platform it ran on. Run it
 * from a clean commit and commit what it writes: a result from a working tree
 * says so and is not a result. Held-out seeds run once: a held-out result
 * from a clean commit is never overwritten (only --check may run them again).
 * Never edit docs/benchmarks/first-contact/ by hand.
 *
 * Only research subjects are made here; the script refuses to run on either
 * production host.
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { arch, platform } from "node:os";
import { join } from "node:path";
import { format, resolveConfig } from "prettier";
import { sha256, sha256Json } from "../src/rain/sha256.js";
import {
  ENCOUNTER_SCHEMA,
  runEncounterStudy,
  type EncounterProtocol,
  type EncounterResult,
} from "../src/bethesda/firstContact/encounterStudy.js";
import { refuseProductionHost } from "../src/bethesda/firstContact/originals.js";
import {
  PHASES,
  runRecognition,
  type Phase,
  type RecognitionProtocol,
  type RecognitionResult,
} from "../src/bethesda/firstContact/recognition.js";
import {
  renderFirstContactReadme,
  type RunStamp,
} from "../src/bethesda/firstContact/report.js";

const root = process.cwd();
const dir = join(root, "docs/benchmarks/first-contact");
const protocols = join(root, "src/bethesda/firstContact/protocols");
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const check = flag("--check");
const log = (line: string) => console.log(`[first-contact] ${line}`);

refuseProductionHost(dir, existsSync);

const lf = (t: string) => t.replace(/\r\n?/g, "\n");
function protocol<T>(name: string): { value: T; sha256: string } {
  const text = lf(readFileSync(join(protocols, name), "utf8"));
  return { value: JSON.parse(text) as T, sha256: sha256(text) };
}

const read = (name: string): string | null => {
  try {
    return readFileSync(join(dir, name), "utf8");
  } catch {
    return null;
  }
};

async function formatted(name: string, text: string): Promise<string> {
  const path = join(dir, name);
  return format(text, { ...((await resolveConfig(path)) ?? {}), filepath: path });
}

async function emit(name: string, text: string): Promise<boolean> {
  const out = await formatted(name, text);
  const before = read(name);
  if (check) {
    if (before !== out) {
      console.error(`[first-contact] ${name} does not reproduce`);
      return false;
    }
    log(`${name} reproduces`);
    return true;
  }
  mkdirSync(dir, { recursive: true });
  if (before !== out) writeFileSync(join(dir, name), out);
  log(`${before === out ? "unchanged" : "wrote"} ${name}`);
  return true;
}

function stamp(previous: string | null): RunStamp {
  const host = `Node ${process.versions.node}, ${platform()} ${arch()}`;
  if (check && previous) {
    const old = JSON.parse(previous) as RunStamp;
    return { ranFrom: old.ranFrom, platform: old.platform };
  }
  const dirty = execSync("git status --porcelain", {
    cwd: root,
    encoding: "utf8",
  }).trim();
  const ranFrom = dirty
    ? "a working tree"
    : `\`${execSync("git rev-parse --short HEAD", { cwd: root, encoding: "utf8" }).trim()}\``;
  return { ranFrom, platform: host };
}

async function readme(): Promise<boolean> {
  const enc = read("encounter.json");
  const recognition = PHASES.map((ph) => read(`recognition-${ph}.json`))
    .filter((t): t is string => t !== null)
    .map((t) => JSON.parse(t) as RecognitionResult & RunStamp);
  return emit(
    "README.md",
    renderFirstContactReadme({
      encounter: enc ? (JSON.parse(enc) as EncounterResult & RunStamp) : null,
      recognition,
    }),
  );
}

const t0 = performance.now();
let ok = true;
const study = value("--study");
if (flag("--readme")) ok = await readme();
else if (study === "encounter") {
  const p = protocol<EncounterProtocol>("encounter-v1.json");
  if (p.value.schema !== ENCOUNTER_SCHEMA) throw new Error("encounter protocol schema");
  const previous = read("encounter.json");
  const s = stamp(previous);
  const result = runEncounterStudy(p.value, p.sha256, sha256Json, log);
  ok =
    (await emit("encounter.json", JSON.stringify({ ...s, ...result }))) &&
    (await readme());
} else if (study === "recognition") {
  const phase = value("--phase") as Phase | undefined;
  if (!phase || !(PHASES as readonly string[]).includes(phase))
    throw new Error(`--phase is one of ${PHASES.join(", ")}`);
  const name = `recognition-${phase}.json`;
  const previous = read(name);
  if (phase === "held-out" && previous && !check) {
    const old = JSON.parse(previous) as RunStamp;
    if (old.ranFrom !== "a working tree")
      throw new Error(
        `held-out seeds run once: ${name} already holds the result from ${old.ranFrom}; use --check to reproduce it`,
      );
  }
  const s = stamp(previous);
  const p = protocol<RecognitionProtocol>("recognition-v1.json");
  const result = runRecognition(p.value, p.sha256, phase, sha256Json, log);
  ok = (await emit(name, JSON.stringify({ ...s, ...result }))) && (await readme());
} else {
  console.error(
    "usage: --study encounter | --study recognition --phase <phase> | --readme [--check]",
  );
  process.exit(2);
}
log(`${((performance.now() - t0) / 1000).toFixed(0)} s`);
if (!ok) process.exit(1);
