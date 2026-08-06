# Comparing two model manifests

`public/model-manifest.json` answers "is the copy I am looking at the copy that
was reviewed?". `/compare` answers the follow-up: **what changed between two
builds, and is it the kind of change I need to re-review?**

## Why a single moving hash was not enough

Before this release, a build that reworded a description and a build that moved
a hangar 40 m produced the same signal: `evidenceLedgerHash` is different. A
reviewer had no way to tell them apart short of reading the diff.

Manifest schema **1.1.0** adds a per-subject digest with four separate hashes,
because the four questions a reviewer asks about a change are different
questions:

| Hash              | Answers                                               |
| :---------------- | :---------------------------------------------------- |
| `geometryHash`    | Did this thing move, turn, or resize?                 |
| `evidenceHash`    | Did its classification, confidence or sources change? |
| `wordingHash`     | Did only the prose describing it change?              |
| `uncertaintyHash` | Did what we admit not knowing about it change?        |

A build that only rewords a description moves `wordingHash` and nothing else,
which is what lets `/compare` report "documentation only" without guessing.

## Change categories

Differences are grouped into five categories, each with a glyph so the grouping
never depends on colour:

| Category         | Glyph | What it means                                                                            |
| :--------------- | :---- | :--------------------------------------------------------------------------------------- |
| Analytical model | ▲     | Geometry moved, resized, or a subject was added or removed. Needs a spatial re-review.   |
| Evidence         | ◆     | A classification, confidence rank, cited source or record count changed.                 |
| Uncertainty      | ◇     | A tolerance, an identification level or a temporal bound changed.                        |
| Documentation    | ¶     | Only the wording changed. No claim and no geometry moved.                                |
| Release metadata | #     | Version, generation time, schema version, validation status. Says nothing about content. |

## What a comparison cannot see

**An empty diff means the manifests agree, not that the builds are identical.**
The page says so, and lists what is outside the manifest by design:

- **Shader, post-processing and lighting work.** Nothing about how the scene is
  lit or graded reaches the manifest, so two builds that look completely
  different can produce an identical diff.
- **Camera behaviour, HUD layout and interaction changes.**
- **The Blacksite simulation at `/play`.** It runs on the same geometry and
  contributes no analytical claim, so it is deliberately outside the manifest.
- **Dependency versions.** The CycloneDX and SPDX software bills of materials
  that CI publishes on every run cover those.

## Loading a manifest

Two sources, and only two:

- **This build's manifest**, fetched from the same origin that served the page.
- **A file you choose** from your own machine.

There is deliberately no field for a remote URL. It would turn the page into a
request-forwarding surface and break the offline guarantee to save a download.
CI publishes the manifest as a run artifact for every run, so an earlier build's
file is a download away.

Both sides go through the same validator — trusting the bundled manifest in ways
an imported one is not would defeat the exercise. It refuses, with a message
rather than a throw:

- a file over 1 MB, checked **before** parsing (the manifest this build emits is
  around 46 kB);
- anything that is not valid JSON, or is valid JSON but not an object;
- a manifest missing any of `modelName`, `modelVersion`, `generatedAt`,
  `geometryHash`, `evidenceLedgerHash` or `validationStatus`;
- a schema version that is not a version number;
- a schema **major** version this build does not read. Fields with the same name
  may not mean the same thing, so the comparison is refused rather than guessed.

A schema **minor** difference is a warning, not an error. 1.0 and 1.1 agree on
every field 1.0 defines, and refusing an older manifest would break the tool's
main job. Subject rows missing their identifying fields are dropped; the array is
re-sorted rather than trusted, so a diff's output order never depends on how a
third party ordered their file.

## Determinism

The same pair of manifests always produces the same diff, in the same order:
whole-model fields in declaration order, then subjects by id, then per-subject
fields in declaration order. A pasted diff is reproducible.

Export is available as JSON, CSV (RFC 4180 quoting, so a comma in a value is
safe) and Markdown (pipes escaped, so a value containing one does not break the
table). These are deliberately small, self-contained exports rather than a report
builder.

## Accessibility

`/compare` renders no canvas, mounts no Three.js and starts no timer. That is not
a concession — verification is the task most likely to be done on a locked-down
machine, over a remote session, or by someone reading with a screen reader, and a
comparison tool that needs a GPU is unavailable exactly when it is wanted.

`bun run a11y` gates the route on serious and critical axe violations at the same
threshold as `/analysis`.

## Reproducing a manifest yourself

```sh
SOURCE_DATE_EPOCH=1700000000 bun run manifest
```

`generatedAt` is the only field that moves between runs, and pinning
`SOURCE_DATE_EPOCH` fixes it. Every other field is a pure function of the
committed model data. CI generates the manifest twice with the epoch pinned and
diffs the two files, so a non-deterministic input reaching a hash is a failing
build rather than a discovery someone makes later.
