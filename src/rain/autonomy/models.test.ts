import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { autonomyConfig, normalizeBaseUrl, type ProviderKind } from "./config";
import {
  MAX_RESPONSE,
  ModelFailure,
  createLocalModel,
  createOpenAIResearchModel,
  listsModel,
  parseStructured,
} from "./models";

interface Seen {
  url: string;
  method: string;
  body: Record<string, unknown> | null;
}
/** A fake server: records each request and answers with `reply`. */
function server(
  reply: (url: string, body: Record<string, unknown> | null) => Response | Error,
) {
  const seen: Seen[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const body = init?.body
      ? (JSON.parse(String(init.body)) as Record<string, unknown>)
      : null;
    seen.push({ url: String(url), method: init?.method ?? "GET", body });
    const answer = reply(String(url), body);
    if (answer instanceof Error) throw answer;
    return answer;
  }) as typeof fetch;
  return { seen, fetchImpl };
}
const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const settings = (provider: ProviderKind, overrides: Record<string, unknown> = {}) => ({
  provider,
  model: provider === "ollama" ? "qwen2.5:7b" : "qwen2.5-7b-instruct",
  baseUrl: provider === "ollama" ? "http://127.0.0.1:11434" : "http://127.0.0.1:1234",
  timeoutMs: 5000,
  temperature: 0.2,
  maxTokens: 512,
  contextTokens: 8192,
  ...overrides,
});
const request = {
  system: "system words",
  user: "user words",
  schemaName: "rain_test",
  schema: { type: "object", properties: { a: { type: "string" } }, required: ["a"] },
};

describe("explicit server-side OpenAI research collaborator", () => {
  const input = {
    model: "operator-pinned-version",
    apiKey: "synthetic-test-credential",
    remoteAllowed: true,
    timeoutMs: 5000,
    maxTokens: 512,
  };
  it("requires explicit consent and credentials, fixes the destination, and leaves credentials out of provenance", async () => {
    expect(() => createOpenAIResearchModel({ ...input, remoteAllowed: false })).toThrow(
      "consent",
    );
    expect(() => createOpenAIResearchModel({ ...input, apiKey: "" })).toThrow(
      "credential",
    );
    let destination = "",
      headers: HeadersInit | undefined,
      body: Record<string, unknown> | null = null;
    const fetchImpl = (async (url, init) => {
      destination = String(url);
      headers = init?.headers;
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return json({
        model: input.model,
        choices: [{ message: { content: '{"a":"valid"}' }, finish_reason: "stop" }],
        usage: { prompt_tokens: 20, completion_tokens: 5 },
      });
    }) as typeof fetch;
    const model = createOpenAIResearchModel(input, { fetchImpl });
    const answer = await model.complete(request);
    expect(destination).toBe("https://api.openai.com/v1/chat/completions");
    expect(new Headers(headers).get("Authorization")).toBe("Bearer " + input.apiKey);
    expect(body).toMatchObject({ store: false, max_completion_tokens: 512 });
    expect(answer.reportedModel).toBe(input.model);
    expect(JSON.stringify({ configuration: model.configuration, answer })).not.toContain(
      input.apiKey,
    );
  });
  it("does not act on provider refusals and never follows redirects", async () => {
    const refusal = server(() =>
      json({ choices: [{ message: { refusal: "declined" }, finish_reason: "stop" }] }),
    );
    await expect(
      createOpenAIResearchModel(input, refusal).complete(request),
    ).rejects.toMatchObject({ code: "malformed" });
    const moved = server(
      () =>
        new Response(null, {
          status: 302,
          headers: { Location: "https://other.invalid" },
        }),
    );
    await expect(
      createOpenAIResearchModel(input, moved).complete(request),
    ).rejects.toMatchObject({ code: "http" });
    expect(moved.seen).toHaveLength(1);
  });
});

