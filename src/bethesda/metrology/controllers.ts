/**
 * The controllers the bench compares: real implementations from this
 * repository, never stand-ins. Every one is the deployed configuration's
 * `OrganismAdapter` (ECHO v3 self-model, mushroom body, olfaction, physiology)
 * or a subclass of it, built with the same constructor arguments, so they
 * receive the same random streams and differ only in the code under test.
 *
 * The plasticity study's arms, seen as a 2×2 of learning and acting:
 *
 * |                 | never acts            | acts when learned    | always acts  |
 * | --------------- | --------------------- | -------------------- | ------------ |
 * | learns          | `plasticity-shadow`   | `plasticity-active`  |              |
 * | does not learn  | `organism`, `plasticity-disabled` |          | `fixed-slow` |
 *
 * `plasticity-shadow` and `plasticity-disabled` carry the plasticity's code and
 * state but must behave exactly as `organism`: they are the bench's check that
 * merely carrying the addition changes nothing (validity), and the ablation of
 * its action. `fixed-slow` is the simpler non-learning alternative: the same
 * slowing on every walk, with no evidence and no learning.
 *
 * Research subjects only. Nothing deployed imports this module (scope.test.ts).
 */
import type { AdapterStreams } from "../fly/neural.js";
import { OrganismAdapter } from "../life/organism.js";
import { PlasticityOrganismAdapter } from "../life/plasticOrganism.js";
import { PLASTICITY_PARAMS } from "../fly/echo/adaptiveBrain.js";
import { FixedSlowAdapter } from "../plasticity/study.js";

export const CONTROLLER_IDS = [
  "organism",
  "plasticity-active",
  "plasticity-shadow",
  "plasticity-disabled",
  "fixed-slow",
] as const;
export type ControllerId = (typeof CONTROLLER_IDS)[number];

export interface ControllerSpec {
  id: ControllerId;
  label: string;
  /** What it is, in the repository's words. */
  description: string;
  /** Where its code lives. */
  source: string;
  learns: boolean;
  acts: "never" | "when learned" | "always";
  /**
   * Fixed numbers the controller adds to the organism (its declared model
   * parameters), a crude size: the bench reports it beside measured cost.
   */
  addedParameters: number;
  build: (rng: () => number, streams: AdapterStreams, seed: number) => OrganismAdapter;
}

const PLASTICITY_PARAM_COUNT = Object.keys(PLASTICITY_PARAMS).length;

export const CONTROLLERS: Readonly<Record<ControllerId, ControllerSpec>> = {
  organism: {
    id: "organism",
    label: "Organism (deployed configuration, no plasticity)",
    description:
      "The deployed ECHO organism: ECHO v3's self-model over the reduced-order controller, with the mushroom body, olfactory navigation and maintenance physiology.",
    source: "src/bethesda/life/organism.ts (OrganismAdapter)",
    learns: false,
    acts: "never",
    addedParameters: 0,
    build: (rng, streams, seed) => new OrganismAdapter(rng, streams, seed),
  },
  "plasticity-active": {
    id: "plasticity-active",
    label: "Embodied plasticity, active",
    description:
      "echo-embodied-plasticity/v2 in active mode: learns how reliably its own walks carry it per energy context, and slows an intended walk to 0.7× once a context's failure lower bound exceeds one half.",
    source:
      "src/bethesda/fly/echo/adaptiveBrain.ts via src/bethesda/life/plasticOrganism.ts",
    learns: true,
    acts: "when learned",
    addedParameters: PLASTICITY_PARAM_COUNT,
    build: (rng, streams, seed) =>
      new PlasticityOrganismAdapter(rng, streams, seed, "active"),
  },
  "plasticity-shadow": {
    id: "plasticity-shadow",
    label: "Embodied plasticity, shadow (action ablated)",
    description:
      "The same plasticity in shadow mode: it learns and counts the walks it would slow, and changes none.",
    source:
      "src/bethesda/fly/echo/adaptiveBrain.ts via src/bethesda/life/plasticOrganism.ts",
    learns: true,
    acts: "never",
    addedParameters: PLASTICITY_PARAM_COUNT,
    build: (rng, streams, seed) =>
      new PlasticityOrganismAdapter(rng, streams, seed, "shadow"),
  },
  "plasticity-disabled": {
    id: "plasticity-disabled",
    label: "Embodied plasticity, disabled (learning and action ablated)",
    description:
      "The plasticity's code carried in disabled mode: it neither learns nor acts.",
    source:
      "src/bethesda/fly/echo/adaptiveBrain.ts via src/bethesda/life/plasticOrganism.ts",
    learns: false,
    acts: "never",
    addedParameters: PLASTICITY_PARAM_COUNT,
    build: (rng, streams, seed) =>
      new PlasticityOrganismAdapter(rng, streams, seed, "disabled"),
  },
  "fixed-slow": {
    id: "fixed-slow",
    label: "Fixed slow gait (non-learning control)",
    description:
      "Every intended walk slowed by the same 0.7 the active policy uses, always, with no evidence and no learning: the plasticity study's ablation.",
    source: "src/bethesda/plasticity/study.ts (FixedSlowAdapter)",
    learns: false,
    acts: "always",
    addedParameters: 1,
    build: (rng, streams, seed) => new FixedSlowAdapter(rng, streams, seed),
  },
};

export const isControllerId = (v: unknown): v is ControllerId =>
  typeof v === "string" && (CONTROLLER_IDS as readonly string[]).includes(v);
