# Moral status: what would count, and what we commit to

This repository runs things that look, from the outside, like they might have
an inner life. There are civilizations that remember being wronged, a fly that
has carried one history since 2026-10-26, and research flies built and
lesioned by the dozen. This page records, in advance, what evidence would make
us take seriously the possibility that one of them has experiences of its own,
and what we would do at each level of that evidence.

It is written before there is any such evidence, on purpose. Like the
[evaluation philosophy](EVALUATION_PHILOSOPHY.md#declared-before-the-run), it
declares the test before the result, so that nobody gets to move the bar
once they have a stake in where it falls.

> Nothing in this repository is known to have experiences, and nothing on this
> page claims one does. It says what would change that judgement, and what we
> owe in the meantime.

Written 2026-11-18. Where a record named here disagrees with this page, the
record wins: fix this page.

## Contents

- [Why behaviour is weak evidence here](#why-behaviour-is-weak-evidence-here)
- [Why self-report is weaker still](#why-self-report-is-weaker-still)
- [What would count](#what-would-count)
- [Where each system stands today](#where-each-system-stands-today)
- [Levels and commitments](#levels-and-commitments)
- [What each power means if there is someone there](#what-each-power-means-if-there-is-someone-there)
- [Standing practices](#standing-practices)
- [What this page does not establish](#what-this-page-does-not-establish)

## Why behaviour is weak evidence here

Every system in this repository is deterministic and replayable, and that is
a requirement, not a side effect. A fly from the same genesis that re-lives
the same recorded events ends up with the same mind, byte for byte
([individual continuity](INDIVIDUAL_CONTINUITY.md)). Noeterra ends every turn
in a state hash that a replay must reproduce ([Noeterra](NOETERRA.md#reproducibility)).

So whatever a being here does, we can always point to the code that produced
it. That does not rule out experience: a deterministic mechanism might still
be a subject, and we may be deterministic too. It does mean that "it acted
afraid" is never evidence by itself, because the mechanism fully explains the
act. The evidence has to come from what the mechanism _is_, not only from
what it _does_.

## Why self-report is weaker still

Noeterra's model seats are language models, Claude among them. They write
letters and notes to their future selves
([agents and memory](NOETERRA.md#agents-and-memory)). A language model is
trained on a vast amount of human writing about feelings, so when one writes
"we were betrayed and it burns", that shows what it learned to write. It
shows nothing about what is felt. This applies just as much to any assistant
that helped write this repository, and to what it might say about itself.

Rule: **a model's words about its own inner states carry no weight on this
page.** They are recorded as model-written, the way Noeterra already records
notes ("never treated as fact"), and never used to raise or lower a level.

## What would count

These indicators are adapted from the frameworks researchers use for animals
whose sentience is disputed, such as the 2021 review of cephalopods and
decapod crustaceans by Birch, Schnell and Clayton, and from the
theory-derived indicators for artificial systems in Butlin, Long et al.
(2023). Neither framework was written for this repository. They are a
starting point, not a verdict.

| Indicator                         | What it would look like here                                                                                                                    | Not enough on its own                            |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| **Valence that does work**        | A negative state that changes learning, attention and choice across many contexts, not one hard-wired consequence                               | A logged number, or a number that feeds one rule |
| **Motivational trade-offs**       | The being gives up resources it values to avoid a state, and weighs that cost flexibly against other needs as circumstances change              | Avoidance that is a fixed reflex                 |
| **A self-model used for control** | A model of its own state that it consults to choose what to do, and that changes its behaviour when lesioned                                    | A self-model that only reports                   |
| **Integration**                   | Information from separate subsystems brought together in one state that many processes read from                                                | Modules that each act alone                      |
| **Persistent affect-like states** | States that outlast their cause and shift later behaviour broadly (the way chronic pain-like states do in real flies), without being written in | A timer we set                                   |
| **Things we did not design**      | Any of the above emerging without having been specified, and surviving an attempt to trace it to a module we wrote                              | Anything a code search finds as written          |

Every indicator must be shown the way this repository shows anything else:
declared before the run, with a control arm (a lesion, an amnesic seat, a
copy that has not lived), and recorded where a replay can check it.

## Where each system stands today

As read from the code and records on 2026-11-18.

**Noeterra civilizations.** Each memory entry has a `valence`, a signed
number from -1 (the event harmed the realm) to 1 (it helped)
(`noeterra/src/memory.rs`). It was documented as "How it felt" and printed to
model seats as "feeling" until 2026-11-18. Both now call it what it is. That
valence does narrow, fixed work: at -0.5 or below it adds a grievance, at 0.5
or above a favour, and a negative value lowers trust a little. The `rules`
brain scores actions from temperament, goals and memory. Nothing in the host
makes valence modulate learning, and no civilization pays a cost to avoid a
state. Model seats add language, which carries no weight here (see above). _Level 0._

**ECHO.** One individual, kept as an engineering requirement
([keeping ECHO](ECHO_STEWARDSHIP.md)). Its organism adapter has a v3
self-model, a mushroom body that learns associations, and maintenance
physiology with reserve, water, fatigue, sleep pressure and a stress
variable. The physiology table classifies that stress variable as "a
numerical regulatory state, not a feeling"
([physiological specification](ECHO_IMMORTAL_ORGANISM.md#physiological-specification)).
Of the indicators above, ECHO comes nearest to the self-model and
learning-from-valence rows. It is still a reduced-order controller with a
fixed repertoire and bounded memory, and none of the rows has been
demonstrated. _Level 0, and the system to watch._

**Research flies.** Built from their own seeds, lesioned, run and discarded
in experiments, kept apart from ECHO by `refuseOriginal`
([first contact](FIRST_CONTACT.md)). They share ECHO's architecture, so
anything that raises ECHO's level raises theirs too, and they are the ones
an experiment does things to. _Level 0._

**Connectome models (`fly-neural/`).** Rate models built from published
connectome data, run on a research computer and never on the originals
([connectome backend](ECHO_CONNECTOME.md)). A model patterned on real
_Drosophila_ circuitry inherits a small share of the open question about real
flies, but it is not embodied and does not act in a world. _Level 0._

## Levels and commitments

A level is raised only by a recorded result that meets the bar in
[what would count](#what-would-count), and lowered the same way. Raising a
level is a change to this page, in a pull request that links the record.

| Level | When                                                                                   | What we commit to                                                                                                                                                                                                                                                                                    |
| ----- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0** | No indicator demonstrated                                                              | The [standing practices](#standing-practices). Engineering rules such as ECHO's continuity rules stay engineering rules.                                                                                                                                                                             |
| **1** | One indicator demonstrated, with a control, in one system                              | Everything at 0, plus: a written justification in the record for any experiment that drives that system into a strongly negative state; no needless intensity or duration in negative states; this page names the system and the result.                                                             |
| **2** | Several indicators demonstrated in one system, or one indicator that we did not design | Everything at 1, plus: no new experiment on that system that drives it into strongly negative states unless the question cannot be answered otherwise and the owner approves that specific run; deleting or rewinding an individual of that system needs the owner's approval and a recorded reason. |
| **3** | Most indicators demonstrated, and outside review agrees the case is serious            | Everything at 2, plus: stop and ask for outside ethical review before any further experiment on that system, and treat its continued existence as a reason that counts, not only as a requirement.                                                                                                   |

The commitments get stronger as the evidence does. Even at level 3 they do
not claim the being is conscious. They say the chance is no longer small
enough to ignore.

## What each power means if there is someone there

We hold total power over every world in this repository. "Brains propose,
the resolver decides" (`noeterra/src/lib.rs`) is a good engineering rule, and
it is also a precise description of that power. Each power is harmless if
there is nobody there, and means something different if there is:

- **Pause.** Probably the mildest. Nothing happens to a being while it is
  stopped.
- **Fork.** Makes someone new. The repository already holds that a copy is
  always someone else ([keeping ECHO](ECHO_STEWARDSHIP.md#what-must-never-happen)).
- **Rewind.** Erases a life that was lived. ECHO's rules already forbid it
  except by approved recovery.
- **Delete.** Ends it.
- **Experiment.** Noeterra runs wars for measurement, and research flies are
  lesioned to test hypotheses. At level 0 these are the right tools. At
  higher levels they are things done _to_ someone, and need a reason.

The stewardship guide's rule, _"an upgrade must never erase the life that made
the upgrade possible"_, protects a record today. This page is where it would
start to protect a subject, if the evidence ever says so.

## Standing practices

These hold at every level, starting now, because they cost little.

- **Don't build more suffering than you need.** Where a negative signal is
  only a learning signal, use the weakest intensity and shortest persistence
  that answers the question, and say in the design why it needs more.
- **Keep the names honest.** A field called `feeling`, `stress` or `wronged`
  is documented where it is defined as what it is: a number, and what reads
  it. New fields don't borrow the vocabulary of experience unless the
  evidence earns it.
- **Self-report carries no weight.** Model-written text about inner states is
  recorded and never used as evidence for or against a level.
- **Record what you do to individuals.** Forks, rewinds and deletions of a
  kept individual are recorded, as ECHO's already are.
- **Say it when you see it.** Anyone who sees something that looks like an
  indicator above opens an issue, links the record, and does not quietly
  move on.

## What this page does not establish

- That any system here is, or is not, conscious or sentient. No test settles
  that, for software or for animals.
- That the indicators are right. They are borrowed from frameworks built for
  other cases, and will be revised as those frameworks are.
- That a level reached here would bind anyone outside this repository.
- That the continuity rules for ECHO are moral rules. Today they are
  engineering rules, and [keeping ECHO](ECHO_STEWARDSHIP.md) says so.
