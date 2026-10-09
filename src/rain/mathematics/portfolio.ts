/** A portfolio-wide map of testable questions, NOT an automatic theorem-to-product adapter.
 *
 * The only data source for candidate references is R.A.I.N.'s already-validated,
 * immutable, pinned `openai/math` index. No GitHub/network call is made here.
 * Search results are lexical candidates, never proofs of a product claim.
 */
import { pinnedUrl } from "./contracts.js";
import type { MathematicalSubstrate } from "./substrate.js";

export const PORTFOLIO_QUESTIONS = [
  {
    repository: "lop-nur-twin",
    question: "Can bounded autonomous experiments expose a simulator assumption that changes a result?",
    search: "stochastic system stability bounds counterexample",
    next_test: "Run matched seeds with one declared rule ablation, retaining negative controls and replay.",
    scope: "Simulated worlds; do not infer claims about real Bethesda or autonomous scientific discovery.",
  },
  {
    repository: "resonate-ai-mesh",
    question: "Which mathematical constraints should remain invariant when agent proposals go stale?",
    search: "graph routing constraints bounded optimization",
    next_test: "Inject stale and adversarial decisions with and without one deterministic gate, under paired seeds.",
    scope: "Software authorization under simulated faults, not verified production safety.",
  },
  {
    repository: "dynamic-resonance-rooting",
    question: "Which assumptions make lag inference fail on long-memory or dependent observations?",
    search: "dependent random process correlation spectral bounds",
    next_test: "Prerecord a red-noise and delayed-signal benchmark; compare false alarms and power on held-out seeds.",
    scope: "No causal identification or cross-domain generalization from a shared theorem title.",
  },
  {
    repository: "circle",
    question: "Can an error bound on timestamp recovery survive missing sensor packets?",
    search: "stochastic noise bounds estimation recovery",
    next_test: "Perturb simulated packet loss and timestamp drift; audit independent replay and reported error intervals.",
    scope: "Software physiology twin only; nothing authorizes building hardware or connecting humans.",
  },
  {
    repository: "satellite-vision-scape",
    question: "When does a routing policy win because of level geometry rather than better decisions?",
    search: "graph paths routing optimization constraints",
    next_test: "Ablate an environmental shortcut across paired agent and scripted trials, measuring collision and success.",
    scope: "Game simulation and recorded policies only; a matching title is not a validated algorithm.",
  },
  {
    repository: "rain-pipeline",
    question: "Can a registered test distinguish a real signal from an artifact of selecting the test afterward?",
    search: "statistical independent samples estimation bound",
    next_test: "Register a falsifiable negative-control test before reading a genuinely new subject-level holdout.",
    scope: "No reclassification of existing experiments or external data as mathematically proven.",
  },
  {
    repository: "vanta",
    question: "Does a research-atlas graph hide ambiguity when several works share the same terms?",
    search: "graph embedding distortion geometry",
    next_test: "Audit a small source-labelled graph against a human-curated edge list, measuring unsupported connections.",
    scope: "Research navigation and presentation, not external verification of published scientific results.",
  },
  {
    repository: "quantum-spin-sound",
    question: "Does measured audio output agree with the intended spectral pattern after an edit?",
    search: "harmonic Fourier frequency wave",
    next_test: "Compare synthesized and specified frequencies with an FFT after connecting the editor to playback.",
    scope: "Audio DSP and creative visualizations, not quantum physics or human-state inference.",
  },
] as const;

export type PortfolioRepository = (typeof PORTFOLIO_QUESTIONS)[number]["repository"];

export function scoutPortfolio(substrate: MathematicalSubstrate, repository: string | null = null) {
  const selected = PORTFOLIO_QUESTIONS.filter(
    (p) => repository === null || p.repository === repository,
  );
  if (repository !== null && selected.length === 0)
    throw new Error("Unknown portfolio repository: " + repository);
  const provenance = substrate.provenance();
  return {
    schema: "rain-math-portfolio/v1" as const,
    epistemic_status: "candidate_references_only" as const,
    provenance,
    projects: selected.map((p) => {
      const results = substrate.searchMathematics(
        {
          query: p.search,
          discipline: null,
          formalization: "any",
          limit: 3,
          mode: "context",
          hypothesis: null,
        },
        "portfolio:" + p.repository,
      );
      return {
        repository: p.repository,
        question: p.question,
        query: p.search,
        next_test: p.next_test,
        scope: p.scope,
        findings: results.findings.map((f) => ({ ...f })),
        candidates: results.results.map((r) => ({
          family: r.family,
          title: r.title,
          catalogue_status: r.status,
          formalization_catalogued: r.formalization_path !== null,
          matched_terms: r.matched.map((m) => m.term),
          source_url: pinnedUrl("openai/math", provenance.commit, "CONTENTS.md"),
          manuscript_urls: r.manuscripts.map((m) =>
            pinnedUrl("openai/math", provenance.commit, m.path),
          ),
        })),
      };
    }),
  };
}
