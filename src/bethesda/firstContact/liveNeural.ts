/**
 * A strict, explicitly incomplete sensory proxy built ONLY from the originals'
 * public observation contracts. Neither observation contains the full retinal,
 * olfactory, gustatory or mechanosensory input to a BANC model.
 *
 * Zeros in the input are counterfactual assumptions for a controlled model
 * probe, NOT measurements of absent sensory stimulation.
 */
import type { Observation as EvaObservation } from "../../garden/core/observation.js";
import type { LifeObservation as EchoObservation } from "../life/observation.js";

export interface NeuralProxy {
  /** Compatible with fly_neural.sensory.observation, not a measured sensory frame. */
  input: {
    looming: null;
    airflow: number;
    airflowFrom: null;
    odour: 0;
    onFood: false;
    smallObject: null;
  };
  coverage: {
    airflow: "environmental-proxy" | "unknown";
    airflowSource: string | null;
    looming: "unknown-zero-filled";
    smallObject: "unknown-zero-filled";
    odour: "unknown-zero-filled";
    onFood: "unknown-false-filled";
  };
  interpretation: "counterfactual-environmental-stimulus-only";
  comparableToActualBehavior: false;
}

const PROXY_NOTE = {
  looming: "unknown-zero-filled",
  smallObject: "unknown-zero-filled",
  odour: "unknown-zero-filled",
  onFood: "unknown-false-filled",
} as const;

function proxy(speed: number | null, source: string | null): NeuralProxy {
  const available = speed !== null && Number.isFinite(speed) && speed >= 0;
  return {
    input: {
      looming: null,
      airflow: available ? speed! : 0,
      airflowFrom: null,
      odour: 0,
      onFood: false,
      smallObject: null,
    },
    coverage: {
      airflow: available ? "environmental-proxy" : "unknown",
      airflowSource: available ? source : null,
      ...PROXY_NOTE,
    },
    interpretation: "counterfactual-environmental-stimulus-only",
    comparableToActualBehavior: false,
  };
}

/** Ten-metre weather wind, NOT the airspeed across Eva's antennae. */
export function evaNeuralProxy(o: EvaObservation): NeuralProxy {
  const wind = o.weather.windKmh;
  return proxy(
    wind === null ? null : wind / 3.6,
    "garden weather: wind at 10 m, not antenna airflow",
  );
}

/** Wind at ECHO's body, NOT necessarily relative antenna airflow during motion. */
export function echoNeuralProxy(o: EchoObservation): NeuralProxy {
  return proxy(
    o.weather?.atFlyMS ?? null,
    "Bethesda environment: wind speed at fly height, not measured antenna airflow",
  );
}
