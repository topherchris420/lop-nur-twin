import { describe, it, expect, vi } from "vitest";
import { createJevDecisionHandler } from "./handler";
import { CITY_SCHEMA, type Observation } from "../../src/bethesda/contract";
const o: Observation = {
  schema: CITY_SCHEMA,
  sequence: 1,
  tick: 0,
  agentId: 0,
  kind: "pedestrian",
  role: "walker",
  persona: "shopper",
  hazard: "fire",
  hazardDistance: 80,
  insidePerimeter: false,
  attraction: "fire",
  attractionDistance: 80,
  sheltering: false,
  trafficNearby: false,
  emergencyApproaching: false,
  crossing: false,
  safeToCross: true,
  signalDark: false,
  blocked: false,
  routeClosed: false,
  atPortal: false,
  atGathering: false,
  atBusStop: false,
  busBoarding: false,
  atMetro: false,
  metroOpen: true,
  assigned: false,
  crowd: 1,
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
  it("routes an outdated city schema to the city handler and rejects it there", async () => {
    const handle = createJevDecisionHandler({
      apiKey: "offline-test",
      fetchImpl: vi.fn(),
    });
    const response = await handle(request({ ...o, schema: "bethesda-observation/v1" }), {
      clientKey: "test",
    });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("invalid city observation");
  });
  it("asks about the agent's situation with closed fields only", async () => {
    let question: Record<string, unknown> = {};
    const handle = createJevDecisionHandler({
      apiKey: "offline-test",
      fetchImpl: async (_url, init) => {
        question = JSON.parse(String(init?.body));
        return new Response("{}", { status: 500 });
      },
    });
    await handle(request(), { clientKey: "test" });
    const state = question.state as Record<string, unknown>;
    expect(state.role).toBe("walker");
    expect(state.people_stopped_nearby).toBe("a few");
    expect(Object.keys(state)).not.toContain("agentId");
    expect(JSON.stringify(question)).not.toMatch(/x"|z"|coordinates|latitude/);
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
