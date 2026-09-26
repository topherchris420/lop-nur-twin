import { ACTION_CONTRACT_VERSION, OBSERVATION_SCHEMA_VERSION, AXES } from "../contract";
import { legalActionsFor, type JevObservation, type LegalActions } from "../observation";

/**
 * Test fixtures and the fake TypeSafe endpoint.
 *
 * Imported by `*.test.ts` files only — nothing in the application imports this
 * directory, so none of it reaches the bundle. The fake answers in TypeSafe's
 * wire format with deterministic probabilities; it exists so the suites can
 * exercise every success and failure path without spending API credit, and it
 * is never wired into the running game, where a decision is either TypeSafe's
 * or visibly labelled as something else.
 */

export function makeObservation(
  overrides: {
    sequence?: number;
    control?: JevObservation["control"];
    player?: Partial<JevObservation["player"]>;
    weapon?: Partial<JevObservation["weapon"]>;
    perception?: Partial<JevObservation["perception"]>;
  } = {},
): JevObservation {
  const player: JevObservation["player"] = {
    alive: true,
    health: 100,
    headingDeg: 90,
    pitchDeg: 0,
    speedMps: 0,
    stance: "stand",
    motion: "still",
    grounded: true,
    adsProgress: 0,
    ...overrides.player,
  };
  const weapon: JevObservation["weapon"] = {
    slot: "primary",
    weaponClass: "assault",
    fireMode: "auto",
    ammo: 24,
    magSize: 30,
    reserve: 120,
    reloading: false,
    canFire: true,
    spreadDeg: 1.8,
    aimedSpreadDeg: 0.35,
    ...overrides.weapon,
  };
  const control = overrides.control ?? "direct";
  const perception: JevObservation["perception"] = {
    visibleEnemies: [
      {
        bearingDeg: 9.4,
        elevationDeg: -0.6,
        distanceM: 27,
        onCrosshair: false,
        firing: true,
        headVisible: true,
        chestVisible: true,
        lateralMps: -1.2,
        tracked: false,
      },
    ],
    contacts: [{ source: "gunfire", bearingDeg: -120, distanceM: 60, ageS: 1.2 }],
    damage: { ageS: 0.5, bearingDeg: 12 },
    obstacles: {
      forwardM: null,
      leftM: 3.1,
      rightM: null,
      backM: null,
      forwardClimbable: false,
    },
    ...overrides.perception,
  };
  return {
    schemaVersion: OBSERVATION_SCHEMA_VERSION,
    actionContract: ACTION_CONTRACT_VERSION,
    sequence: overrides.sequence ?? 1,
    control,
    match: {
      mode: "tdm",
      phase: "live",
      timeRemainingS: 480,
      team: "blue",
      ownScore: 3,
      enemyScore: 5,
    },
    player,
    weapon,
    perception,
    objective: { kind: "none", bearingDeg: null, distanceM: null, state: null },
    previous: { frame: null, outcome: null },
    legal: legalActionsFor(player, weapon, {
      control,
      visibleEnemies: perception.visibleEnemies.length,
    }),
  };
}

/**
 * TypeSafe-shaped Choice answers that pick the first legal option of each
 * asked axis. An axis with a single option is not asked, so it gets no answer.
 */
export function fakeAnswers(
  legal: LegalActions,
  pick: Partial<Record<(typeof AXES)[number], string>> = {},
): Record<string, unknown> {
  const answers: Record<string, unknown> = {};
  for (const axis of AXES) {
    const options = legal[axis] as readonly string[];
    if (options.length < 2) continue;
    const choice = pick[axis] ?? options[0]!;
    const rest = (1 - 0.7) / Math.max(1, options.length - 1);
    const probabilities: Record<string, number> = {};
    for (const option of options) probabilities[option] = option === choice ? 0.7 : rest;
    answers[axis] = { type: "choice", choice, probabilities, confidence: 0.62 };
  }
  return answers;
}

export interface FakeTypeSafeCall {
  url: string;
  authorization: string | null;
  body: Record<string, unknown>;
}

/**
 * A `fetch` stand-in for `https://api.typesafe.ai/v1/systemone`. Each call is
 * recorded; `respond` decides the reply from the parsed request body.
 */
export function fakeTypeSafe(
  respond: (body: Record<string, unknown>, call: number) => Response | Promise<Response>,
): { fetch: typeof fetch; calls: FakeTypeSafeCall[] } {
  const calls: FakeTypeSafeCall[] = [];
  const impl = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const headers = new Headers(init?.headers);
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    calls.push({ url: String(input), authorization: headers.get("authorization"), body });
    if (init?.signal?.aborted) throw new DOMException("aborted", "AbortError");
    return respond(body, calls.length);
  };
  return { fetch: impl, calls };
}

/** A successful TypeSafe reply for whatever options the request offered. */
export function typeSafeReply(
  body: Record<string, unknown>,
  pick: Partial<Record<(typeof AXES)[number], string>> = {},
): Response {
  const questions = body["questions"] as Record<
    string,
    { criteria: Record<string, string> }
  >;
  const legal = Object.fromEntries(
    AXES.map((axis) => [axis, Object.keys(questions[axis]?.criteria ?? {})]),
  ) as unknown as LegalActions;
  return Response.json({
    model: "jev-1.13.0",
    answers: fakeAnswers(legal, pick),
    usage: { input_tokens: 1400, output_tokens: 80 },
  });
}
