# Documentation and research archive

The project's guides, records and results, arranged so that each can be found
without reading the rest. Nothing here was rewritten to make this index: the
documents keep their own history, and the generated archives are never edited by
hand.

**New here?** Read the [project README](../README.md), then the
[claims register](RESEARCH_CLAIMS.md), which lists every prominent result with
its evidence class and its record.

## By what you came to do

| I want to…                                 | Start with                                                                                                                                                             |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Know what has been shown, and how strongly | [Claims register](RESEARCH_CLAIMS.md), [which of its numbers are recomputed](claims/README.md), [evaluation philosophy](EVALUATION_PHILOSOPHY.md)                      |
| Test whether a controller change helps     | [Intelligence metrology bench](ECHO_INTELLIGENCE_METROLOGY.md)                                                                                                         |
| Understand ECHO, the persistent fly        | [Digital fly](DIGITAL_FLY.md), [Project ECHO](PROJECT_ECHO.md), [the collision repair](ECHO_COLLISION.md), [keeping ECHO](ECHO_STEWARDSHIP.md)                         |
| Check ECHO's history for myself            | [Replaying it](BETHESDA_CONTINUOUS_LIFE.md#replaying-it), [the ledger](BETHESDA_CONTINUOUS_LIFE.md#the-ledger)                                                         |
| Look after ECHO or change its simulation   | [Keeping ECHO](ECHO_STEWARDSHIP.md), [operations](BETHESDA_CONTINUOUS_LIFE.md), [AGENTS.md](../AGENTS.md)                                                              |
| Understand Eva and the garden              | [Live garden](LIVE_GARDEN.md), [Eva and ECHO audit](EVA_ECHO_AUDIT.md)                                                                                                 |
| Assess the Lop Nur reconstruction          | [Site model](SITE_MODEL.md), [provenance](DATA_PROVENANCE.md), [uncertainty](UNCERTAINTY_MODEL.md), [temporal model](TEMPORAL_MODEL.md), [white paper](WHITE_PAPER.md) |
| Run research in the R.A.I.N. Lab           | [Lab guide](RAIN_LAB_BETHESDA.md), [scientific workflow](RAIN_SCIENTIFIC_INTELLIGENCE.md), [discovery](RAIN_EXPERIMENTAL_DISCOVERY.md)                                 |
| Work on the connectome models              | [Connectome backend](ECHO_CONNECTOME.md), [adaptive intelligence](ECHO_ADAPTIVE_INTELLIGENCE.md), [`fly-neural/`](../fly-neural/README.md)                             |
| See where Eva and ECHO could go next       | [Project Genesis](PROJECT_GENESIS.md), [research compound eye](FLY_VISION.md)                                                                                          |
| Contribute code                            | [CONTRIBUTING.md](../CONTRIBUTING.md), [AGENTS.md](../AGENTS.md), [architecture](SYSTEM_ARCHITECTURE.md), [validation](VALIDATION.md)                                  |
| Run it locally, with the optional parts    | [Getting started](GETTING_STARTED.md)                                                                                                                                  |

## What runs today

| System                                | Where it runs                                                    | Status                                                       | Guide                                                        |
| ------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------ |
| Lop Nur twin, `/analysis`, `/compare` | The visitor's browser, from committed data                       | Deployed                                                     | [Site model](SITE_MODEL.md)                                  |
| Bethesda and the R.A.I.N. Lab         | The browser (city, lab); Vercel functions (research runtime)     | Deployed, hidden behind a resolver                           | [Bethesda](BETHESDA_ANOMALY.md), [lab](RAIN_LAB_BETHESDA.md) |
| ECHO's headless life                  | One Oracle VM, its store, backups and a public read-only witness | Living since 2026-10-26; on `digital-fly/9` since 2026-11-04 | [Operations](BETHESDA_CONTINUOUS_LIFE.md)                    |
| `/live`                               | The browser, reading ECHO's witness and the public ledger        | Deployed, unlisted                                           | [Witnessing it](BETHESDA_CONTINUOUS_LIFE.md#witnessing-it)   |
| Eva's garden                          | A separate Python service on its own VM, not in this repository  | Living; the clay exhibit page built here since 2026-10-26    | [Live garden](LIVE_GARDEN.md)                                |
| Noeterra                              | Rust, in the browser as WebAssembly, and a local workbench       | Deployed (rule-based seats)                                  | [Noeterra](NOETERRA.md)                                      |
| Blacksite                             | The browser; optional model seats through server functions       | Deployed                                                     | [Blacksite](BLACKSITE.md), [model seats](JEV_BLACKSITE.md)   |
| Connectome backend (`fly-neural/`)    | A research computer; never the originals                         | Research only                                                | [Connectome](ECHO_CONNECTOME.md)                             |
| Physics backend (`fly-physics/`)      | A research computer, MuJoCo, open loop                           | Research only; its flat-floor gate has not passed            | [Priorities](FLY_PRIORITIES.md)                              |
| Experiential habit continuation       | Nowhere yet                                                      | Implemented; not deployed                                    | [Candidate](ECHO_EXPERIENTIAL_CONTINUATION.md)               |

