import { describe, expect, it } from "vitest";
import {
  HOST_CAPABILITIES,
  JEV_CAPABILITIES,
  LOCAL_POLICY_CAPABILITIES,
  negotiate,
  type Capabilities,
} from "./capabilities";
import { DelayedProvider, RandomProvider } from "./providers";
import { makeObservation } from "./testing/fixtures";

describe("capability negotiation", () => {
  it("grants what both sides support, at the contract's default cadence", () => {
    const result = negotiate(JEV_CAPABILITIES, {
      control: "precision",
      navigation: "places",
      intervalMs: null,
    });
    expect(result).toMatchObject({
      control: "precision",
      navigation: "places",
      intervalMs: 200,
      inference: "remote",
      notes: [],
    });
  });

  it("falls back to the first common mode, and says so", () => {
    const stepsOnly: Capabilities = {
      ...LOCAL_POLICY_CAPABILITIES,
      navigation: ["steps"],
    };
    const result = negotiate(stepsOnly, {
      control: "precision",
      navigation: "places",
      intervalMs: null,
    });
    expect(result.navigation).toBe("steps");
    expect(result.notes.join(" ")).toMatch(/navigation places/);
  });

  it("never runs faster than either side's floor", () => {
    const fast = negotiate(LOCAL_POLICY_CAPABILITIES, {
      control: "direct",
      navigation: "steps",
      intervalMs: 20,
    });
    expect(fast.intervalMs).toBe(HOST_CAPABILITIES.minIntervalMs);
    expect(fast.notes.join(" ")).toMatch(/below the floor/);
    const slow = negotiate(LOCAL_POLICY_CAPABILITIES, {
      control: "direct",
      navigation: "steps",
      intervalMs: 500,
    });
    expect(slow.intervalMs).toBe(500);
    // A remote brain's own floor holds even when the host could go faster.
    const jev = negotiate(JEV_CAPABILITIES, {
      control: "direct",
      navigation: "steps",
      intervalMs: 100,
    });
    expect(jev.intervalMs).toBe(JEV_CAPABILITIES.minIntervalMs);
  });

  it("offers no vision: no brain reads frames, and the host sends none", () => {
    expect(HOST_CAPABILITIES.vision).toBe(false);
    expect(JEV_CAPABILITIES.vision).toBe(false);
  });
});

describe("the delayed provider", () => {
  it("answers what the inner brain answered, later", async () => {
    const observation = makeObservation();
    const direct = await new RandomProvider(3).decide({
      sequence: 1,
      observation,
      signal: new AbortController().signal,
    });
    const started = Date.now();
    const delayed = await new DelayedProvider(new RandomProvider(3), 40).decide({
      sequence: 1,
      observation,
      signal: new AbortController().signal,
    });
    expect(Date.now() - started).toBeGreaterThanOrEqual(35);
    expect(delayed).toEqual(direct);
  });

  it("gives up on abort instead of answering", async () => {
    const controller = new AbortController();
    const pending = new DelayedProvider(new RandomProvider(3), 1000).decide({
      sequence: 1,
      observation: makeObservation(),
      signal: controller.signal,
    });
    controller.abort();
    const result = await pending;
    expect(result.ok).toBe(false);
  });
});
