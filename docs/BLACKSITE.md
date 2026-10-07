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

|                         |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| :---------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Ballistics**          | Rounds walk through up to four surfaces, spending a penetration budget per material and losing damage as they go — sheet-metal cladding is defeatable, a concrete revetment is not. Shallow hits on hard materials ricochet. Heavy calibres fly a simulated projectile with drag and drop instead of hitscanning.                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Recoil is a pattern** | Each weapon derives a fixed spray sequence from its seed, so it can be learned and pulled down, exactly as in the games this is modelled on. Random jitter is layered on top but stays small.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Sixteen weapons**     | Assault, SMG, LMG, marksman, sniper, shotgun, pistol, launcher, melee — balanced to the genre's numbers: a 3–4 shot kill inside 30 m for a rifle, 200–500 ms time-to-kill for every automatic at 10/25/50 m. `ttkTable()` in `weapons/arsenal.ts` prints the whole matrix.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Bots that fight you** | A small explicit state machine, not a behaviour tree. Out of their own weapon's range and in sight of the enemy they want, they do not charge across the apron: they bound between points that enemy cannot see, or break sight. What makes them fair rather than robotic is three numbers that scale with skill: a reaction delay before a spotted target may be shot at, an aim-error cone that _converges_ the longer they hold you rather than snapping to zero, and burst discipline that leaves gaps to move in. They share contacts across the squad, investigate gunfire through walls, and turn toward rounds that come from somewhere they cannot see. Against the player they give extra slack: slower first shot, a wider cone aimed at the chest, longer gaps between bursts. |
| **Procedural soldiers** | No clip data. Legs are _placed_, not rotated: each foot follows an explicit trajectory and two-bone IK solves the hip and knee to reach it, so stride length is tied to measured speed and a planted foot never slides. Aim twists the spine, the off hand is solved onto the weapon's handguard, and hits, recoil and suppression are additive layers on top.                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Hands that hold it**  | The first-person gloves are sculpted, not assembled: each is one signed distance field — palm, metacarpals, finger segments, knuckle armour, cuff — meshed once with surface nets. Every finger joint closes until it meets the weapon's own contact shape, so the grip follows the gun; the weapon is carved out of the palm and darkens the glove where they touch. Rifles are held from under the handguard, pistols a two-handed grip whose support fingers close over the firing hand.                                                                                                                                                                                                                                                                                                |
| **Synthesised audio**   | Every sound is generated at runtime — no samples. Weapon reports, impacts by surface, ricochets, rounds cracking past your ear, footsteps that read the material underfoot.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

## Distance, exposure, heat

The compound is a few large buildings standing on a dry lakebed. The ground
between them is where Blacksite is decided, and three rules make it a
different problem from the fighting around the structures:

- **Heat shimmer.** By day the lakebed and the concrete on it bend the air
  above them. Beyond 45 m a figure is _seen_ displaced from where it stands by
  a slow, small drift across the line of sight — about 0.2 m at 100 m, half a
  metre at 150 m — while its body, and every round, stay where they are. The
  person in the seat sees the drift; a brain is told the drifted bearings; the
  aiming controllers and the bots aim at the drifted body. Centre mass at
  120 m is still a fair shot. A head is not a certainty for anyone. At night
  there is no shimmer. (`world/mirage.ts`)
- **Exposure cuts both ways.** A bot that is steady and has held a still
  target stops aiming with an angular cone and converges to a miss radius in
  metres, so standing still in the open is no longer safe at any range; moving
  is. Out of its weapon's range it does not charge across the apron: it bounds
  between points the enemy cannot see, choosing routes the enemy sees least of,
  or holds, crouches and returns fire. A shot that drops a teammate gives the
  shooter's position away, and anyone firing within sight turns heads.
- **The seat's rules are a setting.** By default the seat — whoever is in it —
  takes half damage, deals 1.2× and is aimed at more slowly and loosely: a
  difficulty setting for a person. `?seat=even` removes all of it, so the seat
  fights under the rules the bots fight each other by, which is the footing on
  which two brains, or a brain and a person, can be compared.

