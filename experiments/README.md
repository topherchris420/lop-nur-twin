# experiments/

Unfinished code, kept deliberately. **Nothing here ships.**

`experiments/` sits outside `src/`, outside the `tsconfig.json` `include` list and
outside the Vite build graph. It is not type-checked, not linted for production
rules, not bundled, and not reachable from any route. Production source must
never import from it — `bun run build` cannot see these files, so an import from
`src/` would fail the build rather than quietly pull experimental code into a
release.

## Why it is kept rather than deleted

These are subsystems whose build agents were cut short. The logic in them is
worth reading and, in places, worth finishing; deleting them would throw away
design work that is expensive to redo and cheap to store. They are parked here
until someone finishes one.

## What is here

`game-modes/` — first-person match-mode work for the Blacksite simulation at
`/play`, moved verbatim from the former `src/game/_wip/`:

| File                    | What it was going to be                                                  |
| ----------------------- | ------------------------------------------------------------------------ |
| `modes/mode.ts`         | Match-mode state machine (round flow, mode registration, transitions)     |
| `modes/scoring.ts`      | Scoring, streak accounting and end-of-round tallies                       |
| `modes/killstreaks.ts`  | Killstreak reward definitions and their activation rules                  |
| `modes/spawns.ts`       | Mode-aware spawn selection over the compound's ground zones               |
| `pathfinding.ts`        | Grid pathfinding over the navmesh, for bot navigation beyond direct steer |

## Known reasons they do not compile

The files are preserved byte-for-byte, so the move is a pure rename in the Git
history and a reviewer can diff them against the version that was excluded
before. That means their import specifiers are still written for their old home
under `src/game/`, and two of them reference modules that were never written:

- Relative imports such as `../core/types`, `../physics/collisionWorld` and
  `../weapons/arsenal` resolved from `src/game/_wip/`. From here they resolve to
  nothing. Finishing a file means repointing these at `src/game/…`.
- `modes/mode.ts` imports `./internal`, which does not exist anywhere in the
  repository.
- `pathfinding.ts` imports `./navmesh`; the real module is `src/game/ai/navmesh.ts`.

## Finishing one

1. Move the file (and only it) back under `src/game/`.
2. Repoint its imports and supply whatever it references that was never written.
3. Make `bun run build` pass — `src/` is strict-checked with no exclusions, so
   the file has to hold up to the same rules as everything else.
4. Add coverage: `tools/smoke.mjs` and `tools/engagement.mjs` are where a match
   subsystem proves it actually plays.

Match mechanics must not touch analytical state. Evidence classification,
confidence, temporal events, uncertainty, model manifests and bookmarks are
downstream of the evidence ledger and stay that way — see `CONTRIBUTING.md`.
