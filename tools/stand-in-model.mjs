#!/usr/bin/env node
/**
 * A stand-in for a local OpenAI-compatible model server, for offline tests.
 *
 * It is not a model and claims nothing a model would. It answers
 * `GET /v1/models` and `POST /v1/chat/completions` on loopback with
 * deterministic text built from the request itself: each reply quotes, word
 * for word, one sentence from the research-paper excerpts the runtime put in
 * the prompt (the `--- PAPER: <path> ---` blocks), so the runtime's citation
 * check has real corpus text to verify, and one sentence that is in no paper,
 * so the check has a quotation to refuse. Every reply says it came from the
 * stand-in. The lab labels the meeting with the model name this server
 * reports, `stand-in-model`, never a real model's.
 *
 * It also stands in for the autonomous research loop's model
 * (`src/rain/autonomy/`), on both APIs that loop speaks: LM Studio's
 * (`/v1/chat/completions` with a `json_schema` response format) and
 * Ollama's (`GET /api/tags`, `POST /api/chat` with a `format` schema). Asked
 * for the researcher's action, it proposes the first design the prompt lists
 * as NOT RUN, or stops when none is; asked for the analyst's reading, it
 * repeats the reading the prompt's verdict line implies. Both are mechanical,
 * and its words say so: a test double, not reasoning.
 *
 *   node tools/stand-in-model.mjs --port 4189
 *
 * Standard library only; loopback only.
 */
import { createHash } from "node:crypto";
import { createServer } from "node:http";

