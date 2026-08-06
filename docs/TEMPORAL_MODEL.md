# The temporal model

The twin has had a timeline since early on: a year slider that hides anything
whose `observedDate` is later than the selected year. It is useful, and it is
also the whole extent of the model's sense of time — and it quietly conflates
three different dates.

`src/lib/temporal.ts` keeps them apart. This is the document that says which is
which, because getting them confused is not a cosmetic problem: it is how a
publication date becomes a construction date in a reader's head.

## Three dates, never merged

**1. When something happened at the site.** Almost never known.

A first appearance in a cited public scene bounds when a building existed
**by**. It says nothing about when it was built. So a first-appearance event
carries a `latestDate` and no `earliestDate`, and every interface that renders
one is required to say "existed by 2025-09-13; earliest date unknown" rather
than printing the date on its own.

**2. When the evidence became public.** Precisely known.

This is the publication date in the source register, and it is the date that
decides what an analyst could have concluded at a given moment. The CSIS
analysis published in 2026 discusses imagery from 2020; a ledger that cannot
express that distinction is worse than no ledger.

**3. When the change entered this model.** A fact about this repository.

This repository has never recorded per-feature model history, so
`modelVersionIntroduced` is absent on every event and the interface prints "not
recorded by this repository". Filling it with the current model version would be
a guess dressed as provenance.

## The event schema

```ts
interface TemporalEvidenceEvent {
  id: string;
  subjectId: string;
  earliestDate?: string; // almost always absent
  latestDate?: string; // "existed by"
  bestSupportedDate?: string; // only where evidence pins one exactly
  category: TemporalEventCategory;
  before?: string;
  after?: string;
  evidenceClass: EvidenceClassification;
  sourceIds: readonly string[];
  confidence?: number;
  uncertainty?: UncertaintyEnvelope;
  analystNote?: string;
  modelVersionIntroduced?: string; // absent throughout — see above
  publicationDate?: string;
  scope: TemporalScope;
}
```

### Scope

The specification this follows names two scopes. A third is necessary, because
"a source was published" is a real-world fact that is emphatically _not_ a claim
that anything at the site changed, and folding it into either of the others
recreates the conflation this module exists to remove.

| Scope                   | Glyph | Asserts                                            |
| :---------------------- | :---- | :------------------------------------------------- |
| `real-site-claim`       | ◆     | Something was true of the real site by a date.     |
| `evidence-availability` | ❖     | A source became publicly available on a date.      |
| `model-only-change`     | ○     | Something about this reconstruction, not the site. |

### Categories, and the ones that are empty

The schema defines ten categories. Five are populated from the data this
repository holds; five are not, and stay empty.

| Category                     | Populated | From                                                     |
| :--------------------------- | :-------- | :------------------------------------------------------- |
| `first-appearance`           | Yes       | `observedDate` on structures, segments and aprons        |
| `pavement-change`            | Yes       | Taxiways, which the 2025 reporting describes resurfacing |
| `reported-aircraft-sighting` | Yes       | The two dated aircraft records                           |
| `evidence-publication`       | Yes       | `publishedOn` in the source register                     |
| `model-only-change`          | Yes       | Illustrative structures, which have no date at all       |
| `footprint-expansion`        | **No**    | —                                                        |
| `structure-added`            | **No**    | —                                                        |
| `structure-removed`          | **No**    | —                                                        |
| `reclassification`           | **No**    | —                                                        |
| `correction-or-withdrawal`   | **No**    | —                                                        |

`temporalCoverageGaps()` computes the empty list at runtime and `/analysis`
prints it. **An empty category is a coverage gap the interface shows, not
something to fill in with plausible history.** If this project ever corrects or
withdraws a claim, the category is there to record it.

A dated aircraft is a _sighting_, not a construction event. An airframe parked
outside a hangar on one date says nothing about any other date, and the event's
`after` text says so.

## Snapshots

`deriveSnapshot(date)` resolves two independent things per subject and
deliberately does not merge them:

- **Presence** — `established` (a cited source shows it existed by this date),
  `not-yet-evidenced` (the earliest cited evidence is later), or `undated` (the
  model holds no date for it at all). The third is not the same as the second.
  An illustrative solar field has no appearance date because it has never
  appeared anywhere, and treating that as "not there yet" would assert history
  nobody has.
- **Available evidence** — the records whose citing source was _published_ on or
  before the date, and the classification and confidence that follows from that
  subset.

A hangar can be established by a September 2025 scene while the reporting that
identifies it was not published until November. An analyst standing in October
could not have written the November sentence, and the snapshot reflects that.

Snapshot dates come from the ledger itself — `TEMPORAL_SNAPSHOT_DATES` is every
distinct date across all events, ascending. It is derived, not listed, so adding
a dated record adds a snapshot date without anyone maintaining a second copy.

## Change comparison

`compareSnapshots(from, to)` reports:

- subjects added or removed between the dates,
- changed evidence class, confidence, uncertainty and sources,
- newly published and no-longer-published sources,
- the events falling inside the window,
- and a `modelOnly` flag on every row, so a model decision can never read as a
  site change.

It is symmetric and total. Running it backwards is a legitimate question — "what
did we lose confidence in?" — and produces `removed` rows rather than an error.
Output order is fixed (subjects by id, then change kind in declaration order), so
the same pair of dates always yields a byte-identical result and a pasted
comparison is checkable.

## Where it appears

- **`/analysis`** carries the full picture: the snapshot table, the change
  table, the complete event ledger with the three dates in three separate
  columns, and the coverage-gap list. This is the representation that works
  without WebGL.
- **The 3D timeline panel** carries the year slider unchanged, plus the two date
  pickers and a one-line summary, with the full comparison a link away.
- **The dossier** carries a subject's own events, each printing its estimated
  site date, its publication date and its model-entry date on separate labelled
  lines.

## What this model does not do

- **It does not infer undocumented historical states.** There is no
  interpolation between dates and no assumption that an undated feature existed
  at any particular time.
- **It does not render a ghosted earlier state in 3D.** The comparison is
  rendered semantically, and a spatial ghost is deferred — see the README's
  limitations. The information is complete on `/analysis`; only its spatial
  rendering is absent.
- **It does not treat the year slider and the snapshot date as the same
  control.** The slider filters the scene at year granularity and is unchanged.
  The snapshot reads the ledger at day granularity. They answer different
  questions and are kept separate in the store.
