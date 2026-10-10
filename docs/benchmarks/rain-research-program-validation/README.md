# R.A.I.N. research-program demonstration

This archive contains **two actually executed Bethesda simulator studies**, an
evidence-linked follow-up and a reproducible manuscript package. Researcher
contributions, design choices, narrative and criticism came from an explicitly
scripted integration fixture. **No live Qwen inference or Internet retrieval was
performed.** The recorded numbers are simulator measurements, not invented prose.

[Read the manuscript](programs/DS-1bd994ae-2241-49f7-80b7-8ed8b76a2eea/1-manuscript.md) ·
[Inspect the figure](programs/DS-1bd994ae-2241-49f7-80b7-8ed8b76a2eea/1-figure.svg) ·
[Read the scientific critique](programs/DS-1bd994ae-2241-49f7-80b7-8ed8b76a2eea/1-review.json) ·
[Inspect the lineage](programs/DS-1bd994ae-2241-49f7-80b7-8ed8b76a2eea/graph.json) ·
[Read the experimental report](REPORT.md)

## What happened

The question was how simulated urban disruptions alter collective movement and
whether the same intervention can have different outcomes under different
conditions. Eight perspective contributions span two iterations: James, Jasmine,
Luca and Elena each read source context and earlier contributions before the
existing designer proposes a typed experiment. The second iteration receives the
first study's measured results, critique and parent references.

Both studies simulated a minor fire at Bethesda Row, with eight vehicles, two
buses, 100 warm-up ticks, a 300-tick event and a 300-tick observation window.
The primary measurement was the native mean watching count. Each study used
three matched control/treatment seed pairs, with only treatment receiving fire.
The follow-up changed pedestrian population after the first result was positive.
Its rationale cites that measured value and its evidence and parent IDs point to
the first native study. Neither population protocol is a legacy hardcoded design.

| Study | Pedestrians | Mean control | Mean treatment | Mean paired difference | Paired differences | Native verdict |
| ----- | ----------: | -----------: | -------------: | ---------------------: | ------------------ | -------------- |
| 1     |          40 |            0 |           4.22 |                  +4.22 | 5, 4.33, 3.33      | supported      |
| 2     |          60 |            0 |              9 |                     +9 | 12.67, 7, 7.33     | supported      |

Both met their preregistered descriptive increase criteria. Each was registered,
executed and replayed through the existing native pipeline. The host compiled the
scripted draft against those records, generated the measurement table and SVG,
retained a separate scripted review, and marked delivery ready for human review.
Source context consists of pinned author-paper excerpts and mathematical catalogue
entries, whose relevance and applicability still require scientific assessment.

**Interpretation limit:** both outcomes have the same direction. Different
populations and different seed panels do not establish an interaction, a reversal,
a significant effect or real human behavior. These are exploratory studies with
no withheld-seed confirmation. The draft demonstrates the software's evidence flow;
its repeated fixture paragraphs are not evidence of publication-quality reasoning.
A live-Qwen program and human scientific review remain necessary.

## Reproduce

The producing local commit is `9f53b34562dcba8a4adf91c5f5267a3e3579383b` and its Git tree is
`1af2b5d4514015e5968c727b168b344610726fd2`. Both records report a clean working tree. The source-publication mapping
in this directory records the byte-identical published tree; producing records
are never rewritten to substitute a later commit.

```sh
npm run rain:discovery-demo -- --verify docs/benchmarks/rain-research-program-validation
```

This checks the journal chain, replays the exact archived seeds, verifies artifact
hashes, compares manuscript evidence with sealed native measurements, and
recompiles the manuscript byte for byte. To generate another program with fresh
host-selected seeds and identifiers:

```sh
npm run rain:discovery-demo -- --research --out .rain-research/new-program-demo
```

Fresh runs need not reproduce these aggregate values; replay uses the recorded
seed panel. The scripted fixture's authorization applies only to this integration
exercise and grants no authority to a live model.

## Contents

- `records/`, `registry/`, `charters/`: sealed runs, native evaluation and scoped fixture authority.
- `discovery/`: immutable events including eight perspective contributions, proposals, decisions, validation, preregistration, replay, criticism and artifact hashes.
- `programs/`: draft, structured paragraphs, source/evidence bundle, figure, BibTeX, review, graph and delivery checkpoint.
- `summary.json`, `REPORT.md`: complete machine-readable outcome and experiment report.

The final graph contains 21 nodes and 46 edges.
The research question remains open even when a manuscript is ready for review.
