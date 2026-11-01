import { describe, expect, it } from "vitest";
import type { Observation as EvaObservation } from "../../garden/core/observation.js";
import type { LifeObservation as EchoObservation } from "../life/observation.js";
import { echoNeuralProxy, evaNeuralProxy } from "./liveNeural.js";

describe("read-only proxies of the original lives", () => {
  it("labels ten-metre garden wind as an environmental proxy, never measured antenna airflow", () => {
    const eva = {
      activity: "feeding",
      weather: { windKmh: 18 },
    } as EvaObservation;
    const p = evaNeuralProxy(eva);
    expect(p.input.airflow).toBe(5);
    expect(p.coverage.airflow).toBe("environmental-proxy");
    expect(p.coverage.airflowSource).toContain("10 m");
    expect(p.input.onFood).toBe(false);
    expect(p.coverage.onFood).toBe("unknown-false-filled");
    expect(p.comparableToActualBehavior).toBe(false);
  });

  it("uses ECHO's environmental wind at fly height, not controller behavior as a sensation", () => {
    const echo = {
      fly: { mode: "escape" },
      weather: { atFlyMS: 1.75 },
    } as EchoObservation;
    const p = echoNeuralProxy(echo);
    expect(p.input.airflow).toBe(1.75);
    expect(p.input.looming).toBeNull();
    expect(p.coverage.looming).toBe("unknown-zero-filled");
    expect(p.comparableToActualBehavior).toBe(false);
  });

  it("marks unobserved wind unknown instead of claiming a calm day", () => {
    const eva = {
      weather: { windKmh: null },
    } as EvaObservation;
    const echo = {
      weather: undefined,
    } as EchoObservation;
    for (const p of [evaNeuralProxy(eva), echoNeuralProxy(echo)]) {
      expect(p.coverage.airflow).toBe("unknown");
      expect(p.coverage.airflowSource).toBeNull();
      expect(p.input.airflow).toBe(0);
      expect(p.input.odour).toBe(0);
      expect(p.coverage.odour).toBe("unknown-zero-filled");
      expect(p.input.smallObject).toBeNull();
    }
  });
});
