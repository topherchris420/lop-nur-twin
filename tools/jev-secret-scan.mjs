#!/usr/bin/env node
/**
 * Prove the browser build carries no model-provider credential.
 *
 * The Jev decision endpoint reads `TYPESAFE_API_KEY` on the server. Nothing in
 * `src/` may read it, and `src/game/pilot/secretBoundary.test.ts` checks the
 * source — but a secret leaks through the *build*: a `VITE_` copy inlined by
 * Vite, a `define`, a source map that quotes a config file. So this reads every
 * file under the output directory, source maps included, and fails on:
 *
 *  - the variable's name, `TYPESAFE_API_KEY` or `VITE_TYPESAFE…`;
 *  - anything shaped like a TypeSafe key (`apikey_` followed by a long token);
 *  - the actual key, when `TYPESAFE_API_KEY` is set in this environment — as it
 *    is on a Vercel build. The value is compared, never printed.
 *
 * The same rules cover the Glide endpoint's `FASTINO_API_KEY`: its name, a
 * `VITE_FASTINO…` copy, a Fastino-shaped key (`fast_sk_…`) and the configured
 * value. And the LLM endpoint's `LLM_API_KEY`: its name, a
 * `VITE_LLM…` copy, key shapes of the providers it supports (`sk-ant-…`,
 * `sk-…`), and the configured value — and the R.A.I.N. runtime's
 * `RAIN_LLM_API_KEY` (a model server's bearer token) and `RAIN_REGISTRY_SECRET`
 * (the key that certifies pre-registrations): their names, a `VITE_RAIN…` copy
 * and the configured values.
 *
 *   node tools/jev-secret-scan.mjs            # scans dist/
 *   node tools/jev-secret-scan.mjs path/to/output
 *   node tools/jev-secret-scan.mjs --self-test  # checks the key shapes themselves
 *
 * Runs as the last step of `bun run build`. Exits non-zero on any finding.
 */

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const selfTest = process.argv[2] === "--self-test";
const root = selfTest ? null : (process.argv[2] ?? "dist");
if (root !== null && !existsSync(root)) {
  console.error(`jev-secret-scan: no such directory: ${root}`);
  process.exit(2);
}

const patterns = [
  {
    name: "credential variable name",
    test: (text) =>
      /TYPESAFE_API_KEY|VITE_TYPESAFE|FASTINO_API_KEY|VITE_FASTINO|LLM_API_KEY|VITE_LLM_|RAIN_REGISTRY_SECRET|VITE_RAIN_/.test(
        text,
      ),
  },
  { name: "TypeSafe-shaped key", test: (text) => /apikey_[A-Za-z0-9_]{24,}/.test(text) },
  {
    name: "Fastino-shaped key",
    test: (text) => /fast_sk_[A-Za-z0-9_-]{24,}/.test(text),
  },
  {
    name: "Anthropic-shaped key",
    test: (text) => /sk-ant-[A-Za-z0-9_-]{20,}/.test(text),
  },
  {
    // Legacy `sk-` keys are alphanumeric; project, service-account and admin
    // keys (`sk-proj-`, `sk-svcacct-`, `sk-admin-`) carry `-` and `_` too.
    name: "OpenAI-shaped key",
    test: (text) => /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}/.test(text),
  },
];

if (selfTest) {
  // Synthetic shapes only, assembled at run time so the source holds no
  // key-shaped literal: none of these is, or was, a real credential.
  const body = "aB3".repeat(11);
  const mustFlag = [
    ["OpenAI-shaped key", `"sk-${body}"`],
    ["OpenAI-shaped key", `value=sk-proj-${body.slice(0, 12)}-${body.slice(12)}_x`],
    ["OpenAI-shaped key", `sk-svcacct-${body}`],
    ["OpenAI-shaped key", `sk-admin-${body}`],
    ["Anthropic-shaped key", `sk-ant-api03-${body}`],
    ["Fastino-shaped key", `fast_sk_${body}`],
    ["TypeSafe-shaped key", `apikey_${body}`],
    ["credential variable name", "process.env.VITE_LLM_KEY"],
  ];
  const mustPass = [
    "task-scheduler-queue-length-limit",
    "risk-assessment",
    "sk-short",
    "desk-lamp-and-chair-set-for-the-office",
  ];
  const failures = [];
  for (const [name, text] of mustFlag) {
    const pattern = patterns.find((p) => p.name === name);
    if (!pattern?.test(text)) failures.push(`missed (${name}): ${text}`);
  }
  for (const text of mustPass)
    for (const pattern of patterns)
      if (pattern.test(text)) failures.push(`false positive (${pattern.name}): ${text}`);
  if (failures.length > 0) {
    console.error("jev-secret-scan --self-test FAILED:");
    for (const failure of failures) console.error(`  ${failure}`);
    process.exit(1);
  }
  console.log(
    `jev-secret-scan --self-test: ${mustFlag.length} shapes flagged, ${mustPass.length} look-alikes passed`,
  );
  process.exit(0);
}
const configured = [];
for (const variable of [
  "TYPESAFE_API_KEY",
  "FASTINO_API_KEY",
  "LLM_API_KEY",
  "RAIN_LLM_API_KEY",
  "RAIN_REGISTRY_SECRET",
]) {
  const value = (process.env[variable] ?? "").trim();
  if (value.length < 12) continue;
  configured.push(variable);
  patterns.push({
    name: `the configured ${variable} value`,
    test: (text) => text.includes(value),
  });
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

const findings = [];
let scanned = 0;
for (const path of walk(root)) {
  const text = readFileSync(path).toString("latin1");
  scanned += 1;
  for (const pattern of patterns) {
    if (pattern.test(text))
      findings.push(`${relative(process.cwd(), path)}: ${pattern.name}`);
  }
}

if (findings.length > 0) {
  console.error("jev-secret-scan: the build output contains credential material:");
  for (const finding of findings) console.error(`  ${finding}`);
  process.exit(1);
}
console.log(
  `jev-secret-scan: ${scanned} files in ${root}/ clean` +
    (configured.length > 0
      ? ` (including the configured value of ${configured.join(", ")})`
      : ""),
);
