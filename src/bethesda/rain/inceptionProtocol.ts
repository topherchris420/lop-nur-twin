/** Operator-owned, declarative configuration. These identities confer no authority. */
import { closed } from "./discoveryProtocol.js";

export const PARTNERS = ["Christopher-Sim", "Research-Collaborator"] as const;
export type Partner = (typeof PARTNERS)[number];
export const INCEPTION_MODES = [
  "interactive",
  "independent",
  "reflection",
  "creative",
  "institution",
] as const;
export type InceptionMode = (typeof INCEPTION_MODES)[number];
export interface CognitiveProfile {
  version: number;
  methods: string[];
  source_ids: string[];
  attribution: "operator-configured approximation";
}
export interface Partnership {
  schema: "rain-partnership/v1";
  mode: InceptionMode;
  memory_epoch: number;
  profile: CognitiveProfile;
}
const strings = (maxItems: number, maxLength: number) => ({
  type: "array",
  maxItems,
  items: { type: "string", minLength: 1, maxLength },
});
export const PARTNERSHIP_SCHEMA = closed({
  schema: { const: "rain-partnership/v1" },
  mode: { enum: [...INCEPTION_MODES] },
  memory_epoch: { type: "integer", minimum: 0, maximum: 1000000 },
  profile: closed({
    version: { type: "integer", minimum: 1, maximum: 1000000 },
    methods: { ...strings(6, 400), minItems: 1 },
    source_ids: strings(12, 100),
    attribution: { const: "operator-configured approximation" },
  }),
});
export function partnership(mode: InceptionMode = "independent"): Partnership {
  return {
    schema: "rain-partnership/v1",
    mode,
    memory_epoch: 0,
    profile: {
      version: 1,
      source_ids: [],
      attribution: "operator-configured approximation",
      methods: [
        "Conceptual synthesis: connect domains and name the assumptions of the connection.",
        "Creative divergence: propose an unconventional alternative, labeled untested.",
        "Mathematical investigation: specify observables, a model and a falsification criterion.",
        "Artistic reasoning: explore sound, resonance and composition as design prompts, not evidence.",
        "Reflective criticism: retain counterexamples and revise unsupported assumptions.",
        "Project creation: turn an idea into a bounded native experiment or extension proposal.",
      ],
    },
  };
}
export interface CognitiveMemory {
  id: string;
  namespace: Partner;
  layer: "foundational" | "episodic" | "semantic" | "creative" | "critical";
  text: string;
  origin: string;
  source_ids: string[];
  evidence_run_ids: string[];
  status: "source-context" | "model-inferred" | "scripted";
  about: "computational-research";
}
