#!/usr/bin/env node
/**
 * The preregistered Sarvam-Prism pilot for Noeterra. The question, bars, decoys
 * and stop rules are in docs/benchmarks/noeterra-prism/preregistration.md; this
 * file applies them and is frozen with that plan.
 *
 *   node tools/noeterra-prism-pilot.mjs seeds <merge-commit>
 *   node tools/noeterra-prism-pilot.mjs dry-run [--out DIR]
 *   node tools/noeterra-prism-pilot.mjs check --spend [--out DIR]
 *   node tools/noeterra-prism-pilot.mjs study --merge <merge-commit> --spend [--out DIR]
 *   node tools/noeterra-prism-pilot.mjs report [--out DIR | --scores FILE] [--stage S] [--json]
 *
 * `dry-run` is free: every Prism seat plays against a stand-in for Sarvam's API
 * that this process serves on loopback, with a placeholder key. In `check` and
 * `study` only the `prism` arm reaches Sarvam, and only with --spend and a
 * SARVAM_API_KEY in the environment, which curl reads; this script never reads
 * or prints the key and never hands it to a stand-in.
 *
 * Every stage first builds the engine (cargo build --release), so cargo must be
 * on PATH.
 * Standard library only.
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(
  ROOT,
  "noeterra",
  "target",
  "release",
  process.platform === "win32" ? "noeterra.exe" : "noeterra",
);
const PLAN = "docs/benchmarks/noeterra-prism/preregistration.md";
/** What the study must run exactly as merged: the plan, this script and the engine. */
const FROZEN = [
  PLAN,
  "tools/noeterra-prism-pilot.mjs",
  "noeterra/src",
  "noeterra/Cargo.toml",
  "noeterra/Cargo.lock",
];
const OUT = {
  "dry-run": "docs/benchmarks/noeterra-prism/dry-run",
  check: "docs/benchmarks/noeterra-prism/results",
  study: "docs/benchmarks/noeterra-prism/results",
};

export const SCENARIO = "mediterranean-264bc";
export const CIV = "rome";
export const TURNS = 40;
export const STUDY_SEEDS = 6;
export const DEV_SEEDS = [101, 102, 103];
/** Seeds the lab's archived experiments ran (docs/benchmarks/noeterra-civilization). */
export const LAB_SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
export const CHECK = { seed: 101, turns: 3 };
/** A 40-season Prism game with more FALLBACK seasons than this is invalid. */
export const MAX_FALLBACKS = 2;
/** The study stops when more Prism games than this are invalid. */
export const MAX_INVALID = 1;
/** Input tokens Sarvam may report across `check` and `study` together. */
export const TOKEN_CAP = 2_000_000;
const PLACEHOLDER = "stand-in-placeholder-not-a-key";

/** Each arm is one seat for Rome; every other civilization plays by the rules. */
export const ARMS = {
  rules: { seat: "rules", standIn: null },
  random: { seat: "random", standIn: null },
  passive: { seat: "prism", standIn: "passive" },
  outage: { seat: "prism", standIn: "outage" },
  prism: { seat: "prism", standIn: "sarvam" },
};

/**
 * The six study seeds, drawn from the commit that merges the preregistration,
 * which the plan's author cannot choose. Seeds the lab has run and the dry
 * run's seeds are skipped.
 */
export function studySeeds(commit) {
  if (!/^[0-9a-f]{40}$/.test(commit ?? "")) {
    throw new Error("seeds take the full 40-character SHA of the merge commit");
  }
  const skip = new Set([...LAB_SEEDS, ...DEV_SEEDS]);
  const seeds = [];
  for (let i = 0; seeds.length < STUDY_SEEDS; i++) {
    const h = createHash("sha256")
      .update(`noeterra-prism-pilot/1|${commit}|${i}`)
      .digest("hex");
    const seed = Number(BigInt(`0x${h.slice(0, 12)}`) % 1_000_000n) + 1;
    if (!skip.has(seed) && !seeds.includes(seed)) seeds.push(seed);
  }
  return seeds;
}

// ---------------------------------------------------------------- stand-in

const FIELDS = new Set(["type", "instructions", "criteria"]);

/** The ids Noeterra's Prism seat gives its questions (brain/prism.rs). */
const QUESTION_ID = /^(army|power|action|proposal)-[A-Za-z0-9_-]+$/;

