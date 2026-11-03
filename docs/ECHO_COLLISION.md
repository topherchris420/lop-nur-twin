# ECHO collision repair: a body cannot enter a solid, and the deployed fly's life is kept

**Status: the repair is written and rehearsed on copies. It has not been applied to the
deployed fly.** Until an entry in [The cutover, as it ran](#the-cutover-as-it-ran) says
otherwise, the deployed fly is on `digital-fly/8`, in the building described below.

`digital-fly/9` fixes how a moving body meets a surface, everywhere in
`src/bethesda/fly/`, with no rule about any one building. A recorded continuation
carries the same individual across: one label changes in its graph, and everything else
stays byte for byte. It does not move the body. The repaired physics lets a body that
is already inside a solid leave, and on a copy of the deployed fly that is what happened
([the rehearsal](#the-rehearsal)).

## What went wrong

### The deployed fly

From the journal and the verified backups, read-only. Individual
`04f8c797b6971a46138dabc3fdfde5baae2aa224d3a8f9c0099a7c207dec1921`, release
`bdb7c02a5cf0b9040be81e0435ae49c8ec9e90b1`.

- **It entered building 1011267786 between 17:12:45Z and 17:13:45Z on 2026-11-01**
  (ticks 5279154 and 5279754), after resting on the wall's line at
  (475.033, 12.809, 628.854) two minutes before. It is the only time it has been inside
  a solid in its life.
- **It stayed inside.** From entry to 2026-11-03 21:32Z, 3125 of 3125 one-minute samples
  are inside the same solid. It still moved, by flight, within x 464.76 to 477.63 and z
  628.58 to 646.23.
- **It has not eaten since.** Meals stand at 161, the last at 08:20:41Z on 2026-11-01, 9
  hours before it went in. Before entry it averaged 1.098 meals an hour. Inside, no odor
  reaches it, and the nearest food is 128.25 m away.
- **Its energy is not stable.** It is a sawtooth between 0.080 and 0.350 of capacity, held
  up by artificial maintenance (recovery bouts 33 to 69, maintenance 12.815 to 26.879 J).
  It spends 0.269 J/h inside and spent 0.112 J/h before. Any single reading, such as 33%,
  is one point on that sawtooth.
- **Its record is whole.** 2353 checkpoints, no parent mismatch, 767 archived episodes, 7
  associative updates, and 8 recorded gaps. Its self-model has run no inquiry since it
  went in (909), and it walked no further (2224 m).

### How a body gets in

The first measurements are in [`ECHO_RANGING.md`](ECHO_RANGING.md#flies-inside-buildings).
Three defects combine:

1. `solid` and the ray test disagree about a point on a wall's line. Walking is
   end-checked with steps that shrink at an edge, so a fly can come to rest within about
   2e-14 m of the line, where `solid` says outside and the ray computes a slightly
   negative distance and discards the wall.
2. `move` trusted the ray. A step that hit nothing went ahead, even if it ended inside a
   solid. So did the end of a slide.
3. `settle` stood a landing fly at standing height without checking that point. Where a
   building's floor is lower than a fly stands, as on a slope, the body went into the
   floor. This is seed 205.

And from inside, rays hit every wall normally, so nothing let a body out.

### Which surfaces can do it

On the real map on `digital-fly/8`, a point was bisected onto the line of each surface
from outside, and a 3 mm ray was cast from it toward the surface
([`survey.ts`](research/echo-collision/survey.ts)):

| Solid            | Rays that missed |
| ---------------- | ---------------- |
| Prism wall       | 2774 of 17999    |
| Box              | 1 of 11966       |
| Tapered cylinder | 2 of 6945        |
| Ellipsoid        | 0 of 7946        |
| Sphere           | 0 of 132         |
| Ground           | 0 of 13485       |
| Roof             | 0 of 291         |

So this is general to prism walls, not one building. Only prisms hold a body from inside.
On the map: 1166 prisms, 2739 boxes, 1168 cylinders, 3866 spheres and 140 food sources;
the thinnest box is 0.06 m, the thinnest cylinder 0.11 m, the smallest sphere 0.46 m, and
the shortest wall edge 0.19 m. Under building 533702831, seed 205's, the ground is below
the floor in 424033 of 1149926 cells, and 11 prisms have such a gap at some corner.

## The fix

All of it is in `src/bethesda/fly/`, and `FLY_VERSION` is `digital-fly/9`.

- **`sweep` in `world.ts`** answers what `move` needs: the first surface a step meets.
  It asks `solid` as well as the ray at a millionth of a metre along the step. A ray that
  disagrees is overruled: the step is stopped there, from the line. No epsilon is added
  to any test, so nothing changes for a step that meets no defect.
- **`move`** uses `sweep` for its step and for its slide. A step that would still end
  inside a solid does not happen, and a slide's end is checked the same way.
- **`settle`** refuses a stand whose point is solid, with a reason. A fly with no room to
  stand stays in the air.
- **`keepContact`** drops a contact inside a solid, so a body inside cannot stand there.
- **Coming out is free.** A surface stops a body going in, never one coming out. That
  matters for any solid: a checkpoint can only be repaired if its body can leave.

Walking is unchanged: its steps are at most 0.2 mm and end-checked, against a thinnest
solid of 60 mm. Nothing about what the fly decides changed: no controller, adapter,
learning rule or goal. Only where a command's motion ends can differ, and only where it
would have ended inside a solid.

`src/bethesda/life/acquired/wallGuard.ts`, the research-only stand-in, stays for the runs
made with it, and now has nothing to refuse.

## Continuing the deployed fly

The fly's hash names its version, so this release cannot resume a real `digital-fly/8`
checkpoint under any kind. That is deliberate: no checkpoint is silently run under new
physics. The transition is `scripts/bethesda-life-continue-physics.ts`
(`src/bethesda/life/physicsRepair.ts`), following the
[earlier continuations](ECHO_ORGANISM_CONTINUATION.md):

- **The same individual.** Birth, genesis digest and tick are unchanged. The new
  checkpoint's parent is the exact head.
- **One leaf changes**, `cityFly.fly.adapter.model.state.fly`, the self-model's note of
  which fly it is, from `digital-fly/8` to `digital-fly/9`. Putting it back must give
  the source's graph digest, or nothing is committed.
- **The body is not moved.** `physicsRepairProjection` holds the rest of the graph to the
  source, so a forged repair that moves the body is refused when the chain is checked.
- **One `physics-repair` event**, at the unchanged tick, records the parent, the source
  state and graph hashes, the preserved digest, the source release, the two versions, the
  leaf, where the body was, what was kept, the pause, and this:

  > an environmental repair made by the people who keep this simulation: a change to how
  > the world's surfaces hold a body, not something this fly did, learned or found its
  > way to

- **Every crossing is written down.** From then on the archive records
  `body-left-solid` and `body-entered-solid` with position, mode and physics version.
- **The pause is not lived.** The runner records one gap from the source's last commit.
- **Every older checkpoint keeps its seals,** and stays checked by the rules of its own
  era: `ORGANISM_V1_LIFE` freezes the organism on `digital-fly/8`. As at every commit, the
  store's compaction drops the graph of the checkpoint that leaves its window of four.
