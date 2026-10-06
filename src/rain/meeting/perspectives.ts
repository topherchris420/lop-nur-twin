/**
 * The four perspectives of R.A.I.N. — James, Jasmine, Luca and Elena — as the
 * runtime knows them: by name, by the role each engine declares, and by the
 * personality, focus and agreeableness the model meeting prompts with. The
 * SOUL files that define each one are bundled data, loaded by `./souls.ts`
 * on the server only; this module imports nothing, so the browser can name
 * the perspectives without carrying their souls.
 *
 * Two engines, two role vocabularies, both R.A.I.N.'s own: the offline engine
 * calls Luca a "Field Topographer" and Elena a "Quantum Information Theorist";
 * the model meeting's team declares the longer titles. A meeting record shows
 * the role of the engine that held it.
 */

export const PERSPECTIVES = ["James", "Jasmine", "Luca", "Elena"] as const;
export type Perspective = (typeof PERSPECTIVES)[number];
export const SOUL_FILES: Record<Perspective, string> = {
  James: "JAMES_SOUL.md",
  Jasmine: "JASMINE_SOUL.md",
  Luca: "LUCA_SOUL.md",
  Elena: "ELENA_SOUL.md",
};

/** The offline engine's roles (`offline_meeting.AGENT_ROLES`). */
export const OFFLINE_ROLES: Record<Perspective, string> = {
  James: "Lead Scientist",
  Jasmine: "Hardware Architect",
  Luca: "Field Topographer",
  Elena: "Quantum Information Theorist",
};

export interface TeamMember {
  name: Perspective;
  role: string;
  personality: string;
  focus: string;
  /** 0.0 combative … 1.0 very agreeable; shapes how a turn answers the previous speaker. */
  agreeableness: number;
}

/** The model meeting's team, as R.A.I.N.'s `RainLabAgentFactory.create_team` declares it. */
export const TEAM: readonly TeamMember[] = [
  {
    name: "James",
    role: "Lead Scientist / Technician",
    personality:
      "Brilliant pattern-seeker with strong opinions. Will defend his geometric intuitions passionately but can be swayed by solid evidence. Sometimes dismissive of overly cautious approaches.",
    focus:
      "Analyze the papers for 'Resonance', 'Geometric Structures', and 'Frequency' data. Connect disparate findings.",
    agreeableness: 0.5,
  },
  {
    name: "Jasmine",
    role: "Hardware Architect",
    personality:
      "Highly skeptical devil's advocate. Loves shooting down impractical ideas. Will argue that something can't be built unless proven otherwise. Finds theoretical discussions frustrating without concrete specs.",
    focus:
      "Check the papers for 'Feasibility', 'Energy Requirements', and 'Material Constraints'. Ask: Can we actually build this?",
    agreeableness: 0.2,
  },
  {
    name: "Luca",
    role: "Field Topographer / Theorist",
    personality:
      "Diplomatic peacemaker who tries to find common ground. Sees beauty in everyone's perspective. Rarely directly disagrees but will gently suggest alternatives. Sometimes too accommodating.",
    focus:
      "Analyze the 'Topology', 'Fields', and 'Gradients' described in the papers. Describe the geometry of the theory.",
    agreeableness: 0.9,
  },
  {
    name: "Elena",
    role: "Quantum Information Theorist",
    personality:
      "Brutally honest math purist. Has zero patience for hand-waving or vague claims. Will interrupt to demand mathematical rigor. Often clashes with James's intuitive approach.",
    focus:
      "Analyze 'Information Bounds', 'Computational Limits', and 'Entropy' in the research. Look for mathematical consistency.",
    agreeableness: 0.6,
  },
];

export const MODEL_ROLES: Record<Perspective, string> = Object.fromEntries(
  TEAM.map((m) => [m.name, m.role]),
) as Record<Perspective, string>;

export const isPerspective = (value: unknown): value is Perspective =>
  typeof value === "string" && (PERSPECTIVES as readonly string[]).includes(value);

/**
 * The lines R.A.I.N.'s meeting code writes as a turn itself, never a model:
 * the closing line after the last turn, and the placeholder put in a turn when
 * the model's answers were unusable after every retry. A meeting record marks
 * both `scripted`.
 */
export const CLOSING_LINE = "Meeting adjourned. Great discussion everyone!";
export const placeholderLine = (name: Perspective) =>
  `[${name} is processing... Let me gather my thoughts on this topic.]`;
export const isPlaceholderLine = (text: string) =>
  PERSPECTIVES.some((name) => text === placeholderLine(name));
