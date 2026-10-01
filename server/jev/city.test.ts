import { describe, it, expect, vi } from "vitest";
import { createJevDecisionHandler } from "./handler";
import { CITY_SCHEMA, type Observation } from "../../src/bethesda/contract";
const o: Observation = {
  schema: CITY_SCHEMA,
  sequence: 1,
  tick: 0,
  agentId: 0,
  kind: "pedestrian",
  hazard: "fire",
  hazardDistance: 80,
  trafficNearby: false,
  crossing: false,
  safeToCross: true,
  blocked: false,
  atPortal: false,
  atGathering: false,
  candidates: ["wait", "watch"],
};
function request(observation: unknown = o) {
  return new Request("https://example.test/api/jev/decision", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://example.test" },
    body: JSON.stringify({ session: "a".repeat(32), observation }),
  });
}
describe("city decision endpoint", () => {
  it("returns unavailable without credentials and rejects invented actions", async () => {
    const handle = createJevDecisionHandler({ apiKey: undefined });
    expect((await handle(request(), { clientKey: "test" })).status).toBe(503);
    const configured = createJevDecisionHandler({
      apiKey: "offline-test",
      fetchImpl: vi.fn(),
    });
    expect(
      (
        await configured(request({ ...o, candidates: ["teleport"] }), {
          clientKey: "test",
        })
      ).status,
    ).toBe(400);
  });
  it("constructs a bounded question and validates provider probabilities", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            model: "jev-test",
            answers: {
              action: {
                choice: "watch",
                confidence: 0.8,
                probabilities: { watch: 0.8, wait: 0.2 },
              },
            },
          }),
          { status: 200 },
        ),
    );
    const handle = createJevDecisionHandler({
      apiKey: "offline-test",
      fetchImpl: fetcher,
    });
    const response = await handle(request(), { clientKey: "test" });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.action).toBe("watch");
    expect(result.usage).toBeNull();
    expect(JSON.stringify(result)).not.toContain("offline-test");
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("fails closed for malformed provider answers", async () => {
    const handle = createJevDecisionHandler({
      apiKey: "offline-test",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            model: "jev-test",
            answers: { action: { choice: "teleport" } },
          }),
        ),
    });
    expect((await handle(request(), { clientKey: "test" })).status).toBe(502);
  });
  it("preserves the original endpoint cross-origin and body-size gates", async () => {
    const handle = createJevDecisionHandler({
      apiKey: "offline-test",
      fetchImpl: vi.fn(),
    });
    const r = request();
    r.headers.set("Origin", "https://elsewhere.test");
    expect((await handle(r, { clientKey: "test" })).status).toBe(403);
    const huge = new Request("https://example.test/api/jev/decision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: " ".repeat(9000),
    });
    expect((await handle(huge, { clientKey: "test" })).status).toBe(413);
  });
});