describe("provider selection", () => {
  it("defaults to Ollama on loopback and names no model", () => {
    const c = autonomyConfig({});
    if (!c.ok) throw new Error(c.reason);
    expect(c.config).toMatchObject({
      enabled: false,
      provider: "ollama",
      model: null,
      baseUrl: "http://127.0.0.1:11434",
      ceilings: {
        iterations: 10,
        experiments: 10,
        runtime_ms: 1_800_000,
        failed_proposals: 3,
        model_calls: 60,
        model_tokens: null,
      },
      dir: ".rain-research",
      operator: "R.A.I.N.Operator",
    });
  });
  it("selects LM Studio and its endpoint, with the model as the server lists it", () => {
    const c = autonomyConfig({
      RAIN_MODEL_PROVIDER: "lmstudio",
      RAIN_MODEL: "qwen2.5-7b-instruct",
      RAIN_LMSTUDIO_URL: "http://127.0.0.1:1234/v1/",
      RAIN_AUTONOMY_ENABLED: "true",
      RAIN_MAX_ITERATIONS: "5",
      RAIN_MAX_MODEL_TOKENS: "200000",
    });
    if (!c.ok) throw new Error(c.reason);
    expect(c.config).toMatchObject({
      enabled: true,
      provider: "lmstudio",
      model: "qwen2.5-7b-instruct",
      baseUrl: "http://127.0.0.1:1234",
    });
    expect(c.config.ceilings).toMatchObject({ iterations: 5, model_tokens: 200000 });
    expect(createLocalModel(settings("lmstudio")).provider).toBe("lmstudio");
    expect(createLocalModel(settings("ollama")).provider).toBe("ollama");
  });
  it("refuses a malformed setting by name, never by value", () => {
    for (const [env, name] of [
      [{ RAIN_MODEL_PROVIDER: "openai" }, "RAIN_MODEL_PROVIDER"],
      [{ RAIN_MODEL: "https://example.com/model" }, "RAIN_MODEL"],
      [{ RAIN_MODEL: "gpt-oss:120b-cloud:cloud" }, "RAIN_MODEL"],
      [{ RAIN_OLLAMA_URL: "ftp://127.0.0.1" }, "RAIN_OLLAMA_URL"],
      [{ RAIN_OLLAMA_URL: "http://user:secret@127.0.0.1:11434" }, "RAIN_OLLAMA_URL"],
      [{ RAIN_MAX_ITERATIONS: "1000" }, "RAIN_MAX_ITERATIONS"],
      [{ RAIN_MAX_RUNTIME_MS: "5" }, "RAIN_MAX_RUNTIME_MS"],
      [{ RAIN_AUTONOMY_ENABLED: "yes" }, "RAIN_AUTONOMY_ENABLED"],
      [{ RAIN_AUTONOMY_OPERATOR: "Jane Doe" }, "RAIN_AUTONOMY_OPERATOR"],
      [{ RAIN_MODEL_TEMPERATURE: "9" }, "RAIN_MODEL_TEMPERATURE"],
    ] as const) {
      const c = autonomyConfig(env);
      expect(c.ok, name).toBe(false);
      if (!c.ok) {
        expect(c.reason).toContain(name);
        expect(c.reason).not.toContain("secret");
      }
    }
  });
  it("normalizes an endpoint without guessing", () => {
    expect(normalizeBaseUrl("http://localhost:11434/", "X")).toBe(
      "http://localhost:11434",
    );
    expect(normalizeBaseUrl("http://10.0.0.5:1234/v1", "X")).toBe("http://10.0.0.5:1234");
    expect(() => normalizeBaseUrl("not a url", "X")).toThrow(/X must be/);
  });
});

describe("the Ollama adapter", () => {
  it("asks /api/chat for schema-constrained JSON and reports the counts Ollama gives", async () => {
    const { seen, fetchImpl } = server(() =>
      json({
        model: "qwen2.5:7b",
        message: { role: "assistant", content: '{"a":"b"}' },
        done: true,
        done_reason: "stop",
        prompt_eval_count: 120,
        eval_count: 7,
      }),
    );
    const model = createLocalModel(settings("ollama"), { fetchImpl });
    const answer = await model.complete(request);
    expect(seen[0]).toMatchObject({
      url: "http://127.0.0.1:11434/api/chat",
      method: "POST",
    });
    expect(seen[0]!.body).toMatchObject({
      model: "qwen2.5:7b",
      stream: false,
      format: request.schema,
      options: { temperature: 0.2, num_predict: 512, num_ctx: 8192 },
      messages: [
        { role: "system", content: "system words" },
        { role: "user", content: "user words" },
      ],
    });
    expect(answer).toMatchObject({
      text: '{"a":"b"}',
      reportedModel: "qwen2.5:7b",
      promptTokens: 120,
      completionTokens: 7,
      finishReason: "stop",
    });
  });
  it("lists models from /api/tags, and knows an untagged name is :latest", async () => {
    const { fetchImpl } = server(() =>
      json({ models: [{ name: "llama3.2:latest" }, { name: "qwen2.5:7b" }] }),
    );
    const model = createLocalModel(settings("ollama", { model: "llama3.2" }), {
      fetchImpl,
    });
    const listed = await model.listModels();
    expect(listed).toEqual(["llama3.2:latest", "qwen2.5:7b"]);
    expect(listsModel(listed, model)).toBe(true);
    expect(listsModel(["qwen2.5:7b"], model)).toBe(false);
  });
  it("reports no token count when Ollama gives none", async () => {
    const { fetchImpl } = server(() => json({ message: { content: "{}" } }));
    const answer = await createLocalModel(settings("ollama"), { fetchImpl }).complete(
      request,
    );
    expect([answer.promptTokens, answer.completionTokens, answer.reportedModel]).toEqual([
      null,
      null,
      null,
    ]);
  });
});