How these fit together, and what does not connect to what:
[system architecture](SYSTEM_ARCHITECTURE.md#12-the-persistent-individuals-and-the-research-backends).

## Milestones, in order

Dated records of what happened. Each is kept as it was written; later findings
are added below the original text, never in place of it.

| Date       | Milestone                                                                             | Record                                                                                          |
| ---------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 2026-10-25 | Eva's life begins in the garden service (`born_at`)                                   | [Eva and ECHO audit](EVA_ECHO_AUDIT.md#the-two-individuals)                                     |
| 2026-10-26 | ECHO is born on one VM; the clay garden page goes live                                | [Operations](BETHESDA_CONTINUOUS_LIFE.md), [live garden](LIVE_GARDEN.md)                        |
| 2026-10-27 | ECHO continued onto ECHO v2, then v3                                                  | [Runbooks](BETHESDA_CONTINUOUS_LIFE.md#preserve-the-deployed-individual-while-enabling-echo-v2) |
| 2026-10-28 | ECHO continued as the organism: learning, odour filters, physiology, archive          | [Organism continuation](ECHO_ORGANISM_CONTINUATION.md)                                          |
| 2026-10-30 | Off-site backups, the outside watcher and the public ledger begin                     | [Backup](BETHESDA_CONTINUOUS_LIFE.md#backup), [ledger](BETHESDA_CONTINUOUS_LIFE.md#the-ledger)  |
| 2026-11-01 | ECHO enters a building's walls and cannot leave                                       | [Collision repair](ECHO_COLLISION.md#the-deployed-fly)                                          |
| 2026-11-02 | First replay of a real archive; observer that leaves no trace deployed                | [Replaying it](BETHESDA_CONTINUOUS_LIFE.md#replaying-it)                                        |
| 2026-11-04 | ECHO continued onto repaired physics; leaves the building; first sealed replay passes | [The cutover, as it ran](ECHO_COLLISION.md#the-cutover-as-it-ran)                               |

## Studies and results

Every result, with its class and record, is in the
[claims register](RESEARCH_CLAIMS.md). By programme:

- **The self-model:** [Project ECHO](PROJECT_ECHO.md), its
  [evaluation report](benchmarks/fly-echo/README.md) and the
  [registered demonstrations](benchmarks/fly-behavior/README.md).
- **Memory and individuality:** [individual continuity](INDIVIDUAL_CONTINUITY.md)
  (Studies A–C), [adaptation across updates](ECHO_ADAPTATION_CONTINUITY.md),
  [acquired search](ECHO_ACQUIRED_BEHAVIOR.md), [ranging](ECHO_RANGING.md),
  [odour navigation](ECHO_OLFACTORY_NAVIGATION.md),
  [maintenance physiology](ECHO_IMMORTAL_ORGANISM.md).
- **Comparison with real flies:** [calibration](DIGITAL_FLY.md#calibration-against-real-flies)
  and its [report](benchmarks/fly-calibration/README.md).
- **Connectome models:** [the backend](ECHO_CONNECTOME.md),
  [adaptive intelligence](ECHO_ADAPTIVE_INTELLIGENCE.md),
  [FAFB results](benchmarks/fly-neural/README.md),
  [BANC results](benchmarks/fly-neural/banc/README.md),
  [the originals' neural shadow](ORIGINALS_LIVE_NEURAL_SHADOW.md).
- **Perception:** [research compound eye](FLY_VISION.md) and its
  [looming battery](benchmarks/fly-vision/README.md);
  [Project Genesis](PROJECT_GENESIS.md) for what it means for Eva and ECHO.
- **A world of its own:** the [research ecology](RAIN_GENESIS.md) and its
  [reference scenarios](benchmarks/ecology/README.md).
- **Encounters:** [first contact](FIRST_CONTACT.md) and its
  [results](benchmarks/first-contact/README.md);
  [neural augmentation](benchmarks/fly-augmentation/README.md).
- **Research workflow:** [scientific intelligence](RAIN_SCIENTIFIC_INTELLIGENCE.md),
  [learning](RAIN_RESEARCH_LEARNING.md), [programs](RAIN_RESEARCH_PROGRAM.md),
  [lineage](RAIN_RESEARCH_LINEAGE.md), [Inception](RAIN_INCEPTION.md),
  [autonomy](RAIN_SCIENTIFIC_AUTONOMY.md), [the mathematics portfolio](MATH_PORTFOLIO.md),
  the [compiler comparison and research attempts](rea-research/evaluations/README.md)
  and the [Bethesda discovery validation](benchmarks/rain-discovery-validation/README.md).
- **Blacksite decisions:** [model seats](JEV_BLACKSITE.md) and the dated archives
  in `benchmarks/2026-09-*` and `benchmarks/2026-10-05`.

## Generated archives

Folders under [`benchmarks/`](benchmarks/) are written by the tool that ran the
study, from a clean commit, and most can be checked byte for byte (`--check`). Do
not edit them; rerun the tool. Each folder's README names its generator and how to
reproduce it.

| Folder                                                                                                                         | What it holds                                                 |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| [`fly-behavior/`](benchmarks/fly-behavior/README.md)                                                                           | Every registered digital-fly experiment, admitted or not      |
| [`fly-pilots/`](benchmarks/fly-pilots/README.md)                                                                               | Pilots that sized the demonstrations: not evidence            |
| [`fly-echo/`](benchmarks/fly-echo/README.md)                                                                                   | ECHO's seeded evaluation report                               |
| [`fly-calibration/`](benchmarks/fly-calibration/README.md)                                                                     | Comparison with published recordings, and the sealed set      |
| [`fly-individuality/`](benchmarks/fly-individuality/README.md), [`fly-mushroom-body/`](benchmarks/fly-mushroom-body/README.md) | Studies A–C                                                   |
| [`echo-adaptation/`](benchmarks/echo-adaptation/README.md)                                                                     | The adaptation and continuity suite                           |
| `echo-acquired/`, `echo-ranging/`, `echo-collision/`                                                                           | Research-fly records of those studies, as the runs wrote them |
| [`fly-neural/`](benchmarks/fly-neural/README.md)                                                                               | FAFB and BANC results, under their data terms                 |
| [`fly-physics/`](benchmarks/fly-physics/README.md)                                                                             | The MuJoCo backend's traces                                   |
| [`first-contact/`](benchmarks/first-contact/README.md), [`fly-augmentation/`](benchmarks/fly-augmentation/README.md)           | Encounter and advisor studies                                 |
| [`fly-vision/`](benchmarks/fly-vision/README.md)                                                                               | The research compound eye's looming battery, and its cost     |
| [`ecology/`](benchmarks/ecology/README.md)                                                                                     | The research ecology's reference scenarios                    |
| [`noeterra-civilization/`](benchmarks/noeterra-civilization/README.md)                                                         | Civilization experiments, refusals included                   |

[`research/`](research/) keeps the scripts and notes investigations ran with, as
they ran, beside what they found: the replay diagnosis
([`echo-replay/`](research/echo-replay/README.md)), the organism's rehearsal
([`echo-organism-continuation/`](research/echo-organism-continuation/README.md)),
the collision repair ([`echo-collision/`](research/echo-collision/README.md)) and
the store's commit cost ([`life-store/`](research/life-store/README.md)).

## Method, governance and operations

- **Method:** [evaluation philosophy](EVALUATION_PHILOSOPHY.md),
  [validation](VALIDATION.md), [government evaluation](GOVERNMENT_EVALUATION.md).
- **Security:** [threat model](THREAT_MODEL.md), [SECURITY.md](../SECURITY.md).
- **Operations:** [deployment](DEPLOYMENT.md),
  [continuous life](BETHESDA_CONTINUOUS_LIFE.md), [live garden](LIVE_GARDEN.md),
  [future backend](FUTURE_BACKEND.md).
- **The worlds:** [controls](CONTROLS.md), [accessibility](ACCESSIBILITY.md),
  [spatial analysis](SPATIAL_ANALYSIS.md), [model comparison](MODEL_COMPARISON.md).
- **Lineage:** [the R.A.I.N. migration](RAIN_MIGRATION.md);
  investigations of [Open Historia](research/OPEN_HISTORIA_ANALYSIS.md),
  [Pax Historia](research/PAX_HISTORIA_ANALYSIS.md) and the products in
  [`rea-research/`](rea-research/capability-matrix.md).
