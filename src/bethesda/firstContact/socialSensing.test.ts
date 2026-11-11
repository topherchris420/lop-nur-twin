import { describe, expect, it } from "vitest";
import {
  senseSocialOther,
  SocialFamiliarityMemory,
  type SocialBody,
  type SocialObservation,
  type SurfaceChemistry,
} from "./socialSensing.js";

const A: SurfaceChemistry = [0.8, 0.1, 0.1, 0.2];
const B: SurfaceChemistry = [0.1, 0.8, 0.2, 0.1];

const body = (z: number, profile?: SurfaceChemistry): SocialBody => ({
  center: [0, 0, z],
  yawRad: 0,
  radiusM: 0.0015,
  ...(profile ? { surfaceChemistry: profile } : {}),
});
const receiver = body(0);
const touch = (p: SurfaceChemistry): SocialObservation =>
  senseSocialOther(receiver, body(0.0032, p));

describe("research social sensing", () => {
  it("uses ordinary visual range and orientation, without exposing the partner's ID", () => {
    const near = senseSocialOther(receiver, body(0.02, A));
    expect(near.visual?.angularSizeDeg).toBeGreaterThan(0);
    expect(near.contactChemistry).toBeNull();
    expect(Object.keys(near).sort()).toEqual(["contactChemistry", "visual"]);
    expect(Object.keys(near.visual!)).toEqual(["angularSizeDeg", "bearingRad"]);
    expect(senseSocialOther(receiver, body(0.07, A)).visual).toBeNull();
    expect(senseSocialOther(receiver, body(-0.02, A)).visual).toBeNull();
    expect(senseSocialOther(receiver, body(0.02, A), undefined, true).visual).toBeNull();
  });

  it("provides synthetic cuticular cues only at body contact, not across space", () => {
    expect(touch(A).contactChemistry).toEqual(A);
    expect(senseSocialOther(receiver, body(0.02, A)).contactChemistry).toBeNull();
    const withoutProfile = senseSocialOther(receiver, body(0.003));
    expect(withoutProfile.contactChemistry).toBeNull();
    expect(senseSocialOther(receiver, body(0.0032, A), undefined, true).contactChemistry)
      .toEqual(A);
  });

  it("rejects malformed bodies, sensory bounds, and chemistry", () => {
    expect(() => senseSocialOther(receiver, { ...body(0.003), radiusM: NaN })).toThrow();
    expect(() =>
      senseSocialOther(receiver, { ...body(0.003), surfaceChemistry: [2, 0, 0, 0] }),
    ).toThrow();
    expect(() =>
      senseSocialOther(receiver, body(0.02), { visionRangeM: 2, fieldOfViewRad: 2, contactClearanceM: 0 }),
    ).toThrow();
  });

  it("does not mistake visual detection for individual recognition", () => {
    const memory = new SocialFamiliarityMemory();
    const visualOnly = senseSocialOther(receiver, body(0.02, A));
    for (let t = 0; t <= 50; t += 10)
      expect(memory.observe(visualOnly, t).verdict).toBe("detected-unresolved");
    expect(memory.snapshot().traces).toHaveLength(0);
    expect(memory.observe({ visual: null, contactChemistry: null }, 60))
      .toEqual({ verdict: "unseen", detected: false, encounters: 0 });
  });

  it("counts separated close encounters, not every video frame", () => {
    const memory = new SocialFamiliarityMemory();
    expect(memory.observe(touch(A), 0).verdict).toBe("novel-profile");
    for (let t = 1; t < 10; t++)
      expect(memory.observe(touch(A), t).verdict).toBe("not-yet-familiar");
    expect(memory.snapshot().traces[0]?.encounters).toBe(1);
    expect(memory.observe(touch(A), 10).verdict).toBe("not-yet-familiar");
    expect(memory.snapshot().traces[0]?.encounters).toBe(2);
    expect(memory.observe(touch(A), 20).verdict).toBe("familiar-profile");
  });

  it("distinguishes novel chemical profiles without privileged identities", () => {
    const memory = new SocialFamiliarityMemory();
    memory.observe(touch(A), 0);
    memory.observe(touch(A), 10);
    expect(memory.observe(touch(A), 20).verdict).toBe("familiar-profile");
    expect(memory.observe(touch(B), 21).verdict).toBe("novel-profile");
    expect(memory.snapshot().traces).toHaveLength(2);
    // Two different animals with the same measured chemistry are
    // indistinguishable in this model, so this is NOT proof of recognition.
    expect(memory.observe(touch(A), 30).verdict).toBe("familiar-profile");
  });

  it("serializes research memory without storing IDs or changing prior evidence", () => {
    const memory = new SocialFamiliarityMemory();
    memory.observe(touch(A), 0);
    memory.observe(touch(A), 11);
    const state = memory.snapshot();
    const copy = SocialFamiliarityMemory.restore(state);
    expect(copy.snapshot()).toEqual(state);
    expect(copy.observe(touch(A), 21).verdict).toBe("familiar-profile");
    expect(memory.snapshot()).toEqual(state);
    expect(JSON.stringify(state)).not.toMatch(/life_id|partner_id|Eva|ECHO/);
    expect(() =>
      SocialFamiliarityMemory.restore({
        ...state,
        traces: [{ ...state.traces[0]!, lastSeenAt: 1_000_000 }],
      }),
    ).toThrow();
  });

  it("forgets unused traces and refuses backwards time", () => {
    const memory = new SocialFamiliarityMemory({
      matchRadius: 0.15,
      minEncounterGapS: 1,
      forgetAfterS: 5,
      capacity: 1,
    });
    memory.observe(touch(A), 0);
    memory.observe(touch(A), 1);
    expect(memory.observe(touch(A), 2).verdict).toBe("familiar-profile");
    expect(memory.observe(touch(B), 3).verdict).toBe("novel-profile");
    expect(memory.snapshot().traces).toHaveLength(1);
    expect(memory.observe(touch(B), 4).verdict).toBe("not-yet-familiar");
    expect(memory.observe(touch(A), 10).verdict).toBe("novel-profile");
    expect(() => memory.observe(touch(A), 9)).toThrow(/backwards/);
  });
});
