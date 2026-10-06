/**
 * Explicit routing configuration; defaults construct no provider.
 *
 * A port of R.A.I.N.'s `judgment/config.py` (james_library, MIT), reduced to
 * the modes the runtime can serve: `off` (the default — R.A.I.N. proposes
 * nothing and says DISABLED) and `jev` (TypeSafe's Jev, consulted only when
 * `RAIN_DECISION_REMOTE_ALLOWED=true` lets a question leave the machine).
 * `laya` and `cascade` named a local checkpoint run through a Python worker
 * that was not consolidated; they are refused rather than silently mapped to
 * something else.
 *
 * Shared with the server: imports siblings only. The environment, the
 * calibration file's text and the decision engine's credential are passed in;
 * nothing here reads a file or the process environment.
 */
import { parseProfiles, type CalibrationProfile } from "./calibration.js";
import { DecisionRouter, type DecisionMode } from "./routing.js";
import { TypeSafeJudgmentProvider } from "./typesafe.js";

export type Env = Readonly<Record<string, string | undefined>>;

/** `true` or `false`, exactly; unset is false; anything else is an error. */
export function enabled(env: Env, name: string): boolean {
  const value = (env[name] ?? "false").trim().toLowerCase();
  if (value !== "true" && value !== "false")
    throw new Error(`${name} must be true or false`);
  return value === "true";
}

export interface DecisionConfig {
  mode: DecisionMode;
  remoteAllowed: boolean;
  router: DecisionRouter;
}

/**
 * The router the runtime's environment describes. `calibrationText` is the
 * contents of `RAIN_DECISION_CALIBRATION` when that names a file; the caller
 * reads it so this module never touches the filesystem.
 */
export interface DecisionRouterOptions {
  /**
   * The decision engine's credential, passed by value from the server's entry
   * point so that no secret's name appears in this module. Absent, Jev is not
   * configured and a `jev` router answers `provider_not_configured`.
   */
  decisionApiKey?: string;
  /** The TypeSafe model to ask; default `jev-latest`. */
  decisionModel?: string;
  calibrationText?: string | null;
  fetchImpl?: typeof fetch;
}

export function createDecisionRouter(
  env: Env,
  options: DecisionRouterOptions = {},
): DecisionConfig {
  const mode = (env.RAIN_DECISION_MODE ?? "off").trim().toLowerCase();
  const remoteAllowed = enabled(env, "RAIN_DECISION_REMOTE_ALLOWED");
  if (mode === "off") return { mode, remoteAllowed, router: new DecisionRouter({ env }) };
  if (mode === "laya" || mode === "cascade")
    throw new Error(
      `RAIN_DECISION_MODE=${mode} needs R.A.I.N.'s Laya worker, which this runtime does not carry; use off or jev`,
    );
  if (mode !== "jev") throw new Error("unsupported decision mode");
  const timeout = Number(env.RAIN_DECISION_TIMEOUT ?? "30");
  const minimum = Number(env.RAIN_DECISION_MINIMUM_SAMPLES ?? "100");
  if (!Number.isFinite(timeout))
    throw new Error("RAIN_DECISION_TIMEOUT must be a number of seconds");
  if (!Number.isInteger(minimum))
    throw new Error("RAIN_DECISION_MINIMUM_SAMPLES must be an integer");
  const profiles: readonly CalibrationProfile[] =
    options.calibrationText != null ? parseProfiles(options.calibrationText) : [];
  const jev = new TypeSafeJudgmentProvider({
    apiKey: options.decisionApiKey,
    model: options.decisionModel?.trim() || "jev-latest",
    fetchImpl: options.fetchImpl,
    env,
  });
  return {
    mode,
    remoteAllowed,
    router: new DecisionRouter({
      mode,
      jev,
      profiles,
      minimumSamples: minimum,
      timeout,
      compare: enabled(env, "RAIN_DECISION_COMPARE"),
      env,
    }),
  };
}