describe("the LM Studio adapter", () => {
  it("asks /v1/chat/completions with a strict json_schema response format", async () => {
    const { seen, fetchImpl } = server(() =>
      json({
        model: "qwen2.5-7b-instruct",
        choices: [{ message: { content: '{"a":"b"}' }, finish_reason: "stop" }],
        usage: { prompt_tokens: 90, completion_tokens: 5 },
      }),
    );
    const model = createLocalModel(settings("lmstudio"), { fetchImpl });
    const answer = await model.complete(request);
    expect(seen[0]).toMatchObject({
      url: "http://127.0.0.1:1234/v1/chat/completions",
      method: "POST",
    });
    expect(seen[0]!.body).toMatchObject({
      model: "qwen2.5-7b-instruct",
      stream: false,
      temperature: 0.2,
      max_tokens: 512,
      response_format: {
        type: "json_schema",
        json_schema: { name: "rain_test", strict: true, schema: request.schema },
      },
    });
    expect(answer).toMatchObject({
      text: '{"a":"b"}',
      promptTokens: 90,
      completionTokens: 5,
    });
  });
  it("lists models from /v1/models, exactly", async () => {
    const { fetchImpl } = server(() => json({ data: [{ id: "qwen2.5-7b-instruct" }] }));
    const model = createLocalModel(settings("lmstudio"), { fetchImpl });
    expect(listsModel(await model.listModels(), model)).toBe(true);
    expect(listsModel(["qwen2.5-7b-instruct:latest"], model)).toBe(false);
  });
});

describe("an unavailable or misbehaving model fails typed, and nothing is repaired", () => {
  const failure = async (provider: ProviderKind, reply: Parameters<typeof server>[0]) => {
    const { fetchImpl } = server(reply);
    try {
      await createLocalModel(settings(provider, { timeoutMs: 2000 }), {
        fetchImpl,
      }).complete(request);
    } catch (error) {
      return error;
    }
    return null;
  };
  for (const provider of ["ollama", "lmstudio"] as const) {
    it(`${provider}: nothing listening is unavailable`, async () => {
      const e = await failure(provider, () => new TypeError("fetch failed"));
      expect(e).toBeInstanceOf(ModelFailure);
      expect((e as ModelFailure).code).toBe("unavailable");
    });
    it(`${provider}: an HTTP error is http, a non-JSON body or a missing message is malformed`, async () => {
      expect(
        ((await failure(provider, () => json({ error: "no" }, 404))) as ModelFailure)
          .code,
      ).toBe("http");
      expect(
        ((await failure(provider, () => new Response("<html>"))) as ModelFailure).code,
      ).toBe("malformed");
      expect(
        ((await failure(provider, () => json({ choices: [] }))) as ModelFailure).code,
      ).toBe("malformed");
      expect(
        (
          (await failure(
            provider,
            () => new Response("x".repeat(MAX_RESPONSE + 1)),
          )) as ModelFailure
        ).code,
      ).toBe("malformed");
    });
  }
  it("tries a failed connection once more — an idle keep-alive socket the server closed — and no more", async () => {
    let calls = 0;
    const { fetchImpl } = server(() =>
      ++calls === 1
        ? new TypeError("other side closed")
        : json({ message: { content: '{"a":"b"}' } }),
    );
    const answer = await createLocalModel(settings("ollama"), { fetchImpl }).complete(
      request,
    );
    expect([calls, answer.text]).toEqual([2, '{"a":"b"}']);
    let refused = 0;
    const down = server(() => {
      refused += 1;
      return new TypeError("connect ECONNREFUSED");
    });
    await expect(
      createLocalModel(settings("lmstudio"), { fetchImpl: down.fetchImpl }).complete(
        request,
      ),
    ).rejects.toMatchObject({ code: "unavailable" });
    expect(refused).toBe(2);
    // An answer that arrived is never asked for again, whatever it says.
    let http = 0;
    const failing = server(() => {
      http += 1;
      return json({ error: "busy" }, 503);
    });
    await expect(
      createLocalModel(settings("ollama"), { fetchImpl: failing.fetchImpl }).complete(
        request,
      ),
    ).rejects.toMatchObject({ code: "http" });
    expect(http).toBe(1);
  });
  it("a server that never answers times out", async () => {
    const fetchImpl = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) =>
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))),
      )) as typeof fetch;
    const model = createLocalModel(settings("ollama", { timeoutMs: 20 }), { fetchImpl });
    await expect(model.complete(request)).rejects.toMatchObject({ code: "timeout" });
  });
  it("an aborted call is cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const { fetchImpl } = server(() => json({}));
    await expect(
      createLocalModel(settings("ollama"), { fetchImpl }).complete(request, {
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: "cancelled" });
  });
});

