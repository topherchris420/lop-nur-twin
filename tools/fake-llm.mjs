/**
 * An offline test double for the LLM seat, and a dev server wired to it.
 *
 * `startFakeLlm` serves the OpenAI-compatible Chat Completions shape on
 * 127.0.0.1. It reads the answer schema the server sent, picks one offered
 * option per axis from a seeded stream, writes a seeded "confidence", and
 * answers after a configurable delay. It knows nothing about the game — it
 * never reads the state — so whatever it does, it does blind. It exists to
 * exercise the real path end to end: the page, `/api/llm/decision`, the
 * adapter, validation, the executor. Its results are labelled TEST DOUBLE
 * everywhere and are never a language model's.
 *
 * `startDevServer` runs Vite on its own port with `LLM_*` pointed at the fake,
 * so the endpoint under test is the real handler with a fake upstream.
 */

import { createServer } from "node:http";
import { spawn } from "node:child_process";

export const FAKE_MODEL = "fake-llm-test-double";
export const FAKE_KEY = "offline-test-double-key-not-a-secret";

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function startFakeLlm({
  seed = 7,
  latencyMs = [300, 900],
  failEvery = 0,
} = {}) {
  const rand = mulberry32(seed);
  const log = { requests: 0, authorized: 0, withSchema: 0, failures: 0 };
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      log.requests += 1;
      if (req.headers.authorization === `Bearer ${FAKE_KEY}`) log.authorized += 1;
      let parsed = null;
      try {
        parsed = JSON.parse(body);
      } catch {
        parsed = null;
      }
      const schema = parsed?.response_format?.json_schema?.schema;
      if (schema) log.withSchema += 1;
      const delay = latencyMs[0] + rand() * (latencyMs[1] - latencyMs[0]);
      setTimeout(() => {
        if (failEvery > 0 && log.requests % failEvery === 0) {
          log.failures += 1;
          res.writeHead(500, { "content-type": "application/json" });
          res.end("{}");
          return;
        }
        const answers = {};
        const asksConfidence = Object.values(schema?.properties ?? {}).some(
          (p) => p?.properties?.confidence,
        );
        for (const [axis, prop] of Object.entries(schema?.properties ?? {})) {
          const options = prop?.properties?.choice?.enum ?? [];
          const choice = options[Math.floor(rand() * options.length)];
          answers[axis] = asksConfidence
            ? { choice, confidence: Math.round(rand() * 100) / 100 }
            : { choice };
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            id: `fake-${log.requests}`,
            model: FAKE_MODEL,
            choices: [
              { message: { content: JSON.stringify(answers) }, finish_reason: "stop" },
            ],
            // Deterministic stand-ins sized like a real call, flagged by the model name.
            usage: { prompt_tokens: Math.round(body.length / 4), completion_tokens: 60 },
          }),
        );
      }, delay);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    log,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/** Vite on `port`, with the given environment; resolves once it answers. */
export async function startDevServer(port, env) {
  const child = spawn(
    process.execPath,
    ["node_modules/vite/bin/vite.js", "--port", String(port), "--strictPort"],
    { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "";
  child.stdout.on("data", (c) => (output += c));
  child.stderr.on("data", (c) => (output += c));
  const origin = `http://localhost:${port}`;
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      const r = await fetch(`${origin}/api/llm/decision`);
      if (r.ok) break;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline || child.exitCode !== null) {
      child.kill();
      throw new Error(`dev server on ${port} did not start:\n${output.slice(-1500)}`);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return { origin, close: () => child.kill() };
}
