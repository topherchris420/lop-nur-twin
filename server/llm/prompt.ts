import type { Axis } from "../../src/game/pilot/contract.js";
import type { JevObservation } from "../../src/game/pilot/observation.js";
import { canonicalHash } from "../../src/game/pilot/hash.js";
import { questionParts, type QuestionParts } from "../jev/question.js";

/**
 * The question a conventional LLM is asked, built on the server from a
 * validated observation — never from text the browser sent.
 *
 * Parity with Jev is by construction: the context, the rendered state, each
 * question and each option's description come from `questionParts`, the same
 * function Jev's TypeSafe request is built from. What differs is the envelope,
 * because the APIs differ, and each difference is stated here rather than
 * discovered later:
 *
 *  - Jev answers each axis as a separate Choice question, evaluated in
 *    parallel, and cannot see its other answers. The LLM answers every axis in
 *    one completion and can.
 *  - Jev returns a probability for every offered option. The LLM returns a
 *    choice and, when the deployment asks for it, a confidence it writes itself
 *    ("verbalized"). That number is recorded as such and never presented as a
 *    probability distribution.
 *  - The LLM is told the answer format; Jev's format is TypeSafe's API. The
 *    format instructions say nothing about how to play.
 */

export type ConfidenceMode = "verbalized" | "none";

export interface LlmPrompt {
  system: string;
  user: string;
  /** JSON Schema of the answer, for providers that constrain output. */
  schema: Record<string, unknown>;
  asked: Axis[];
  /** Hash of everything above, so a trace can prove what was asked. */
  questionHash: string;
}

const FORMAT_BASE =
  "You choose the controls for one player in a video game. The user message is JSON with three fields: `context` explains the game and what your choice controls, `state` is what the player can currently perceive, and `questions` holds one question per control axis, each with its allowed options and what each option does. Answer every question with exactly one of its allowed options, copied exactly. Reply with a single JSON object and nothing else, keyed by axis name as in `questions`.";

const FORMAT_CONFIDENCE =
  " For each axis give an object with `choice` (the option) and `confidence` (a number from 0 to 1: how likely you think it is that this option is the best of the options offered for that axis).";

const FORMAT_CHOICE_ONLY = " For each axis give an object with `choice` (the option).";

export function answerSchema(
  parts: QuestionParts,
  confidence: ConfidenceMode,
): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [axis, q] of Object.entries(parts.questions)) {
    if (!q) continue;
    required.push(axis);
    properties[axis] = {
      type: "object",
      properties: {
        choice: { type: "string", enum: Object.keys(q.options) },
        ...(confidence === "verbalized" ? { confidence: { type: "number" } } : {}),
      },
      required: confidence === "verbalized" ? ["choice", "confidence"] : ["choice"],
      additionalProperties: false,
    };
  }
  return { type: "object", properties, required, additionalProperties: false };
}

export function buildLlmPrompt(
  obs: JevObservation,
  confidence: ConfidenceMode,
): LlmPrompt {
  const parts = questionParts(obs);
  const system =
    FORMAT_BASE + (confidence === "verbalized" ? FORMAT_CONFIDENCE : FORMAT_CHOICE_ONLY);
  const user = JSON.stringify({
    context: parts.context,
    state: parts.state,
    questions: parts.questions,
  });
  const schema = answerSchema(parts, confidence);
  return {
    system,
    user,
    schema,
    asked: Object.keys(parts.questions) as Axis[],
    questionHash: canonicalHash({ system, user, schema }),
  };
}