/** Refuses a request Sarvam's API would refuse, as far as its docs say. */
export function invalid(req) {
  if (typeof req?.model !== "string" || typeof req.state !== "string" || !req.state)
    return "model and state are required";
  const qs = req.questions;
  if (!qs || typeof qs !== "object" || Object.keys(qs).length === 0)
    return "questions are required";
  for (const [id, q] of Object.entries(qs)) {
    if (!QUESTION_ID.test(id))
      return `question id ${JSON.stringify(id)} is not one Noeterra asks`;
    if (Object.keys(q).some((k) => !FIELDS.has(k)))
      return `question ${id} has a field the API does not accept`;
    if (q.type === "choice") {
      const n = Object.keys(q.criteria ?? {}).length;
      if (n < 2 || n > 255) return `question ${id} offers ${n} options`;
    } else if (q.type !== "noul") return `question ${id} has type ${q.type}`;
  }
  return null;
}

/**
 * Mechanical answers, not decisions: a test double with three temperaments.
 * Question ids come from the request, so answers are collected in a Map and
 * turned into own properties, never assigned onto an object by name.
 */
export function answers(mode, req) {
  const out = new Map();
  for (const [id, q] of Object.entries(req.questions)) {
    if (q.type === "choice") {
      const options = Object.keys(q.criteria);
      const idle = options.find((o) => o === "hold" || o === "none");
      const moves = options.filter((o) => o !== idle);
      // scripted: armies move, nothing toward foreign powers. passive: nothing at all.
      const chosen =
        mode === "passive"
          ? (idle ?? moves[0])
          : id.startsWith("army-")
            ? moves[0]
            : (idle ?? moves[0]);
      const rest = 0.4 / (options.length - 1);
      const probabilities = Object.fromEntries(
        options.map((o) => [o, o === chosen ? 0.6 : rest]),
      );
      out.set(id, { type: "choice", choice: chosen, confidence: 0.3, probabilities });
    } else {
      const text = q.instructions;
      const p =
        mode === "passive"
          ? 0.1
          : text.includes("learning")
            ? 0.8
            : id.startsWith("proposal-")
              ? 0.7
              : 0.3;
      out.set(id, { type: "noul", noul: p });
    }
  }
  return Object.fromEntries(out);
}

/** A loopback stand-in for POST /v2/systemone. `context` labels its log lines. */
function standIn(log) {
  const state = { mode: "scripted", context: {}, wrongKey: 0 };
  const server = createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const send = (code, payload) => {
        res.writeHead(code, { "content-type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      const keyOk = req.headers["api-subscription-key"] === PLACEHOLDER;
      let parsed = null;
      try {
        parsed = JSON.parse(body);
      } catch {
        // answered below as a 400
      }
      appendFileSync(
        log,
        JSON.stringify({
          ...state.context,
          mode: state.mode,
          bytes: Buffer.byteLength(body),
          sha256: createHash("sha256").update(body).digest("hex"),
          questions: parsed?.questions ? Object.keys(parsed.questions).length : null,
          key_ok: keyOk,
        }) + "\n",
      );
      if (!keyOk) {
        state.wrongKey++;
        return send(403, {
          error: {
            message: "not the stand-in's placeholder key",
            code: "forbidden_error",
          },
        });
      }
      if (req.method !== "POST" || req.url !== "/v2/systemone" || !parsed) {
        return send(400, {
          error: {
            message: "POST a JSON body to /v2/systemone",
            code: "invalid_request_error",
          },
        });
      }
      const why = invalid(parsed);
      if (why)
        return send(422, { error: { message: why, code: "unprocessable_entity_error" } });
      if (state.mode === "outage") {
        return send(503, {
          error: { message: "stand-in outage", code: "model_overloaded" },
        });
      }
      send(200, {
        model: "stand-in-not-sarvam",
        answers: answers(state.mode, parsed),
        usage: { input_tokens: Math.ceil(Buffer.byteLength(body) / 4), output_tokens: 0 },
      });
    });
  });
  return new Promise((done) =>
    server.listen(0, "127.0.0.1", () =>
      done({
        state,
        server,
        url: `http://127.0.0.1:${server.address().port}/v2/systemone`,
      }),
    ),
  );
}

// ---------------------------------------------------------------- running

