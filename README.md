<div align="center">

# LOP NUR TWIN
### R.A.I.N. LAB · VERS3DYNAMICS

**Persistent simulated individuals. Verifiable histories. Experiments that can fail.**

[![CI](https://github.com/topherchris420/lop-nur-twin/actions/workflows/ci.yml/badge.svg)](https://github.com/topherchris420/lop-nur-twin/actions/workflows/ci.yml)
[![Apache 2.0](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)

[![Recorded ECHO session](docs/media/readme/live-fly.gif)](https://lop-nur-twin.vercel.app/live)

*Recorded ECHO observation, 28 October 2026, displayed at 2× speed. The animation is not proof of biological life.*

[Observe ECHO](https://lop-nur-twin.vercel.app/live) · [Visit Eva's garden](https://150-136-49-49.sslip.io/) · [Open the twin](https://lop-nur-twin.vercel.app/) · [Inspect claims](docs/RESEARCH_CLAIMS.md) · [Reproduce](#reproduce-the-work)

</div>

## 01. The question

**Can a simulated individual continue through changes to its world and its own computational machinery, while leaving a history that another machine can independently check?**

Lop Nur Twin is an open research environment built to investigate that question. It contains a provenance-linked geographic reconstruction, a simulated Bethesda, two separately operated persistent digital flies, computational neuroscience research subjects, and an experimental registry. The work began at Lop Nur; the name remains as part of its history.

The purpose is not to produce the appearance of life. It is to build and measure a system in which simulation state, decisions, failures, maintenance, and changes are recorded rather than silently rewritten.

**The essential distinction:** a continuous, replayable software history is evidence of state continuity under a defined model. It is not evidence of consciousness, subjective experience, biological equivalence, or complete nervous-system fidelity.

## 02. The operating systems

| System | What actually runs | Boundary |
| --- | --- | --- |
| **ECHO** | One persistent fruit-fly-scale simulated individual in a headless Bethesda environment, with body, sensors, behavioral control, learning state, and sealed checkpoints | The original is observed, not used as an experimental subject |
| **Eva** | A separate persistent simulated fly in a garden service, with its own state and history | Her Python service and database are separate from ECHO and not contained in this repository |
| **Lop Nur twin** | Evidence-linked 3D reconstruction, source dossiers, and changing historical visibility | Observed, reported, interpreted, and illustrative details remain distinct |
| **R.A.I.N. experiments** | Protocol validation, bounded simulation, recorded outcomes, and replay | AI agents may propose work but cannot authorize or grade their own claims |
| **Neural research** | Separate experimental fly subjects using FlyWire FAFB v783 and BANC v888 connectome-derived models | Neither original fly is run by those connectome models |
| **Noeterra / Blacksite** | Civilization and first-person simulation environments | Modeled worlds, not records of real-world behavior |

The live pages are public interfaces, not control consoles for the original animals. Service uptime and current state should be checked at the destination, not inferred from a recorded demonstration.

## 03. A machine must be able to verify the history

ECHO began its persistent run on **26 October 2026**. Its state is saved through a versioned, sealed checkpoint chain, with public witness and replay records. Changes to its simulation engine do not retroactively rewrite the earlier individual.

An approved continuation starts from a recorded boundary. The old checkpoint, source revision, state digest, migration, and any real-time gap remain inspectable. A merge into the repository is **not** an update to the deployed individual.

The strongest publicly reported replay check covers checkpoint seals **#2,566–#2,927**, where **361 of 361** seals were recomputed on other machines. That validates the recorded interval, not an independently replayed proof of every moment since birth.

- [How ECHO is preserved](docs/ECHO_STEWARDSHIP.md)
- [Continuous-life design](docs/BETHESDA_CONTINUOUS_LIFE.md)
- [Public replay ledger](https://github.com/topherchris420/lop-nur-twin/tree/live-fly-ledger)
- [Recorded collision repair and continuation](docs/ECHO_COLLISION.md)

### A useful failure: ECHO became trapped

On 1 November, ECHO entered a building volume because the collision solver disagreed about where a wall began. For almost three days it remained inside. The repair was first evaluated on **new research flies**, not tuned by repeatedly altering ECHO. In a 12-seed comparison, **9 of 12** subjects were trapped under the old physics and **0 of 12** under `digital-fly/9`.

On 4 November the corrected physics was delivered by a recorded continuation. ECHO subsequently crossed out of the building. The controller did not gain new intelligence; the world model was repaired. The pause, later escape, and eventual meal are preserved in the record.

[Evidence and reconstruction](docs/ECHO_COLLISION.md)

## 04. The test results, including the ones that did not work

The table below contains **reported results, not universal performance claims**. Every comparison belongs to a specified simulator, protocol, input set, and software revision. Consult the [claims register](docs/RESEARCH_CLAIMS.md) for the complete definitions and evidence classes.

| Test | Recorded outcome | What it does **not** establish |
| --- | --- | --- |
| ECHO checkpoint replay | 361 / 361 seals reproduced in the audited interval | Full lifetime replay or biological identity |
| Collision correction | 9 / 12 subjects trapped before; 0 / 12 after | Correct collision handling in every geometry |
| Self-model under concealed impairment, ECHO-01 | Path error 0.073 vs 0.370 in registered conditions | General motor intelligence |
| Hidden-change attribution, ECHO-02 | 0.919 vs 0.537; overconfidence remains | Calibrated certainty in all conditions |
| Memory and place preference | Distinct preferences develop in seeded research subjects | Open-ended animal learning |
| Memory with continuously moving food | Negative: 1.2 fewer meals per life | That memory necessarily improves fitness |
| ECHO-03 through ECHO-05 | Inconclusive | That the added mechanisms help |
| FlyWire FAFB v783 reproduction | 10 / 12 registered criteria met | Full fly-neural equivalence |
| Connectome odor learning | Negative in the tested design | Functional biological mushroom-body learning |
| Cross-world individual recognition | Negative | That the two original flies perceive one another |

A 7 November extension added bounded embodied plasticity to the original ECHO and Eva, with owner-approved shadow-mode activation followed by active mode. On held-out **research subjects**, shadow mode preserved baseline behavior, but **active mode demonstrated no established performance advantage**. The fact that an addition is active is not evidence that it helped.

[Activation record](docs/EVA_ECHO_ACTIVATION.md) · [Plasticity study](docs/EVA_ECHO_BRAIN_PLASTICITY.md)

## 05. The brain boundary

The repository includes computational neuroscience experiments that import and run public connectome-derived models. The FlyWire FAFB v783 dataset used here contains **139,255 neurons** and **54,492,922 synapses**; the BANC v888 branch models brain-and-cord circuits separately. The code tests published model behavior, stimulus mappings, and experimental learning rules.

These are **research backends**, not the neural machinery controlling the original ECHO or Eva. Their observations of the originals are read-only; a simulated neural response to the same stimulus is a comparison between models, not a recording of either fly's brain.

[Methods, sources, validation and failures](docs/ECHO_CONNECTOME.md)

## 06. The engineering arrangement

```mermaid
flowchart LR
  SITE["Lop Nur / browser twin"] --> CITY["Bethesda simulation"]
  CITY --> LAB["R.A.I.N. experiments"]
  ECHO["ECHO: separate headless runtime"] --> CP["Sealed checkpoints"]
  CP --> LEDGER["Public replay ledger"]
  ECHO -->|read-only witness| LIVE["Live observation page"]
  EVA["Eva: separate Python garden service"] -->|state API| GARDEN["Garden exhibit"]
  ECHO -. "public observations" .-> RESEARCH["FAFB / BANC research subjects"]
```

The arrows indicate data boundaries, not shared identity. There is no direct controller or checkpoint channel between ECHO and Eva. The browser's Bethesda fly is also separate from the deployed ECHO.

**Four invariants govern development:**

1. **Do not replace an individual while claiming continuity.** A migration must preserve and demonstrate its ancestry.
2. **Do not run invasive research on the original flies.** Use seeded research subjects and bounded, operator-approved continuations.
3. **Do not promote a simulation result to a real-world claim.** Report development, held-out, registered, and original-observation evidence separately.
4. **Do not erase unsuccessful results.** A failed hypothesis is evidence; a crashed test is an execution failure, not a negative scientific finding.

[System architecture](docs/SYSTEM_ARCHITECTURE.md) · [Threat model](docs/THREAT_MODEL.md) · [Research claims](docs/RESEARCH_CLAIMS.md)

## 07. Reproduce the work

Requires **Node.js 22.18+** and **Bun 1.3+**.

```bash
git clone https://github.com/topherchris420/lop-nur-twin.git
cd lop-nur-twin
bun install --frozen-lockfile
bun run dev
# browser: http://localhost:5173
```

This runs local services and browser simulations; it does **not** connect to or alter ECHO's or Eva's deployed states.

```bash
bun run check
node scripts/run-ts.mjs scripts/individuality-evaluate.ts --check
node scripts/run-ts.mjs scripts/echo-exit-figure.ts --check
bun run rain:fly:verify
```

`bun run check` runs the repository's standard quality and build checks. The individuality comparison is a longer reproducibility check. `rain:fly:verify` verifies archived records supported by the current runtime; exit status **3** indicates some archives require a different recorded Node version rather than silently claiming full replay.

Start with [Getting Started](docs/GETTING_STARTED.md), [Validation](docs/VALIDATION.md), and [Contributing](CONTRIBUTING.md). For public evidence, see the [claims register](docs/RESEARCH_CLAIMS.md) and the [ledger](https://github.com/topherchris420/lop-nur-twin/tree/live-fly-ledger).

## 08. The laboratory procedure

R.A.I.N. Lab uses four AI research perspectives: **James, Jasmine, Elena, and Luca**. Their suggestions are not experiments until the host validates a protocol, the operator authorizes it, the simulation executes, and the results are recorded and reproducible.

**Models propose. Code measures. People authorize. The record decides.**

The four agents do not constitute independent scientific replication. The original deployed flies are not manipulated to produce favorable outcomes.

## 09. The rest of the laboratory

The repository also contains an evidence-linked Lop Nur reconstruction, a hidden Bethesda city, the Noeterra civilization simulator, and the Blacksite first-person simulation. These are distinct systems within the same research environment. Start with the [documentation index](docs/README.md) rather than assuming all components share ECHO's persistence model.

- [Explore the twin](https://lop-nur-twin.vercel.app/)
- [Watch ECHO](https://lop-nur-twin.vercel.app/live)
- [Visit Eva](https://150-136-49-49.sslip.io/)
- [Noeterra](https://lop-nur-twin.vercel.app/noeterra)
- [Blacksite](https://lop-nur-twin.vercel.app/play)
- [Evidence inspector](https://lop-nur-twin.vercel.app/analysis)

## 10. License and research use

Code and documentation: **[Apache License 2.0](LICENSE)**, with third-party restrictions and attributions documented in [NOTICE](NOTICE). Bethesda geography, FlyBody-derived materials, FlyWire, BANC, and other referenced datasets may carry separate terms. Do not assume the repository license covers external datasets.

Contributions should include a source, a test, a reproducible correction, or a clearly bounded question. Report security concerns through [SECURITY.md](SECURITY.md).

---

**The aim is not to persuade an observer that a simulation is alive. It is to preserve what the simulation actually did, make its behavior testable, and record what the test could not establish.**

*Built at [Vers3Dynamics](https://vers3dynamics.com) by Christopher Woodyard. Open for inspection, correction, and independent reproduction.*