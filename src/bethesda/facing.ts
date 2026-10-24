/** Presentation only. Which way an agent faces, no world-state writes. */
import { distance } from "./model";
import { roads, sidewalks } from "./network";
import type { Agent } from "./simulation";
import type { CityEvent } from "./scenarios";

/**
 * Which way an agent faces where it is drawn at (`x`, `z`), as the renderer
 * turns it (atan2 of x over z): along its edge, or, for a pedestrian
 * watching or recording an event, toward where the simulator tracks the
 * event (a procession's moving middle, not the compiled point where it
 * started). The fly's people face the same way.
 */
export function agentHeading(
  a: Agent,
  events: readonly CityEvent[],
  x: number,
  z: number,
): number {
  const edge = (a.kind === "pedestrian" ? sidewalks : roads).edges[a.edge]!;
  if (a.kind === "pedestrian" && (a.action === "watch" || a.action === "record")) {
    const event = events.find((e) => e.kind !== "storm" && distance(e.at, a.point) < 100);
    if (event) return Math.atan2(event.at.x - x, event.at.z - z);
  }
  return edge.heading;
}
