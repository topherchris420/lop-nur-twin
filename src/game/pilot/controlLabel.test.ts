import { describe, expect, it } from "vitest";
import { BRAIN_KINDS, type BrainKind } from "../core/gameStore";
import { controlLabel, labelText, type SeatState } from "./controlLabel";

const seat = (brain: BrainKind, state: Partial<SeatState> = {}): SeatState => ({
  brain,
  accepted: 0,
  fallback: false,
  failing: false,
  ...state,
});

const live = { accepted: 12, fallback: false, failing: false };

describe("the control label", () => {
  it("says LIVE only after a validated answer, with nothing failing since", () => {
    expect(controlLabel(seat("jev", live))).toBe("LIVE JEV");
    expect(controlLabel(seat("glide", live))).toBe("LIVE GLIDE");
    expect(controlLabel(seat("llm", live))).toBe("LIVE LLM");
  });

  it("is not LIVE while connecting: nothing has been answered yet", () => {
    expect(controlLabel(seat("jev"))).toBe("JEV");
    expect(labelText(controlLabel(seat("jev")), "CONNECTING")).toBe("JEV CONNECTING");
    expect(labelText(controlLabel(seat("llm")), "DECIDING")).toBe("LLM DECIDING");
  });

  it("is not LIVE while the service times out, is unavailable or errors", () => {
    const failing = { ...live, failing: true };
    expect(controlLabel(seat("jev", failing))).toBe("JEV");
    expect(labelText(controlLabel(seat("jev", failing)), "TIMEOUT")).toBe("JEV TIMEOUT");
    expect(labelText(controlLabel(seat("glide", failing)), "UNAVAILABLE")).toBe(
      "GLIDE UNAVAILABLE",
    );
    expect(labelText(controlLabel(seat("llm", failing)), "ERROR")).toBe("LLM ERROR");
    // A death does not hide the failure: the label stays off LIVE.
    expect(labelText(controlLabel(seat("jev", failing)), "DEAD")).toBe("JEV DEAD");
  });

  it("says FALLBACK whenever the fallback chose the controls in effect", () => {
    expect(controlLabel(seat("jev", { ...live, fallback: true }))).toBe("FALLBACK");
    expect(
      controlLabel(seat("glide", { accepted: 3, fallback: true, failing: true })),
    ).toBe("FALLBACK");
  });

  it("never names one provider's answer as another's, nor a local seat as live", () => {
    const labels = BRAIN_KINDS.flatMap((brain) =>
      [0, 5].flatMap((accepted) =>
        [false, true].flatMap((fallback) =>
          [false, true].map((failing) => ({
            brain,
            label: controlLabel({ brain, accepted, fallback, failing }),
          })),
        ),
      ),
    );
    for (const { brain, label } of labels) {
      if (label === "LIVE JEV") expect(brain).toBe("jev");
      if (label === "LIVE GLIDE") expect(brain).toBe("glide");
      if (label === "LIVE LLM") expect(brain).toBe("llm");
    }
    expect(controlLabel(seat("human", live))).toBe("HUMAN");
    expect(controlLabel(seat("random", live))).toBe("RANDOM");
    expect(controlLabel(seat("script", live))).toBe("SCRIPTED");
    expect(controlLabel(seat("replay", live))).toBe("REPLAY");
  });

  it("prints a live or local label as it is, with the status beside it", () => {
    expect(labelText("LIVE JEV", "EXECUTING")).toBe("LIVE JEV");
    expect(labelText("FALLBACK", "TIMEOUT")).toBe("FALLBACK");
    expect(labelText("RANDOM", "DEAD")).toBe("RANDOM");
    expect(labelText("JEV", "MATCH_COMPLETE")).toBe("JEV MATCH COMPLETE");
  });
});