These rules exist because a measurement said the ground did not matter. The
story, and the numbers, are in
[`docs/JEV_BLACKSITE.md`](JEV_BLACKSITE.md#the-marksman-exploit).

**Controls**

| Input               | Action                                                                    |
| :------------------ | :------------------------------------------------------------------------ |
| `W` `A` `S` `D`     | Move; `Shift` sprints, `Ctrl`/`C` crouches, `Z` goes prone                |
| `Space`             | Jump, and mantle onto anything shoulder-height                            |
| Mouse               | Look; left fires, right aims down sights                                  |
| `R` · `1`/`2` · `B` | Reload · swap weapon · cycle fire mode                                    |
| `Q` / `E`           | Lean left / right (moves the camera; rounds leave from the un-leaned eye) |
| `Tab` · `Esc`       | Scoreboard · pause and release the mouse                                  |
| `H`                 | Take control back from whichever brain holds the seat                     |

`/play?autoplay=1` skips the menus. `?quality=0..3` pins a quality tier,
`?at=<x>,<z>` and `?look=<deg>` place and aim the opening spawn, and
`?mode=tdm|ffa|domination|hardpoint|gunfight` picks the ruleset.

## Player control: one seat, many minds

The player does not have to be a person. **Player control** on the main and
pause menus — or `?brain=` — puts a different brain in the seat, and every brain
drives the same `InputState` the keyboard and mouse fill. The controller, the
weapons, collision and damage cannot tell who is playing.

| `?brain=` | Who controls the player                                                                                    |
| :-------- | :--------------------------------------------------------------------------------------------------------- |
| `human`   | Keyboard and mouse. The default, and what any other value means.                                           |
| `jev`     | The TypeSafe Jev model, through the server-side `/api/jev/decision` endpoint. Labelled LIVE JEV.           |
| `glide`   | Fastino's Glide, asked Jev's question through `/api/glide/decision`. Labelled LIVE GLIDE.                  |
| `llm`     | A configured language model, asked the same question content through `/api/llm/decision`. LIVE LLM.        |
| `random`  | A seeded random policy over the same controls and timing (`&seed=<int>`). Labelled RANDOM.                 |
| `script`  | A hand-written reference policy (`&policy=marksman\|skirmisher`), same observation and controls. SCRIPTED. |
| `replay`  | A recorded trace played back (`&trace=last`, or the menu's Load trace). Labelled REPLAY. Not live.         |

`?seed=<int>` also pins the match seed; the results screen prints it and offers
**Same seed**, which rebuilds the match from it — the same bots, weapons, spawns
and bot random seed — so a person can start where a model started, or hand
their start to one. It is the same start, not the same match: Blacksite steps
with each frame's own time and paces a brain's decisions in wall time, so two
runs from one seed diverge within seconds, and a replay re-performs a recorded
control stream into a world that may already differ from the one it was
recorded in. `?jevNav=places|steps` chooses how a brain moves (see below);
`?cadence=<ms>` and `?latency=<ms>` set a local brain's decision interval and
answer delay for experiments. `?fallback=random` lets the random policy
stand in, labelled FALLBACK, while Jev or Glide cannot answer. `?record=1` keeps the last
trace in local storage when a match ends. `?autoplay` keeps its meaning: it only
skips the menus. Press **H** during a match to take control back immediately.

**How a brain's aim reaches the view** — `?jevControl=`, or the menu's Precision
control / Direct control:

| `?jevControl=` | What it means                                                                                                                                                                                                                            |
| :------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `precision`    | The default. The brain also chooses which visible enemy to engage and where on it; a deterministic local controller tracks that choice at frame rate and pulls the trigger only while a round has a fair chance. Blacksite decides hits. |
| `direct`       | The original interface, kept for comparison: the brain turns the view itself in fixed steps, four or five times a second.                                                                                                                |

### Elite Operator (human aim help)

`?playerProfile=elite`, or **Elite Operator** on the menus and **Elite Operator
aim** in the pause settings, gives a person the kind of aim help a polished
console shooter has, and nothing more. An **ELITE OPERATOR** chip sits beside
the fire mode while it is on.

- **Friction:** the look slows a little across a visible enemy near the
  crosshair, most at its centre, so a sweep stops on the body.
- **Rotational help while aiming down the sights:** when you or the target move,
  a small share of the target's own motion is added — capped at 6° a second.
- **Learned recoil help** (_Elite recoil help_, on by default; `?eliteRecoil=0`
  turns it off): part of each shot's fixed recoil pattern is countered, as a
  practised hand would. The kick still lands and the random jitter is yours.

It never fires, never snaps between enemies, never helps toward an enemy behind
a wall (it tests the sight line every frame), never pulls toward a target you
are turning away from, and steps aside for a quarter second on any fast flick —
the mouse always wins. Hitboxes, spread, recoil and damage are the same for
everyone.

**How a brain's movement reaches the body** — `?jevNav=`:

| `?jevNav=` | What it means                                                                                                                                                                                                       |
| :--------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `places`   | The default. The observation lists a few nearby places — cover from the enemies it knows about, a way nearer, round, back, the objective — with facts; the brain may name one and a local navigator walks it there. |
| `steps`    | The original interface: the brain walks the body itself, relative to the view.                                                                                                                                      |

### One set of senses

The HUD tells a person about enemies exactly what a brain in the same seat is
told: gunfire on the radar and compass only within the 115 m a brain hears,
the direction of a hit, teammates within the radar's 145 m. There are no
brackets over enemies, no drone camera and no thermal view; what you see of
the enemy is what is on the screen. A kill is confirmed under the crosshair
with the name and the range — on this site, the distance is the story — and
there are no XP popups or squad chatter.

With places navigation the person also receives quiet field notes from the
same perception builder as the agent: nearby places, their bearings and
distances, and sampled exposure to known threats. They do not steer the
person. They expire after 0.75 s; no notes appear under steps navigation.
A place must pass a standing body-width route check within 128 m. “Hidden”
tests a standing eye against known threats, not the whole body or every enemy.

### The debrief

The results screen ends with a debrief kept by the same rule for every seat:
how much of each life was spent in an enemy's sight line, and each death
classed as _never seen_, _seen, not engaged_ or _engaged, exchange lost_, with
the range, whether there was any cover within 10 m, and where.

What a brain may see and choose, the timing rules, the server boundary and the
measured results are in [`docs/JEV_BLACKSITE.md`](JEV_BLACKSITE.md). None of it
touches the analytical model: a brain is one more illustrative player.

## Verifying it

The look is only half of it — the simulation and the audio have to be asserted
too. See [`docs/VALIDATION.md`](VALIDATION.md) for the full command list; the
Blacksite-specific ones are `bun run smoke`, `bun run engagement`,
`bun run gait`, `bun run audio` and, for the player brains, `bun run jev`.
