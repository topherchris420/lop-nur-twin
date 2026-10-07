import type { BrainKind } from "../core/gameStore";

/**
 * Who the HUD says is in control. A label is a claim, so it is decided here,
 * once, from the seat's state — never patched where it is drawn.
 *
 * LIVE JEV, LIVE GLIDE and LIVE LLM each claim that the controls in effect
 * came from a validated answer from that provider: true once the seat has
 * accepted one, while the latest accepted answer is the provider's own rather
 * than the fallback's, and while no request has failed since. A remote seat
 * that is connecting, timed out, unavailable or failing is named without LIVE
 * (JEV, GLIDE, LLM), and the HUD prints its status beside the name.
 */
export type ControlLabel =
  | "HUMAN"
  | "LIVE JEV"
  | "LIVE GLIDE"
  | "LIVE LLM"
  /** A remote seat whose controls in effect did not come from a validated answer. */
  | "JEV"
  | "GLIDE"
  | "LLM"
  | "RANDOM"
  | "SCRIPTED"
  | "REPLAY"
  | "FALLBACK";

export interface SeatState {
  brain: BrainKind;
  /** Decisions the seat has accepted, from any source. */
  accepted: number;
  /** The last decision accepted, or the frame executing now, came from the fallback. */
  fallback: boolean;
  /** A request has failed and no validated answer has arrived since. */
  failing: boolean;
}

const LIVE = { jev: "LIVE JEV", glide: "LIVE GLIDE", llm: "LIVE LLM" } as const;
const NOT_LIVE = { jev: "JEV", glide: "GLIDE", llm: "LLM" } as const;

export function controlLabel(seat: SeatState): ControlLabel {
  switch (seat.brain) {
    case "human":
      return "HUMAN";
    case "random":
      return "RANDOM";
    case "script":
      return "SCRIPTED";
    case "replay":
      return "REPLAY";
    case "jev":
    case "glide":
    case "llm":
      if (seat.fallback) return "FALLBACK";
      return seat.accepted > 0 && !seat.failing ? LIVE[seat.brain] : NOT_LIVE[seat.brain];
  }
}

/**
 * What the HUD prints in the label slot. A remote seat that is not live
 * carries its status in the label — JEV CONNECTING, GLIDE UNAVAILABLE — so
 * the slot that would say LIVE says why it does not.
 */
export function labelText(label: ControlLabel, status: string): string {
  return label === "JEV" || label === "GLIDE" || label === "LLM"
    ? `${label} ${status.replace("_", " ")}`
    : label;
}
