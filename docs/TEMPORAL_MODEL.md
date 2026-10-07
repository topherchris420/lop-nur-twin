# The temporal model

The twin's time axis is the **evidence timeline**: one control whose stops are
the dates the temporal ledger holds — a source becoming public, a feature first
seen in imagery — and at each of which the scene draws what someone reading
public sources that day could have drawn.

It replaced a year slider labelled "construction timeline", which was wrong in
two ways. Its dates were when things were first _seen_, never when they were
built. And it drew twenty-three buildings in 2021 that no cited evidence placed
anywhere before a September 2025 scene, because they had simply been left
undated.

`src/lib/temporal.ts` keeps three different dates apart. This is the document
that says which is which, because getting them confused is not a cosmetic
problem: it is how a publication date becomes a construction date in a reader's
head.

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

It is recorded apart from the evidence, in `model-history/`, and never written
into a site claim. Each **revision** there is the release manifest one commit on
`main` produced, re-derived by running _that commit's own_ generator with
`SOURCE_DATE_EPOCH` pinned to its commit time and kept byte for byte. A revision
is recorded wherever what the manifest says (everything but its timestamp and
package version) differs from the commit before it. `bun run model:record`
appends them; `bun run model:verify` (and CI) re-runs every one and requires the
same bytes; and the build refuses a model that is not its own latest revision,
so the record is complete by construction from where it begins.

It begins at the first manifest that digested each subject (`088c729`,
2026-08-05). Earlier manifests hash the model as a whole and name no subject,
so a subject present there entered the model **by** revision 1, at an unknown
earlier time — the same "existed by" discipline the site dates follow. A
subject added later entered **in** the revision that first carries it.

What changed, per subject, is read off its four digests (`modelHistory.ts`).
Its placement digest also covers the date it was first observed, so where that
date moved too the change is reported as "placement or first-observed date",
never as a move it may not have been. A dated evidence event entered the model
when its subject's first-observed date last changed. Measurements, the site and
the terrain carry no per-subject digest, and their entry prints "not recorded"
rather than borrowing a neighbour's.

Until 2026-10-07 this repository recorded none of this and the interface printed
"not recorded by this repository" against every claim. Filling that in with the
current version would have been a guess dressed as provenance; re-deriving it
from the repository's own history is a record.

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

| Category                     | Populated | From                                                      |
| :--------------------------- | :-------- | :-------------------------------------------------------- |
| `first-appearance`           | Yes       | `observedDate` on structures, segments and aprons         |
| `pavement-change`            | Yes       | Taxiways, which the 2025 reporting describes resurfacing  |
| `reported-aircraft-sighting` | Yes       | The two dated aircraft records                            |
| `evidence-publication`       | Yes       | `publishedOn` of every source a claim in the ledger cites |
| `model-only-change`          | Yes       | Illustrative structures, which have no date at all        |
| `footprint-expansion`        | **No**    | —                                                         |
| `structure-added`            | **No**    | —                                                         |
| `structure-removed`          | **No**    | —                                                         |
| `reclassification`           | **No**    | —                                                         |
| `correction-or-withdrawal`   | **No**    | —                                                         |

`temporalCoverageGaps()` computes the empty list at runtime and `/analysis`
prints it. **An empty category is a coverage gap the interface shows, not
something to fill in with plausible history.** If this project ever corrects or
withdraws a claim, the category is there to record it.

A publication event is classed by what the ledger says that source supports —
the strongest classification of any claim citing it — never by the kind of
source it is. Classing it by role once made the CSIS and SWF analyses
"observed" when every claim they support here is reported. A method reference
that no claim cites (the Sentinel-2 User Handbook) makes no event: its
publication changes nothing anyone could conclude, so it is not a date on which
the evidence changed, and the timeline no longer opens in 2015 on a stop where
nothing differs from the next.

Illustrative content has no evidence date at all. An illustrative pavement or
building may name the scene it was checked against, but that scene does not
resolve it, so `recordKnowability()` treats every illustrative record as the
model's own (`model-internal`) and the claim inspector prints "none" and
"never" rather than the scene's date.

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
- **Available evidence** — the records whose claim was _knowable_ on or before
  the date, and the classification and confidence that follows from that subset.
  A record is knowable from the later of its source's publication and the
  observation it rests on (`recordKnowability()` in `evidence.ts`, the only
  place that decides it). A source cannot attest what had not yet been observed,
  and the validator rejects a record that tries.
- **Publicly established** — both at once: established by the date, on evidence
  knowable by the date. This is what an analyst standing on that date could have
  drawn, and it is what the scene draws solid.

A hangar can be established by a September 2025 image while the reporting that
identifies it was not published until November. An analyst standing in October
could not have written the November sentence, and the snapshot reflects that:
the hangar is _established_ on 2025-09-28 in hindsight, and _publicly
established_ only from 2025-11-04.

Two bugs made the snapshot claim knowledge before it existed, and both are now
rejected by the validator. The 2025 build-out cited the June 2021 NPR report, so
in the 2021 snapshot it read as publicly reported four years before it was first
seen. And twenty-three buildings cited the 2015 Sentinel-2 User Handbook as a
second source, so in 2015 they read as interpreted from a sensor manual. The
handbook is now a method reference on the uncertainty envelope, not a record.

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
- **The 3D evidence timeline** (`TimelineControl.tsx`) scrubs the ledger's dates,
  with "now" — the model's current state — at the end. It says what happened on
  each date (sources published, features first seen) and how many dated claims
  were publicly established. The scene, the minimap, the site index and the
  measurement ruler all read one three-valued predicate (`drawState.ts`):
  **solid** when publicly established, **outline** when today's model holds it
  but the evidence of that date does not establish it, **hidden** when the
  evidence mode withholds it. Illustrative content is an outline at every past
  date — it has never been established anywhere — and animated scene dressing
  is left out of past dates entirely.
- **The claim inspector** (the dossier, and the highlighted row on `/analysis`)
  opens with what could be said on the timeline date, and prints the site date,
  the publication date, the knowable-from date and the model-entry date on
  separate labelled lines.

## What this model does not do

- **It does not infer undocumented historical states.** There is no
  interpolation between dates and no assumption that an undated feature existed
  at any particular time.
- **It does not read an outline as absence.** An outline means the model
  contains this today and the public evidence of that date does not establish
  it. It never means the thing was not there. The interface says so wherever an
  outline appears.
- **It does not animate between dates.** There is no interpolation and no
  growth sequence; each stop is a snapshot of what the evidence supported then.
- **It does not say when a claim entered this model before the record begins.**
  The model history starts at the first manifest that digested each subject;
  anything present there entered "by" it, and earlier is unknown.
