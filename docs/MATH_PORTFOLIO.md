# Mathematical research scouting across Vers3Dynamics

**A mathematical paper may suggest a useful question. It does not authorize an algorithm, a control action, or a scientific claim.**

The integrated [R.A.I.N. Lab](../README.md) already holds a read-only, pinned, provenance-checked index derived from [`openai/math`](https://github.com/openai/math). That repository is a collection of research manuscripts and selected Lean formalizations, **not a runtime solver, a validated theorem bank for every application, or a package of production algorithms**. Its own [README](https://github.com/openai/math/blob/main/README.md) warns that some results are unformalized and may have issues.

## One command for the portfolio

```sh
npm run rain:math:verify
npm run rain:math:portfolio
npm run rain:math:portfolio -- --project circle
npm run rain:math:portfolio -- --project dynamic-resonance-rooting --json
```

The `--project` names are the eight repositories currently in [`portfolio.ts`](../src/rain/mathematics/portfolio.ts). The tool searches R.A.I.N.'s **bundled index**, so it makes no network request. It reports:

- a research question and a possible next falsification experiment for each project;
- up to three lexical *candidate* mathematical families with matched terms, catalogue status and commit-pinned URLs;
- the upstream revision and index content hash;
- explicit boundaries, including when no lexical candidate exists.

It does **not** evaluate theorems, download the PDFs, run Lean, establish applicability, change experiment criteria or authorize an action. `formalization_catalogued` only means the source index records a formalization for that result family; this command never compiles the proof. A paper with matching words may be completely irrelevant.

## How to promote a candidate responsibly

1. **Inspect** the manuscript and the exact Lean scope if there is one, rather than relying on a title.
2. **Write the bridge:** define assumptions, variables, dimensions and a proposed implication for this project's algorithm or experiment. A keyword match is not a bridge.
3. **Implement the smallest runnable comparator or negative control** in the target repository, with a deterministic reference result.
4. **Register a falsifiable prediction** and run matched seeds or previously unseen observations. Preserve failures and alternative interpretations.
5. **Keep levels separate:** an index match is a research suggestion; a checked proof concerns its formal statement; a measured algorithmic improvement needs a benchmark; a physical or human claim needs its own external evidence.

Do not copy manuscripts, Lean sources or PDFs into the other repositories. Read the [upstream Apache-2.0 license](https://github.com/openai/math/blob/main/LICENSE) before reusing material. Prefer references and derived *questions* over code duplication.

## Project lenses

| Repository | Question to investigate first |
| --- | --- |
| [R.A.I.N. / Lop Nur Twin](https://github.com/topherchris420/lop-nur-twin) | Stability of conclusions under explicit simulator rule ablations |
| [Resonate AI Mesh](https://github.com/topherchris420/resonate-ai-mesh) | Authority invariants under stale proposals and counterfactual policies |
| [DRR](https://github.com/topherchris420/dynamic-resonance-rooting) | False-alarm behavior of lag inference on dependent, long-memory signals |
| [CIRCLE](https://github.com/topherchris420/circle) | Bounded timing errors under missing or reordered synthetic sensor packets |
| [Pine Gap](https://github.com/topherchris420/satellite-vision-scape) | Separating agent skill from environment-induced advantages |
| [rain-pipeline](https://github.com/topherchris420/rain-pipeline) | Preregistered negative controls and independent subject-level holdouts |
| [Vanta](https://github.com/topherchris420/vanta) | Whether a research graph mistakes shared language for a sourced connection |
| [Studio](https://github.com/topherchris420/quantum-spin-sound) | Spectral parity between an intended pattern and real audio output |

**Current status:** the scouting workflow is a deterministic, versioned reference layer. These candidate questions are **not** new experimental results, validated mathematical improvements or integrations of OpenAI model weights.