function exec(cmd, args, env) {
  return new Promise((done, fail) => {
    const child = spawn(cmd, args, { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", fail);
    child.on("close", (code) => done({ code, stdout, stderr }));
  });
}

function git(...args) {
  const r = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
  return { ok: r.status === 0, out: (r.stdout ?? "").trim() };
}

function readJsonl(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

/** Rome's seat in a noeterra-score/v1 line, and the world it ends in. */
export function summarize(score) {
  const seat = score.seats.find((s) => s.civ === CIV) ?? {};
  const rome = score.civs?.[CIV] ?? {};
  const labels = seat.labels ?? {};
  return {
    replay: score.replay?.ok === true,
    final_hash: score.final_hash,
    turns: score.turns,
    provinces: rome.provinces ?? null,
    alive: rome.alive ?? null,
    treasury: rome.treasury ?? null,
    stability: rome.stability ?? null,
    live: labels.live ?? 0,
    fallback: labels.fallback ?? 0,
    tokens_in: seat.tokens_in ?? 0,
    reporting: seat.decisions_reporting_tokens ?? 0,
    latency: seat.latency_ms ?? {},
    discarded: seat.discarded ?? 0,
    active: seat.active_seasons ?? 0,
    errors: seat.errors ?? [],
    models: seat.models_reported ?? [],
    wars_declared: score.metrics?.wars_declared ?? null,
  };
}

/** Rome's decision in each season of a save, as recorded. */
function calls(file) {
  const save = JSON.parse(readFileSync(file, "utf8"));
  const i = save.scenario.civs.findIndex((c) => c.key === CIV);
  return save.turns.map((t) => {
    const d = t.decisions.find((x) => x.civ === i);
    return {
      turn: t.turn,
      label: d.label,
      tokens_in: d.usage?.tokens_in ?? null,
      prompt_sha256: d.prompt_sha256 ?? null,
    };
  });
}

/** Plays one arm on one seed, saves it, scores it and logs both. */
async function game({ out, stage, arm, seed, turns, stand }) {
  const a = ARMS[arm];
  const real = a.standIn === "sarvam" && stage !== "dry-run";
  const save = join(out, `${arm}-${seed}.json`);
  const args = [
    "run",
    "--scenario",
    SCENARIO,
    "--seed",
    String(seed),
    "--turns",
    String(turns),
    "--out",
    save,
  ];
  if (a.seat !== "rules") args.push("--seat", `${CIV}=${a.seat}`);
  const env = { ...process.env };
  delete env.NOETERRA_PRISM_MODEL; // the plan names sarvam-prism, the seat's default
  if (a.seat === "prism") {
    args.push("--live");
    if (real) {
      delete env.NOETERRA_SARVAM_URL;
    } else {
      env.SARVAM_API_KEY = PLACEHOLDER;
      env.NOETERRA_SARVAM_URL = stand.url;
      stand.state.mode = a.standIn === "sarvam" ? "scripted" : a.standIn;
      stand.state.context = { stage, arm, seed };
    }
  }
  const run = await exec(BIN, args, env);
  writeFileSync(join(out, `${arm}-${seed}.log`), run.stdout + run.stderr);
  if (run.code !== 0)
    throw new Error(`noeterra run failed (${arm}, seed ${seed}): ${run.stderr.trim()}`);
  const scored = await exec(BIN, ["score", save], env);
  const score = JSON.parse(scored.stdout.trim().split("\n").at(-1));
  appendFileSync(
    join(out, "scores.jsonl"),
    JSON.stringify({ stage, arm, seed, score }) + "\n",
  );
  const s = summarize(score);
  console.log(
    `GAME: stage=${stage} arm=${arm} seed=${seed} replay=${s.replay ? "ok" : "FAIL"} provinces=${s.provinces}` +
      (a.seat === "prism"
        ? ` live=${s.live} fallback=${s.fallback} tokens_in=${s.tokens_in} discarded=${s.discarded}`
        : ""),
  );
  if (real) {
    const c = calls(save);
    const line = {
      stage,
      seed,
      turns,
      calls: c.length,
      tokens_in: s.tokens_in,
      unreported: c.filter((x) => x.label === "live" && x.tokens_in === null).length,
      per_call_max: Math.max(0, ...c.map((x) => x.tokens_in ?? 0)),
    };
    appendFileSync(join(out, "spend.jsonl"), JSON.stringify(line) + "\n");
  }
  return { s, save };
}

/** An account problem: no amount of retrying fixes it, so the study stops. */
const ACCOUNT = /\b(401|402|403)\b|insufficient_quota|unauthori[sz]ed|forbidden/i;

function spent(out) {
  const rows = readJsonl(join(out, "spend.jsonl"));
  return {
    tokens: rows.reduce((n, r) => n + r.tokens_in, 0),
    unreported: rows.reduce((n, r) => n + r.unreported, 0),
    perCall: Math.max(0, ...rows.map((r) => r.per_call_max)),
  };
}

function walk(p) {
  return statSync(p).isDirectory()
    ? readdirSync(p).flatMap((n) => walk(join(p, n)))
    : [p];
}

/**
 * The runner and the engine as git would store them (blob hashes, so line
 * endings do not matter), without the plan's prose. A dry run, a check and a
 * study with the same fingerprint ran the same code.
 */
export function fingerprint() {
  const files = FROZEN.filter((p) => p !== PLAN)
    .flatMap((p) => walk(join(ROOT, p)))
    .map((f) => relative(ROOT, f).split(sep).join("/"))
    .sort();
  const r = spawnSync("git", ["hash-object", "--stdin-paths"], {
    cwd: ROOT,
    input: files.join("\n") + "\n",
    encoding: "utf8",
  });
  if (r.status !== 0) throw new Error("git hash-object failed");
  const blobs = r.stdout.trim().split("\n");
  const list = files.map((f, i) => `${blobs[i]} ${f}\n`).join("");
  return createHash("sha256").update(list).digest("hex");
}

/** Refuses a paid stage whose code is not the code the dry run checked. */
export function sameCodeAsDryRun() {
  const dry = join(resolve(ROOT, OUT["dry-run"]), "dry-run.json");
  if (!existsSync(dry)) throw new Error(`run the dry run first (${dry} is missing)`);
  const theirs = JSON.parse(readFileSync(dry, "utf8")).fingerprint;
  if (theirs !== fingerprint()) {
    throw new Error("the dry run was made by a different runner or engine; run it again");
  }
}

function head() {
  return {
    commit: git("rev-parse", "HEAD").out,
    dirty: git("status", "--porcelain", "--", ...FROZEN).out !== "",
    fingerprint: fingerprint(),
  };
}

/** Builds the engine from the source the fingerprint covers, so no stale binary runs. */
async function build() {
  const args = ["build", "--release", "--manifest-path", "noeterra/Cargo.toml"];
  let r;
  try {
    r = await exec("cargo", args, process.env);
  } catch {
    throw new Error("cargo is not on PATH (on this laptop it is in ~/.cargo/bin)");
  }
  if (r.code !== 0 || !existsSync(BIN))
    throw new Error(`cargo build failed: ${r.stderr.trim()}`);
}

async function dryRun(out) {
  await build();
  mkdirSync(out, { recursive: true });
  for (const f of ["scores.jsonl", "stand-in.jsonl"]) writeFileSync(join(out, f), "");
  const stand = await standIn(join(out, "stand-in.jsonl"));
  try {
    for (const seed of DEV_SEEDS) {
      for (const arm of Object.keys(ARMS))
        await game({ out, stage: "dry-run", arm, seed, turns: TURNS, stand });
    }
  } finally {
    stand.server.close();
  }
  const log = readJsonl(join(out, "stand-in.jsonl"));
  const prism = log.filter((l) => l.arm === "prism");
  const bytes = prism.map((l) => l.bytes);
  const summary = {
    stage: "dry-run",
    ...head(),
    seeds: DEV_SEEDS,
    turns: TURNS,
    requests: log.length,
    wrong_key: stand.state.wrongKey,
    prism_request_bytes: {
      n: bytes.length,
      mean: Math.round(bytes.reduce((a, b) => a + b, 0) / Math.max(1, bytes.length)),
      min: Math.min(...bytes),
      max: Math.max(...bytes),
    },
  };
  writeFileSync(join(out, "dry-run.json"), JSON.stringify(summary, null, 2) + "\n");
  console.log(
    `DRY_RUN: requests=${log.length} wrong_key=${stand.state.wrongKey} prism_bytes=${JSON.stringify(summary.prism_request_bytes)}`,
  );
  return report({ scores: join(out, "scores.jsonl"), stage: "dry-run" });
}

function requireSpend(flags) {
  if (!flags.spend)
    throw new Error("this stage calls Sarvam and spends credit; pass --spend to confirm");
  if (!process.env.SARVAM_API_KEY)
    throw new Error("SARVAM_API_KEY is not set in this shell's environment");
}

async function check(out, flags) {
  await build();
  requireSpend(flags);
  mkdirSync(out, { recursive: true });
  const dryDir = resolve(ROOT, OUT["dry-run"]);
  const dry = join(dryDir, "dry-run.json");
  sameCodeAsDryRun();
  const before = spent(out);
  const estimate =
    CHECK.turns *
    Math.ceil(JSON.parse(readFileSync(dry, "utf8")).prism_request_bytes.max / 2);
  if (before.tokens + estimate > TOKEN_CAP)
    throw new Error(`budget_exhausted: ${before.tokens} + ${estimate} > ${TOKEN_CAP}`);
  const { s, save } = await game({
    out,
    stage: "check",
    arm: "prism",
    seed: CHECK.seed,
    turns: CHECK.turns,
  });
  const c = calls(save);
  // Season 1's request depends only on the starting world, so the dry run sent the same bytes.
  const first = readJsonl(join(dryDir, "stand-in.jsonl")).find(
    (l) => l.arm === "prism" && l.seed === CHECK.seed && l.sha256 === c[0]?.prompt_sha256,
  );
  const dryBytes = JSON.parse(readFileSync(dry, "utf8")).prism_request_bytes;
  const ratio = first && c[0].tokens_in ? c[0].tokens_in / first.bytes : null;
  const calls240 = STUDY_SEEDS * TURNS;
  const projection = ratio
    ? {
        tokens_per_byte: Number(ratio.toFixed(4)),
        study_tokens: Math.round(ratio * dryBytes.mean * calls240),
        range: [
          Math.round(ratio * dryBytes.min * calls240),
          Math.round(ratio * dryBytes.max * calls240),
        ],
      }
    : {
        tokens_per_byte: null,
        study_tokens: Math.round((s.tokens_in / Math.max(1, s.reporting)) * calls240),
      };
  const after = spent(out);
  const pass =
    s.replay &&
    s.fallback === 0 &&
    s.discarded === 0 &&
    s.live === CHECK.turns &&
    !s.errors.some((e) => ACCOUNT.test(e));
  const top = projection.range ? projection.range[1] : projection.study_tokens;
  const verdict = after.tokens + top <= TOKEN_CAP ? "within" : "exceeds";
  const result = {
    stage: "check",
    ...head(),
    seed: CHECK.seed,
    turns: CHECK.turns,
    pass,
    game: s,
    calls: c,
    spent: after,
    projection,
    cap: TOKEN_CAP,
    verdict,
  };
  writeFileSync(join(out, "check.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(
    `SPEND: tokens_in=${after.tokens} unreported_calls=${after.unreported} cap=${TOKEN_CAP}`,
  );
  console.log(`PROJECTION: ${JSON.stringify(projection)} verdict=${verdict}`);
  console.log(
    `CHECK: ${pass ? "pass" : "FAIL"} live=${s.live}/${CHECK.turns} fallback=${s.fallback} discarded=${s.discarded} models=${s.models.join(",")}`,
  );
  if (!pass) process.exitCode = 1;
}

async function study(out, flags) {
  await build();
  requireSpend(flags);
  const merge = flags.merge;
  const seeds = studySeeds(merge);
  if (!git("merge-base", "--is-ancestor", merge, "HEAD").ok)
    throw new Error(`${merge} is not an ancestor of HEAD`);
  if (!git("diff", "--quiet", merge, "--", ...FROZEN).ok || head().dirty) {
    throw new Error(
      `the plan, this script or the engine differ from ${merge}; check out the merge commit to run the study`,
    );
  }
  sameCodeAsDryRun();
  const chk = join(out, "check.json");
  if (!existsSync(chk) || !JSON.parse(readFileSync(chk, "utf8")).pass)
    throw new Error("the priced check has not passed");
  const stand = await standIn(join(out, "stand-in.jsonl"));
  let invalidGames = 0;
  let stopped = null;
  try {
    for (const seed of seeds) {
      for (const arm of ["rules", "random", "passive", "outage"]) {
        const { s } = await game({ out, stage: "study", arm, seed, turns: TURNS, stand });
        if (!s.replay) stopped = `replay failed (${arm}, seed ${seed})`;
      }
      if (stopped) break;
      const ledger = spent(out);
      const need = Math.ceil(TURNS * Math.max(ledger.perCall, 1) * 1.25);
      if (ledger.tokens + need > TOKEN_CAP) {
        stopped = `budget_exhausted: ${ledger.tokens} + ${need} > ${TOKEN_CAP}`;
        break;
      }
      const { s } = await game({ out, stage: "study", arm: "prism", seed, turns: TURNS });
      if (s.errors.some((e) => ACCOUNT.test(e))) {
        stopped = `account error from Sarvam (seed ${seed}): ${s.errors.find((e) => ACCOUNT.test(e))}`;
        break;
      }
      if (!s.replay) {
        stopped = `replay failed (prism, seed ${seed})`;
        break;
      }
      if (s.fallback > MAX_FALLBACKS) invalidGames++;
      if (invalidGames > MAX_INVALID) {
        stopped = `${invalidGames} Prism games had more than ${MAX_FALLBACKS} FALLBACK seasons: not measured`;
        break;
      }
    }
  } finally {
    stand.server.close();
  }
  const result = {
    stage: "study",
    ...head(),
    merge,
    seeds,
    turns: TURNS,
    status: stopped ? `stopped: ${stopped}` : "complete",
    spent: spent(out),
    cap: TOKEN_CAP,
  };
  writeFileSync(join(out, "study.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(`STUDY: ${result.status}`);
  return report({ scores: join(out, "scores.jsonl"), stage: "study" });
}

// ---------------------------------------------------------------- report

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const round = (x, d = 2) => (x === null ? null : Number(x.toFixed(d)));

/** Two-sided sign test, ties left out. Descriptive: the bars do not use it. */
export function signTest(up, down) {
  const n = up + down;
  if (n === 0) return 1;
  let tail = 0;
  for (let k = Math.max(up, down); k <= n; k++) {
    let c = 1;
    for (let j = 0; j < k; j++) c = (c * (n - j)) / (j + 1);
    tail += c / 2 ** n;
  }
  return Math.min(1, 2 * tail);
}

/** Applies the preregistered bars to scored games, seed by seed. */
export function evaluate(rows) {
  const bySeed = new Map();
  for (const r of rows) {
    if (!bySeed.has(r.seed)) bySeed.set(r.seed, {});
    bySeed.get(r.seed)[r.arm] = summarize(r.score);
  }
  const seeds = [...bySeed.keys()].sort((a, b) => a - b);
  const counts = {
    seeds: seeds.length,
    games: rows.length,
    replay_failures: 0,
    invalid_prism_games: 0,
    outage_mismatches: 0,
    random_separated_seeds: 0,
    passive_caught_seeds: 0,
    prism_acting_seeds: 0,
    prism_more: 0,
    prism_fewer: 0,
    prism_same: 0,
  };
  const ok = (g) => g && g.replay;
  const deltas = [];
  const randomDeltas = [];
  let validPrism = 0;
  for (const seed of seeds) {
    const g = bySeed.get(seed);
    for (const arm of Object.values(g)) if (!arm.replay) counts.replay_failures++;
    const { rules, random, passive, outage, prism } = g;
    if (
      outage &&
      !(
        ok(outage) &&
        ok(rules) &&
        outage.final_hash === rules.final_hash &&
        outage.fallback === outage.turns
      )
    ) {
      counts.outage_mismatches++;
    }
    if (ok(rules) && ok(random)) {
      randomDeltas.push(rules.provinces - random.provinces);
      if (rules.provinces > random.provinces) counts.random_separated_seeds++;
    }
    const acts = (a) => ok(rules) && a.active >= rules.active / 2;
    if (ok(passive) && ok(rules) && !acts(passive)) counts.passive_caught_seeds++;
    if (prism) {
      const valid = ok(prism) && prism.fallback <= MAX_FALLBACKS;
      if (!valid) counts.invalid_prism_games++;
      else if (ok(rules)) {
        validPrism++;
        if (acts(prism)) counts.prism_acting_seeds++;
        const d = prism.provinces - rules.provinces;
        deltas.push(d);
        counts[d > 0 ? "prism_more" : d < 0 ? "prism_fewer" : "prism_same"]++;
      }
    }
  }
  const n = seeds.length;
  const instruments = {
    "outage-equals-rules":
      counts.outage_mismatches === 0 && seeds.every((s) => bySeed.get(s).outage),
    "random-separates":
      (mean(randomDeltas) ?? 0) >= 1 && counts.random_separated_seeds >= n - 1,
    "passive-caught": counts.passive_caught_seeds === n,
  };
  const bars = {
    replay: counts.replay_failures === 0,
    live: validPrism >= n - MAX_INVALID && counts.invalid_prism_games <= MAX_INVALID,
    acts: validPrism > 0 && counts.prism_acting_seeds === validPrism,
  };
  const md = mean(deltas);
  const broken = Object.entries({
    ...instruments,
    replay: bars.replay,
    live: bars.live,
  }).filter(([, v]) => !v);
  let verdict;
  if (broken.length) verdict = `not read: ${broken.map(([k]) => k).join(", ")} failed`;
  else if (md >= 1 && counts.prism_more === validPrism)
    verdict = "Prism held more provinces";
  else if (md <= -1 && counts.prism_fewer === validPrism)
    verdict = "Prism held fewer provinces";
  else verdict = "no difference shown (not evidence that there is none)";
  const per = (arm, key) =>
    round(
      mean(
        seeds
          .map((s) => bySeed.get(s)[arm])
          .filter(ok)
          .map((x) => x[key]),
      ),
    );
  const prismGames = seeds.map((s) => bySeed.get(s).prism).filter(ok);
  return {
    counts,
    instruments,
    bars,
    outcome: {
      metric: `provinces.${CIV} at season ${TURNS}, prism minus rules`,
      deltas,
      mean_delta: round(md),
      sign_test_p: round(signTest(counts.prism_more, counts.prism_fewer), 4),
      verdict,
    },
    descriptive: {
      random_minus_rules_mean: round(mean(randomDeltas.map((d) => -d))),
      ...Object.fromEntries(
        ["rules", "random", "passive", "prism"].map((arm) => [
          arm,
          {
            provinces: per(arm, "provinces"),
            treasury: per(arm, "treasury"),
            stability: per(arm, "stability"),
            active_seasons: per(arm, "active"),
            wars_declared: per(arm, "wars_declared"),
            fallen: seeds.filter(
              (s) => ok(bySeed.get(s)[arm]) && bySeed.get(s)[arm].alive === false,
            ).length,
          },
        ]),
      ),
      prism_tokens_per_call: round(
        mean(prismGames.map((p) => p.tokens_in / Math.max(1, p.reporting))),
        0,
      ),
      prism_latency_ms_max: Math.max(0, ...prismGames.map((p) => p.latency.max ?? 0)),
      prism_discarded: prismGames.reduce((a, p) => a + p.discarded, 0),
      prism_models: [...new Set(prismGames.flatMap((p) => p.models))],
    },
  };
}

function report(flags) {
  const file = flags.scores ?? join(flags.out ?? OUT.study, "scores.jsonl");
  const rows = readJsonl(file).filter((r) => !flags.stage || r.stage === flags.stage);
  const r = evaluate(rows);
  if (flags.json) console.log(JSON.stringify(r, null, 2));
  for (const [k, v] of Object.entries(r.instruments))
    console.log(`INSTRUMENT: ${k} ${v ? "ok" : "FAIL"}`);
  for (const [k, v] of Object.entries(r.bars))
    console.log(`BAR: ${k} ${v ? "ok" : "FAIL"}`);
  console.log(
    `OUTCOME: ${r.outcome.metric}: mean ${r.outcome.mean_delta} ${JSON.stringify(r.outcome.deltas)} -> ${r.outcome.verdict}`,
  );
  console.log(`DESCRIPTIVE: ${JSON.stringify(r.descriptive)}`);
  console.log(JSON.stringify(r.counts));
  return r;
}

// ---------------------------------------------------------------- main

function parse(argv) {
  const flags = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--spend" || a === "--json") flags[a.slice(2)] = true;
    else if (a.startsWith("--")) flags[a.slice(2)] = argv[++i];
    else flags._.push(a);
  }
  return flags;
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const flags = parse(rest);
  const out = resolve(ROOT, flags.out ?? OUT[cmd] ?? OUT.study);
  switch (cmd) {
    case "seeds":
      console.log(studySeeds(flags._[0]).join(" "));
      return;
    case "dry-run":
      await dryRun(out);
      return;
    case "check":
      await check(out, flags);
      return;
    case "study":
      await study(out, flags);
      return;
    case "report":
      report({ ...flags, out });
      return;
    default:
      console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0]);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`noeterra-prism-pilot: ${e.message}`);
    process.exitCode = 1;
  });
}
