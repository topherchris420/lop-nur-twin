/** Closed, bounded imports. A checksum alone cannot make malformed state valid. */
import { schemaErrors, type Schema } from "../../../rain/experiments/jsonSchema.js";
import { MODES } from "../neural.js";
const number = (minimum = -1e9, maximum = 1e9): Schema => ({
  type: "number",
  minimum,
  maximum,
});
const count = { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const closed = (properties: Record<string, Schema>): Schema => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const nullable = (s: Schema): Schema => ({ oneOf: [s, { type: "null" }] });
const vector = { type: "array", minItems: 3, maxItems: 3, items: number() };
const mode = { type: "string", enum: [...MODES] };
const observation = closed({
  tick: count,
  t: number(0, 1e12),
  dt: number(0, 1),
  forwardM: number(),
  lateralM: number(),
  verticalM: number(),
  turnRad: number(-10, 10),
  reserve: number(0, 1),
  mode,
  clear: { type: "boolean" },
});
const action = closed({
  mode,
  walkSpeedCmS: number(0, 100),
  yawRate: number(-13, 13),
  dt: number(0.001, 1),
  stepS: number(0.001, 1),
  walkTauS: number(0, 10),
});
const prediction = closed({
  tick: count,
  forwardM: number(),
  turnRad: number(-13, 13),
  nominalCmS: number(0, 100),
  turnRate: number(-13, 13),
  dt: number(0.001, 1),
  sigmaCmS: number(0.001, 4),
});
const seed = nullable({ type: "integer", minimum: 0, maximum: 0xffffffff });
const simulator = { type: "string", minLength: 1, maxLength: 80 };
export function echoCheckpointErrors(
  raw: unknown,
  version: string,
  variants: readonly string[],
  limits: { history: number; window: number; episodes: number },
): string[] {
  const array = (items: Schema, maxItems: number): Schema => ({
    type: "array",
    items,
    maxItems,
  });
  const schema = closed({
    schema: { const: version },
    variant: { type: "string", enum: [...variants] },
    context: closed({ seed, simulator }),
    hash: { type: "string", pattern: "^[a-f0-9]{64}$" },
    state: closed({
      tick: count,
      estimate: closed({
        positionM: vector,
        yaw: number(-Math.PI, Math.PI),
        speedCmS: number(),
        reserve: number(0, 1),
        mode,
      }),
      gain: number(0.2, 1.6),
      turnGain: number(0.2, 1.6),
      driftCmS: number(-3, 3),
      sigmaCmS: number(0.001, 4),
      errorCmS: nullable(number()),
      turnErrorRad: nullable(number(-Math.PI, Math.PI)),
      attribution: {
        type: "string",
        enum: [
          "insufficient excitation",
          "unchanged",
          "action response changed",
          "external disturbance",
          "mixed",
          "unreliable observations",
        ],
      },
      failures: count,
      predictions: count,
      covered: count,
      recalled: count,
      adaptedActions: count,
      nominalEndCmS: number(0, 100),
      pending: nullable(prediction),
      attempted: nullable(action),
      window: array(
        closed({ x: number(), y: number(), turnX: number(), turnY: number() }),
        limits.window,
      ),
      history: array(observation, limits.history),
      episodes: array(
        closed({
          version: { const: version },
          seed,
          simulator,
          tick: count,
          observation,
          attempted: action,
          prediction,
          errorCmS: number(),
          before: number(0.2, 1.6),
          after: number(0.2, 1.6),
          turnGain: number(0.2, 1.6),
          driftCmS: number(-3, 3),
          reliability: number(0, 1),
        }),
        limits.episodes,
      ),
    }),
  });
  return schemaErrors(raw, schema);
}