const MODEL = "stand-in-model";
const MAX_BODY = 4 * 1024 * 1024;
// The runtime's prompt lists papers under "### RESEARCH DATABASE"; each
// excerpt ends at the next paper or the next "###" section.
const PAPER = /^--- PAPER: ([^\n]+?) ---\n([\s\S]*?)(?=^--- PAPER: |^### |(?![\s\S]))/gm;
// A plain prose sentence: no markup, no quotes of its own, a sensible length.
const SENTENCE =
  /(?<![\p{L}\p{N}_.])([A-Z][^"*#`|<>[\]{}]{60,220}?[a-z0-9)]\.)(?=\s|$)/gu;
// The quote an earlier stand-in reply made, carried through the runtime's
// critique-and-revise passes, whose prompts hold the reply but no papers.
const EARLIER = /quoted exactly: "([^"]{20,400})"/g;
/** A quotation no paper contains: the runtime's check must not verify it. */
const INVENTED =
  "The stand-in model wrote this sentence itself, and no paper in the corpus contains it.";

/** Sentences from the paper excerpts. PDF text breaks lines mid-sentence; the
 * runtime's matcher collapses whitespace, so a sentence is quoted with its
 * line breaks as spaces and still matches the paper exactly. */
function sentences(prompt) {
  const found = [];
  // Each message on its own: the last excerpt ends with the message that holds
  // it, never with the transcript or the director's instruction that follow.
  for (const paper of prompt.matchAll(PAPER)) {
    const flat = paper[2].split(/\s+/).filter(Boolean).join(" ");
    for (const m of flat.matchAll(SENTENCE))
      if (!m[1].includes("stand-in")) found.push(m[1]);
  }
  return found;
}

function reply(messages, maxTokens) {
  const contents = messages.map((m) =>
    m && typeof m === "object" ? String(m.content ?? "") : "",
  );
  const text = contents.join("\n");
  if (maxTokens <= 8) return "ok";
  let pool = contents.flatMap((content) => sentences(content));
  if (!pool.length) pool = [...text.matchAll(EARLIER)].map((m) => m[1]).slice(0, 1);
  if (!pool.length)
    return (
      "[stand-in model] The prompt carried no paper excerpt this stand-in could quote, " +
      "so there is nothing here to verify. This is a test reply, not analysis, and it " +
      "makes no claim about the question."
    );
  // Deterministic: the same request always gets the same sentence.
  const digest = BigInt("0x" + createHash("sha256").update(text, "utf8").digest("hex"));
  const quote = pool[Number(digest % BigInt(pool.length))];
  return (
    `[stand-in model] One sentence from the excerpts, quoted exactly: "${quote}" ` +
    `And one that is in no paper, for the check to refuse: "${INVENTED}" ` +
    "This reply comes from a test double that copies a sentence from the corpus so " +
    "that the citation check has something real to verify. It is not analysis, it " +
    "weighs nothing, and it should not be read as an argument for or against any " +
    "hypothesis. A real local model would answer here instead, with its own reasoning " +
    "and its own quotations, each checked against the same corpus."
  );
}

/** The autonomy loop's two structured questions, told apart by the schema asked for. */
function structured(messages, schema) {
  const prompt = messages
    .map((m) => (m && typeof m === "object" ? String(m.content ?? "") : ""))
    .join("\n");
  const props = schema && typeof schema === "object" ? (schema.properties ?? {}) : {};
  if ("reading" in props) {
    const verdict =
      /^VERDICT \(the registry's pre-registered criteria\): (.+)$/m.exec(prompt)?.[1] ??
      "";
    return {
      action: "record_analysis",
      reading:
        verdict === "supported"
          ? "supports"
          : verdict === "not supported"
            ? "contradicts"
            : "inconclusive",
      interpretation: `[stand-in model] The verdict line reads "${verdict || "nothing"}", and this reply repeats the reading it implies. A test double, not an analysis.`,
      caveats: ["[stand-in model] A real model would weigh the per-seed results here."],
      open_questions: [
        "[stand-in model] Does the replication panel agree with the primary one?",
      ],
    };
  }
  const design =
    /^- (X\d+-(?:increase|decrease)-(?:primary|replication)) · NOT RUN$/m.exec(
      prompt,
    )?.[1] ?? "";
  const blank = {
    action: "stop",
    design: "",
    experiment: "",
    question: "",
    hypothesis: "",
    competing_hypothesis: "",
    rationale: "",
    ranking: [],
    stop_reason: "",
  };
  if (!design)
    return {
      ...blank,
      stop_reason: "[stand-in model] The prompt lists no design as NOT RUN.",
    };
  return {
    ...blank,
    action: "propose_experiment",
    design,
    question: `[stand-in model] What does design ${design} measure?`,
    hypothesis: `[stand-in model] ${design} moves its metric the way its id names.`,
    competing_hypothesis: `[stand-in model] ${design} moves it the other way, or not at all.`,
    rationale:
      "[stand-in model] The first design the Lab lists as NOT RUN, taken mechanically. A test double's choice, not reasoning.",
  };
}

const option = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? Number(process.argv[i + 1]) : fallback;
};
const port = option("--port", 4189);
/** Milliseconds before each completion answers, so a test can watch a meeting run. */
const delayMs = option("--delay-ms", 0);
if (
  !Number.isInteger(port) ||
  port < 1 ||
  port > 65535 ||
  !Number.isInteger(delayMs) ||
  delayMs < 0 ||
  delayMs > 60_000
) {
  console.error("usage: node tools/stand-in-model.mjs [--port N] [--delay-ms N]");
  process.exit(2);
}
const send = (res, status, payload) => {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
};

const server = createServer((req, res) => {
  const path = (req.url ?? "").split("?")[0].replace(/\/+$/, "");
  if (req.method === "GET") {
    if (path === "/v1/models")
      return send(res, 200, {
        object: "list",
        data: [{ id: MODEL, object: "model", owned_by: "test" }],
      });
    // Ollama's own listing, for the autonomy loop's Ollama adapter.
    if (path === "/api/tags")
      return send(res, 200, { models: [{ name: MODEL, model: MODEL }] });
    return send(res, 404, { error: { message: "not found" } });
  }
  const ollama = path === "/api/chat";
  if (req.method !== "POST" || (path !== "/v1/chat/completions" && !ollama))
    return send(res, 404, { error: { message: "not found" } });
  const chunks = [];
  let size = 0;
  req.on("data", (chunk) => {
    size += chunk.length;
    if (size > MAX_BODY) {
      send(res, 413, { error: { message: "body too large" } });
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on("end", () => {
    if (res.writableEnded) return;
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      return send(res, 400, { error: { message: "invalid JSON" } });
    }
    const messages = body && typeof body === "object" ? body.messages : null;
    if (!Array.isArray(messages))
      return send(res, 400, { error: { message: "messages required" } });
    const schema = ollama
      ? body.format
      : body.response_format?.type === "json_schema"
        ? body.response_format.json_schema?.schema
        : null;
    const maxTokens = Number.isInteger(body.max_tokens)
      ? body.max_tokens
      : Number.isInteger(body.options?.num_predict)
        ? body.options.num_predict
        : 512;
    const content =
      schema && typeof schema === "object"
        ? JSON.stringify(structured(messages, schema))
        : reply(messages, maxTokens);
    if (ollama)
      // No eval counts: this server counts no tokens, and reports none.
      return setTimeout(
        () =>
          send(res, 200, {
            model: MODEL,
            created_at: new Date().toISOString(),
            message: { role: "assistant", content },
            done: true,
            done_reason: "stop",
          }),
        schema ? 0 : delayMs,
      );
    setTimeout(
      () =>
        send(res, 200, {
          id:
            "chatcmpl-stand-in-" +
            createHash("sha256").update(content).digest("hex").slice(0, 12),
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: MODEL,
          choices: [
            { index: 0, finish_reason: "stop", message: { role: "assistant", content } },
          ],
          // No usage block: this server counts no tokens, and reports none.
        }),
      maxTokens <= 8 || schema ? 0 : delayMs,
    );
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(
    `stand-in model on http://127.0.0.1:${port}/v1 · model ${MODEL} · a test double, not a model`,
  );
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    server.close();
    process.exit(0);
  });
