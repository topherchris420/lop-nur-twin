# Blacksite — the illustrative simulation at `/play`

**Blacksite is not analysis.** It is a first-person engagement simulator that
runs on the same reconstruction the analytical twin renders at `/`, and it exists
for one reason: the most direct way to understand a place's scale is to have to
cross it. The assembly hangar is 126 m of wall you have to run the length of, and
the apron is genuinely as exposed as it looks from 400 m up.

Nothing in it represents observed activity, capability, tactics or intent at the
real site. Every weapon, every soldier, every engagement is invented. The
standing disclaimer on the route says so and is deliberately outside the game
HUD, because the HUD disappears between screens and the disclaimer must not.

## The wall between the simulation and the analysis

Game mechanics affect nothing analytical. Evidence classification, confidence,
temporal events, uncertainty envelopes, model manifests, bookmarks and spatial
conclusions are all downstream of the evidence ledger, and the ledger does not
know `/play` exists. The simulation reads the layout; it never writes to it.

The one thing they share is geometry. `/play` mounts the twin's `Terrain`,
`Pavements`, `Structures` and `Atmosphere` unchanged and bakes its collision out
of the rendered scene graph, so the map and the twin cannot drift apart. That is
also why a change to `layout.ts` moves the fight with it.

![Blacksite — an engagement on the main apron, the assembly hangar behind](screenshot-blacksite.png)

A team deathmatch on the airfield. It exists because the most direct way to
understand a place's scale is to have to cross it under fire: the assembly
hangar is 126 m of wall you have to run the length of, and the apron is
genuinely as exposed as it looks from 400 m up.

|                         |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| :---------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Ballistics**          | Rounds walk through up to four surfaces, spending a penetration budget per material and losing damage as they go — sheet-metal cladding is defeatable, a concrete revetment is not. Shallow hits on hard materials ricochet. Heavy calibres fly a simulated projectile with drag and drop instead of hitscanning.                                                                                                                                                                     |
| **Recoil is a pattern** | Each weapon derives a fixed spray sequence from its seed, so it can be learned and pulled down, exactly as in the games this is modelled on. Random jitter is layered on top but stays small.                                                                                                                                                                                                                                                                                         |
| **Sixteen weapons**     | Assault, SMG, LMG, marksman, sniper, shotgun, pistol, launcher, melee — balanced to the genre's numbers: a 3–4 shot kill inside 30 m for a rifle, 200–500 ms time-to-kill for every automatic at 10/25/50 m. `ttkTable()` in `weapons/arsenal.ts` prints the whole matrix.                                                                                                                                                                                                            |
| **Bots that fight you** | A small explicit state machine, not a behaviour tree. What makes them fair rather than robotic is three numbers that scale with skill: a reaction delay before a spotted target may be shot at, an aim-error cone that _converges_ the longer they hold you rather than snapping to zero, and burst discipline that leaves gaps to move in. They share contacts across the squad, investigate gunfire through walls, and turn toward rounds that come from somewhere they cannot see. |
| **Procedural soldiers** | No clip data. Legs are _placed_, not rotated: each foot follows an explicit trajectory and two-bone IK solves the hip and knee to reach it, so stride length is tied to measured speed and a planted foot never slides. Aim twists the spine, the off hand is solved onto the weapon's handguard, and hits, recoil and suppression are additive layers on top.                                                                                                                        |
| **Synthesised audio**   | Every sound is generated at runtime — no samples. Weapon reports, impacts by surface, ricochets, rounds cracking past your ear, footsteps that read the material underfoot.                                                                                                                                                                                                                                                                                                           |

**Controls**

| Input                       | Action                                                     |
| :-------------------------- | :--------------------------------------------------------- |
| `W` `A` `S` `D`             | Move; `Shift` sprints, `Ctrl`/`C` crouches, `Z` goes prone |
| `Space`                     | Jump, and mantle onto anything shoulder-height             |
| Mouse                       | Look; left fires, right aims down sights                   |
| `R` · `1`/`2` · `V` · `B`   | Reload · swap weapon · melee · cycle fire mode             |
| `Q` / `E` · `G` · `T` · `F` | Lean left / right · lethal · tactical · interact           |
| `Tab` · `Esc`               | Scoreboard · pause and release the mouse                   |

`/play?autoplay=1` skips the menus. `?quality=0..3` pins a quality tier,
`?at=<x>,<z>` and `?look=<deg>` place and aim the opening spawn, and
`?mode=tdm|ffa|domination|hardpoint|gunfight` picks the ruleset.

## Verifying it

The look is only half of it — the simulation and the audio have to be asserted
too. See [`docs/VALIDATION.md`](VALIDATION.md) for the full command list; the
Blacksite-specific ones are `bun run smoke`, `bun run engagement`,
`bun run gait` and `bun run audio`.