describe("the default transport, over a real connection", () => {
  const open: (() => Promise<void>)[] = [];
  afterEach(async () => {
    await Promise.all(open.splice(0).map((close) => close()));
  });
  /** A real local server; counts requests and keeps each one's body. */
  async function listen(
    handle: (req: IncomingMessage, res: ServerResponse, body: string) => void,
  ) {
    const bodies: string[] = [];
    const srv = createServer((req, res) => {
      let body = "";
      req.setEncoding("utf8");
      req.on("data", (chunk: string) => (body += chunk));
      req.on("end", () => {
        bodies.push(body);
        handle(req, res, body);
      });
    });
    await new Promise<void>((resolve) => srv.listen(0, "127.0.0.1", resolve));
    const close = () => {
      srv.closeAllConnections();
      return new Promise<void>((resolve) => srv.close(() => resolve()));
    };
    open.push(close);
    return {
      baseUrl: `http://127.0.0.1:${(srv.address() as AddressInfo).port}`,
      bodies,
      close,
    };
  }
  const completion = (res: ServerResponse) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        model: "qwen2.5-7b-instruct",
        choices: [{ message: { content: '{"a":"b"}' }, finish_reason: "stop" }],
        usage: { prompt_tokens: 90, completion_tokens: 5 },
      }),
    );
  };

  it("waits for headers a slow model holds back, and sends the request whole", async () => {
    let contentType: string | undefined;
    const s = await listen((req, res) => {
      contentType = req.headers["content-type"];
      setTimeout(() => completion(res), 300);
    });
    const answer = await createLocalModel(
      settings("lmstudio", { baseUrl: s.baseUrl, timeoutMs: 5000 }),
    ).complete(request);
    expect(answer).toMatchObject({ text: '{"a":"b"}', promptTokens: 90 });
    expect(contentType).toBe("application/json");
    expect(JSON.parse(s.bodies[0]!)).toMatchObject({ model: "qwen2.5-7b-instruct" });
  });
  it("ends on the deadline and not before, and never asks again", async () => {
    const s = await listen(() => undefined);
    const started = performance.now();
    await expect(
      createLocalModel(
        settings("lmstudio", { baseUrl: s.baseUrl, timeoutMs: 1000 }),
      ).complete(request),
    ).rejects.toMatchObject({ code: "timeout", message: "no answer within 1 s" });
    expect(performance.now() - started).toBeGreaterThanOrEqual(990);
    expect(s.bodies).toHaveLength(1);
  });
  it("a deadline that falls while the answer is arriving is a timeout", async () => {
    const s = await listen((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.write('{"choices":[');
    });
    await expect(
      createLocalModel(
        settings("ollama", { baseUrl: s.baseUrl, timeoutMs: 500 }),
      ).complete(request),
    ).rejects.toMatchObject({ code: "timeout" });
  });
  it("nothing listening is unavailable", async () => {
    const s = await listen(() => undefined);
    await s.close();
    await expect(
      createLocalModel(settings("ollama", { baseUrl: s.baseUrl })).listModels(),
    ).rejects.toMatchObject({ code: "unavailable" });
  });
  it("follows no redirect, and an empty answer is malformed rather than a crash", async () => {
    const moved = await listen((_req, res) => {
      res.writeHead(302, { Location: "http://127.0.0.1:9/elsewhere" });
      res.end();
    });
    await expect(
      createLocalModel(settings("lmstudio", { baseUrl: moved.baseUrl })).complete(
        request,
      ),
    ).rejects.toMatchObject({ code: "http" });
    expect(moved.bodies).toHaveLength(1);
    const empty = await listen((_req, res) => {
      res.writeHead(204);
      res.end();
    });
    await expect(
      createLocalModel(settings("lmstudio", { baseUrl: empty.baseUrl })).complete(
        request,
      ),
    ).rejects.toMatchObject({ code: "malformed" });
  });
  it("a call cancelled in flight is cancelled", async () => {
    const s = await listen(() => undefined);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);
    await expect(
      createLocalModel(settings("ollama", { baseUrl: s.baseUrl })).complete(request, {
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: "cancelled" });
  });
});

describe("structured answers", () => {
  it("takes one JSON object, unwrapping a single fence and nothing else", () => {
    expect(parseStructured('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
    expect(parseStructured('```json\n{"a":1}\n```')).toEqual({
      ok: true,
      value: { a: 1 },
    });
    for (const bad of ["", "[1]", "null", 'Sure! {"a":1}', '{"a":1} {"b":2}', "{'a':1}"])
      expect(parseStructured(bad).ok, bad).toBe(false);
  });
});
