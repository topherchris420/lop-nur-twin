import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  closeLayer,
  forgetLayers,
  layersOf,
  onLayersChange,
  pushLayer,
} from "./historyLayers";

/** A same-document history: entries, a cursor, and popstate on Back. */
class FakeHistory {
  entries: unknown[] = [{ __TSR_index: 0, key: "k" }];
  index = 0;
  constructor(private readonly target: EventTarget) {}
  get state() {
    return this.entries[this.index];
  }
  pushState(state: unknown) {
    this.entries.splice(this.index + 1);
    this.entries.push(structuredClone(state));
    this.index++;
  }
  replaceState(state: unknown) {
    this.entries[this.index] = structuredClone(state);
  }
  back() {
    if (this.index === 0) return;
    this.index--;
    this.target.dispatchEvent(
      Object.assign(new Event("popstate"), { state: this.state }),
    );
  }
}

let history: FakeHistory;
beforeEach(() => {
  const target = new EventTarget();
  history = new FakeHistory(target);
  Object.assign(globalThis, {
    window: {
      history,
      addEventListener: target.addEventListener.bind(target),
      removeEventListener: target.removeEventListener.bind(target),
    },
  });
});
afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe("history layers", () => {
  it("reads only a list of names", () => {
    expect(layersOf(null)).toEqual([]);
    expect(layersOf({ lopNurLayers: "anomaly" })).toEqual([]);
    expect(layersOf({ lopNurLayers: ["anomaly", 3, "rain-lab"] })).toEqual([
      "anomaly",
      "rain-lab",
    ]);
  });

  it("stacks layers on new entries and keeps the router's index counting", () => {
    pushLayer("anomaly");
    pushLayer("rain-lab");
    expect(history.entries).toHaveLength(3);
    expect(layersOf(history.state)).toEqual(["anomaly", "rain-lab"]);
    expect(history.state).toMatchObject({ __TSR_index: 2, key: "k" });
  });

  it("closes a layer through Back only when the entry is its own", () => {
    const seen: string[][] = [];
    const stop = onLayersChange((layers) => seen.push(layers));
    expect(closeLayer("anomaly")).toBe(false);
    pushLayer("anomaly");
    pushLayer("rain-lab");
    expect(closeLayer("anomaly")).toBe(false);
    expect(closeLayer("rain-lab")).toBe(true);
    expect(seen).toEqual([["anomaly"]]);
    stop();
    expect(closeLayer("anomaly")).toBe(true);
    expect(seen).toHaveLength(1);
  });

  it("rewrites an entry that names a layer no longer open", () => {
    pushLayer("anomaly");
    pushLayer("rain-lab");
    forgetLayers((name) => name !== "rain-lab");
    expect(layersOf(history.state)).toEqual(["anomaly"]);
    expect(history.entries).toHaveLength(3);
    const before = history.state;
    forgetLayers(() => true);
    expect(history.state).toBe(before);
  });
});
