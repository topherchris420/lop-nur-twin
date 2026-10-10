/** Exercise the actual LM Studio HTTP adapter and operator service, with a labeled local test server. */
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createDiscoveryService } from "../../src/rain/autonomy/discoveryService.js";
import { DiscoveryFixtureModel } from "../../src/rain/autonomy/discoveryFixtures.js";
import type { StructuredRequest } from "../../src/rain/autonomy/models.js";
import { ResearchStore } from "../../src/rain/autonomy/store.js";

it("discovers the served Qwen identifier, runs via the real local HTTP adapter and never resumes on reload", async () => {
  const root = mkdtempSync(join(tmpdir(), "rain-discovery-http-"));
  const fixture = new DiscoveryFixtureModel();
  const id = "qwen-scripted-service-test-double";
  const server = createServer((req, res) => {
    void (async () => {
      res.setHeader("Content-Type", "application/json");
      if (req.url === "/v1/models") {
        res.end(JSON.stringify({ data: [{ id }] }));
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString()) as {
        messages: { role: string; content: string }[];
        response_format: {
          json_schema: { name: string; schema: Record<string, unknown> };
        };
      };
      const request: StructuredRequest = {
        system: body.messages.find((m) => m.role === "system")!.content,
        user: body.messages.find((m) => m.role === "user")!.content,
        schemaName: body.response_format.json_schema.name,
        schema: body.response_format.json_schema.schema,
      };
      const answer = await fixture.complete(request);
      res.end(
        JSON.stringify({
          model: id,
          choices: [
            {
              message: { role: "assistant", content: answer.text },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 100 },
        }),
      );
    })().catch((error) => {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: String(error) }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no port");
    const env = {
      RAIN_AUTONOMY_DIR: root,
      RAIN_AUTONOMY_ENABLED: "true",
      RAIN_MAX_ITERATIONS: "2",
      RAIN_MAX_EXPERIMENTS: "2",
      RAIN_LMSTUDIO_URL: `http://127.0.0.1:${address.port}`,
    };
    const service = createDiscoveryService(env, process.cwd());
    expect(service.status().active).toBe(false);
    const view = await service.prepare();
    expect(view.model).toBe(id);
    expect(() => service.authorize("00000000", true)).toThrow();
    await expect(service.start()).rejects.toThrow("authorization");
    service.authorize(view.charter_sha256!.slice(0, 8), true);
    await service.start();
    await expect(service.start()).rejects.toThrow("already active");
    const finished = await service.completion();
    expect(finished?.ok).toBe(true);
    expect(finished?.executed).toBe(2);
    const store = new ResearchStore(root);
    expect(
      store.records().every((r) => r.record?.provenance.lop_nur_twin_commit !== null),
    ).toBe(true);
    expect(
      store
        .records()
        .every((r) => r.record?.provenance.lop_nur_twin_source === "runtime-identity"),
    ).toBe(true);
    const reloaded = createDiscoveryService(env, process.cwd());
    expect(reloaded.status().active).toBe(false);
    expect(reloaded.status().history).toHaveLength(2);
    expect(reloaded.completion()).toBeNull();
    expect(reloaded.status().charter).toBeNull();
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    rmSync(root, { recursive: true, force: true });
  }
}, 120000);
