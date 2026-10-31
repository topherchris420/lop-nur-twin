/**
 * Research subjects for first-contact experiments: new flies built from a
 * seed, in an arena of their own. None is Eva or ECHO, a copy of either, or a
 * continuation of either, and none is ever presented as one.
 *
 * A subject's controller is one of the repository's existing decision
 * makers, unchanged:
 *
 * - `reduced-order`: the reduced-order controller (fly/controller.ts), the
 *   kind the deployed Bethesda life was born with;
 * - `echo`: the ECHO adapter (fly/echo/adapter.ts), its v3 self-model over
 *   the reduced-order controller;
 * - `organism`: the organism adapter (life/organism.ts), the kind the
 *   deployed individual has run since its recorded continuation. In an arena
 *   its physiology stays at its initial state, because the organism's life
 *   (`OrganismLife`), not the adapter, advances physiology each tick, and an
 *   arena has no odour for its olfaction to sample. Both are named as
 *   approximations wherever a result uses this arm.
 *
 * Eva's controller is the garden service's own (learning.py), which this
 * repository does not hold: no subject here stands in for it.
 */
import type { ArenaSpec } from "../fly/arena.js";
import { EchoAdapter } from "../fly/echo/adapter.js";
import { DigitalFly, type FlyStart } from "../fly/fly.js";
import type { AdapterStreams, FlyNeuralAdapter } from "../fly/neural.js";
import type { FlyWorld } from "../fly/world.js";
import { OrganismAdapter } from "../life/organism.js";
import { refuseOriginal } from "./originals.js";

export const CONTROLLERS = ["reduced-order", "echo", "organism"] as const;
export type SubjectController = (typeof CONTROLLERS)[number];

export const CONTROLLER_APPROXIMATIONS: Readonly<Record<SubjectController, string[]>> = {
  "reduced-order": [],
  echo: [],
  organism: [
    "physiology held at its initial state: OrganismLife advances it each tick, an arena does not",
    "olfaction samples zero odour: the arena has no food",
  ],
};

export function adapterFor(
  controller: SubjectController,
  seed: number,
): ((rng: () => number, streams: AdapterStreams) => FlyNeuralAdapter) | undefined {
  switch (controller) {
    case "reduced-order":
      return undefined;
    case "echo":
      return EchoAdapter.factory({ variant: "full", seed });
    case "organism":
      return (rng, streams) => new OrganismAdapter(rng, streams, seed);
  }
}

export interface SubjectSpec {
  /** A research id: never an original's (`refuseOriginal`). */
  id: string;
  seed: number;
  controller: SubjectController;
  start: FlyStart;
}

export interface ResearchSubject {
  spec: SubjectSpec;
  fly: DigitalFly;
  descriptor: string;
}

export function researchSubject(spec: SubjectSpec, world: FlyWorld): ResearchSubject {
  refuseOriginal(spec.id, "research subject");
  if (!spec.id.startsWith("research-"))
    throw new Error(`research subject ids start with "research-", not ${spec.id}`);
  const adapter = adapterFor(spec.controller, spec.seed);
  const fly = new DigitalFly({
    seed: spec.seed,
    world,
    start: spec.start,
    ...(adapter ? { adapter } : {}),
  });
  return { spec, fly, descriptor: fly.adapter.descriptor.id };
}

/** The arena every first-contact study uses unless it says otherwise. */
export const CONTACT_ARENA: ArenaSpec = Object.freeze({
  size: [1, 0.6, 1],
  ambient: 1,
  lights: [{ at: [0, 0.6, 0], intensity: 1 }],
}) as ArenaSpec;

/** True while the fly stands on something (rest, groom, walk, feed). */
export const perched = (fly: DigitalFly) =>
  fly.state.mode === "rest" ||
  fly.state.mode === "groom" ||
  fly.state.mode === "walk" ||
  fly.state.mode === "feed";
