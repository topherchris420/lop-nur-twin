# Jev plays Blacksite

`/play?brain=jev` puts the player's character under the control of **Jev**, the
TypeSafe System One model, through the same controls a person uses. Jev chooses
a movement, a view rotation and a weapon action — and, under precision control,
which visible enemy to engage and where on it. Blacksite executes those choices
and decides what happens.

> **Jev selects bounded tactical and engagement intent. A deterministic local
> controller executes that intent at frame rate. Blacksite alone decides what
> actually happened.**

Remote inference takes 130–260 ms per decision. That is enough to choose what to
do and far too slow to hold a crosshair on a moving torso through recoil, which
needs a correction every frame. So the work is split, as it is split in a
person: cognition at Jev's cadence, motor control at the simulation's. A result
under precision control is Jev's choices _and_ that controller together — never
Jev issuing every 60 Hz correction by itself — and every benchmark and trace
says which control mode produced it.

> A model selecting an action is not the authority over game state. Blacksite's
> deterministic simulation remains authoritative over the consequences of that
> action.

"Deterministic" in that sentence means rule-governed: the same controller,
weapon runtime, collision world and damage resolver apply the same rules to a
brain's input as to a person's. It does not mean a whole match replays
bit-for-bit — browser frame pacing varies, and the bots and spread diverge
within seconds (see [Replay](#replay)).

This is part of the illustrative simulation at `/play`. It is not analysis, it
writes nothing to the evidence ledger, and it says nothing about the real site —
see [The analytical boundary](#the-analytical-boundary).

## Contents

- [What Jev controls, and what it does not](#what-jev-controls-and-what-it-does-not)
- [Architecture](#architecture)
- [The action contract](#the-action-contract)
- [The observation](#the-observation)
- [The precision motor controller](#the-precision-motor-controller)
- [Elite Operator](#elite-operator)
- [Places: the feet's precision control](#places-the-feets-precision-control)
- [One set of senses](#one-set-of-senses)
- [The debrief](#the-debrief)
- [Capability negotiation](#capability-negotiation)
- [Scripted reference policies](#scripted-reference-policies)
- [Decision cadence and timing](#decision-cadence-and-timing)
- [The server boundary](#the-server-boundary)
- [Configuration, local development and deployment](#configuration-local-development-and-deployment)
- [Human takeover](#human-takeover)
- [The HUD](#the-hud)
- [Random baseline, fallback, recording and replay](#random-baseline-fallback-recording-and-replay)
- [Tuning the interface](#tuning-the-interface)
- [Benchmark methodology and results](#benchmark-methodology-and-results)
- [A conventional LLM in the seat](#a-conventional-llm-in-the-seat)
- [Fastino's Glide in the seat](#fastinos-glide-in-the-seat)
- [The evaluation harness](#the-evaluation-harness)
- [Security](#security)
- [The analytical boundary](#the-analytical-boundary)
- [Live and mock](#live-and-mock)
- [Limitations](#limitations)
- [Files](#files)

## What Jev controls, and what it does not

Jev controls exactly what a keyboard and mouse control:

| Axis       | Controls                                                                                                       |
| :--------- | :------------------------------------------------------------------------------------------------------------- |
| **move**   | hold, walk forward/back, strafe left/right, diagonals, sprint forward, jump (and mantle), crouch, prone, stand |
| **turn**   | none, or rotate the view left/right by 0.5°, 2°, 6° or 25°, or turn around (180°)                              |
| **tilt**   | none, or tilt the view up/down by 0.5°, 2° or 6°                                                               |
| **weapon** | trigger released, fire, aim down sights, aim and fire, reload, swap weapon                                     |
| **target** | _precision only_: track none, or the enemy listed as `TARGET_0` … `TARGET_3` — slots of its own observation    |
| **aim**    | _precision only_: hold the crosshair on the centre of mass, the upper chest, or the head                       |
| **go**     | _places only_: no destination, keep going, or the place listed as `PLACE_0` … `PLACE_3`                        |

Two control modes (`?jevControl=`, or the menu's Precision / Direct control):

- **Direct** — the original interface, unchanged and kept for comparison. Jev
  turns the view itself in fixed steps; to hit something it has to rotate the
  crosshair onto it four or five times a second, and recoil climbs the view on
  every burst exactly as it does for a person.
- **Precision** (the default) — Jev also names a target and an aim region; the
  [precision motor controller](#the-precision-motor-controller) tracks that
  choice every frame and gates the trigger. It aims with the same view rotation
  a mouse produces, through the same recoil, spread and collision.

Jev does **not** set, and has no path to set: player or enemy position or
velocity, health, ammunition, damage, hit registration, score, objectives,
respawns, match state or collision. The local controller cannot either: its
whole output is the same `InputState` — look deltas, trigger, sights, movement —
and `src/game/pilot/authority.test.ts` fails if any control-layer file queues
damage, writes a collider, health or weapon state, moves a body, fires a weapon
directly or touches the camera. Neither gets a teleport, noclip,
invulnerability, infinite ammunition, a larger hitbox or a bent round.

Controls the input layer carries but the player rig does not act on — melee,
interact, grenade, tactical — are deliberately **not** offered. Lean is not
offered either: it moves the camera, but rounds still leave from the un-leaned
eye, so it would be a choice that does nothing.

## Architecture

```text
Blacksite world (game singleton, collision world, HUD state)
      │  every ~200–250 ms, on a timer — never on the render loop
      ▼
Perception (src/game/pilot/perception.ts) ─ line-of-sight raycasts, view cone,
      │                                     crosshair ray, radar pings, damage indicator
      ▼
JevObservation — numbers and enums only, versioned, validated locally
      │  POST /api/jev/decision  { session, observation }
      ▼
Server (server/jev/handler.ts) ─ validates, rate-limits, builds the question itself
      │  POST https://api.typesafe.ai/v1/systemone  (Authorization: Bearer TYPESAFE_API_KEY)
      ▼
TypeSafe Jev — one Choice question per real choice (four to seven), in parallel
      │
      ▼
Server validates every answer ─ offered options only, real probabilities
      │
      ▼
Browser validates again (decision.ts) ─ sequence, schema, staleness
      │
      ▼
ActionExecutor (executor.ts) ─ one control frame, held for ≤ 0.4 s of simulation time
      │
      ▼
InputState ─ the same struct the keyboard and mouse fill
      │
      ▼
PrecisionMotorController (motor.ts, precision control only) ─ every simulation step:
      │   tracks the chosen enemy while a sight line reaches it, counters the
      │   learned recoil pattern, gates the trigger on the spread cone
      ▼
InputState, rewritten ─ look deltas, trigger, sights, movement: nothing else
      │
      ▼
PlayerRig → PlayerController, WeaponRuntime, CollisionWorld, resolveDamage, MatchDirector
      │
      ▼
New world state ↺
```

The integration seam is one line in `PlayerRig`: the rig reads
`pilot.frame(dt, playing) ?? input.state`. With a human in the seat the pilot
returns `null` and nothing changes; with a brain in the seat it returns the
`InputState` the executor wrote. The controller, weapons, collision and damage
code cannot tell the difference, and none of them were changed to accommodate a
model. The only other additions to game code are read-only statistics taps: a
`damageObservers` list in `core/combat.ts` and a shot counter call after the
rig's `fire()`.

## The action contract

`src/game/pilot/contract.ts`, versioned `blacksite-jev-actions/v3`. A decision
is one **control frame**: exactly one action per axis — `move`, `turn`, `tilt`,
`weapon`, `target`, `aim`, `go`. v3 added `go` (see
[Places](#places-the-feets-precision-control)); v2 traces are refused.

**An axis with a single legal option is not a choice, and is not asked.** In
direct control `target` is always `NONE` and `aim` always `CENTER_MASS`, so
neither is asked and the decision carries `null` for both — no probability or
confidence is invented for them. `go` is asked only under places navigation,
while a place is listed or a travel is under way, and is `null` otherwise. So a
decision asks four to seven questions: the four core axes always, plus `target`
and `aim` with an enemy in view under precision control, plus `go`. In precision control, with `n` enemies listed, `target` offers `NONE`
and `TARGET_0` … `TARGET_{n-1}` and `aim` all three regions; with nobody in
view both collapse to one option and are not asked. A slot names an entry of the
observation the decision was made from. The browser keeps the slot → entity map
for that observation; neither the observation nor the question ever carries an
entity id, and a slot whose observation has been forgotten binds nothing.

- **Held** controls (movement, sprint, trigger, aim-down-sights) are written on
  every simulation step of the frame and released when it ends.
- **One-shot** controls (jump, crouch, prone, stand, reload, swap) raise the
  matching `*Pressed` edge once. Stance controls resolve against the stance at
  execution time, so a late STAND cannot toggle a player who already stood up.
- **Rotations** are fixed steps applied through `lookYaw`/`lookPitch` — the
  mouse path — spread over the first 0.15 s of the frame.
- A **semi-automatic** weapon needs a fresh trigger pull per shot, so a FIRE
  frame after a FIRE frame releases the trigger for one step first.

The target and aim descriptions follow the same rule, for example:
`TARGET_0 — Track the enemy listed as TARGET_0: the aiming controller turns the
view onto it continuously, and while the weapon choice fires it pulls the
trigger only when the crosshair is on it. Tracking stops if it leaves sight or
is eliminated.` and `HEAD — Hold the crosshair on the head: about half the
torso's width, three and a half times the damage.`

Every action has a description that says what it does and never when to use it,
for example: `TURN_RIGHT_SMALL — Rotate the view 2 degrees to the right.`,
`SPRINT_FORWARD — Run forward at full speed. The weapon cannot fire or aim while
sprinting.`

**Legal actions** (`legalActionsFor` in `observation.ts`) filter by mechanics,
never by tactics: no fire on an empty or reloading weapon, no reload of a full
magazine, no fire or aim while sprinting or climbing, no stance change to the
current stance, no jump in the air, no tilt past 80°. The four core axes
(`move`, `turn`, `tilt`, `weapon`) always keep at least two options; `target`,
`aim` and `go` collapse to one when there is nothing to choose, and are then not
asked.

## The observation

`src/game/pilot/observation.ts`, versioned `blacksite-jev-observation/v4`. It
holds only numbers, booleans and strings from closed vocabularies; the validator
rejects unknown fields, out-of-range numbers and oversized arrays.

```text
interface JevObservation {   // a sketch; the exact types are in observation.ts
  schemaVersion: "blacksite-jev-observation/v4";
  actionContract: "blacksite-jev-actions/v3";
  sequence: number;                       // monotonic per page
  control: "direct" | "precision";
  navigation: "steps" | "places";
  match: { mode; phase; timeRemainingS; team; ownScore; enemyScore };
  player: { alive; health; headingDeg; pitchDeg; speedMps; stance; motion; grounded; adsProgress };
  weapon: { slot; weaponClass; fireMode; ammo; magSize; reserve; reloading; canFire;
            spreadDeg; aimedSpreadDeg };                 // WeaponRuntime.spreadDeg, now and settled
  perception: {
    visibleEnemies: { bearingDeg; elevationDeg; distanceM; onCrosshair; firing;
                      headVisible; chestVisible; lateralMps; tracked }[];          // ≤ 4
    contacts: { source: "gunfire" | "last_seen"; bearingDeg; distanceM; ageS }[];   // ≤ 3
    damage: { ageS; bearingDeg } | null;
    obstacles: { forwardM; leftM; rightM; backM; forwardClimbable };               // null = clear
    places: { kind; bearingDeg; distanceM; hidden; routeExposedM; threatDistanceM }[]; // ≤ 4, places only
    allies: { bearingDeg; distanceM }[];                                            // ≤ 3, radar range
  };
  objective: { kind: "none" | "zone" | "hardpoint"; bearingDeg; distanceM; state };
  travel: { kind; bearingDeg; remainingM } | null;          // where the navigator is going
  previous: { frame: ControlFrame | null; outcome: { shotsFired; hitConfirmed; killConfirmed; damageTaken; movementBlocked } | null };
  legal: { move: []; turn: []; tilt: []; weapon: []; target: []; aim: []; go: [] };
}
```

Angles are relative to the crosshair: bearing clockwise-positive (right),
elevation up-positive. Absolute coordinates are withheld.

**Perception follows the player's rules, not the simulation's:**

- An enemy is **visible** only when it is alive, within 165 m (the bots' own
  sight range), inside the camera's current field of view — which narrows when
  aiming down the sights — and an unobstructed sight line from the player's eye
  reaches its head or chest (`CollisionWorld.hasLineOfSight`, the test the bots
  use). An enemy behind a wall is not visible.
- **On the crosshair** is one ray along the real aim direction resolved against
  real hitboxes: exactly what a round would meet.
- **Contacts** are awareness the HUD already gives a person: enemy gunfire pings
  from the radar and compass within 115 m (the bots' hearing range), and where an
  enemy was last seen, for six seconds. Both carry the position where the enemy
  was heard or seen, never where it is now.
- **Damage** is the HUD's direction indicator; **obstacles** are waist-high
  probes around the body, which a person sees on screen.

The spatial-intelligence overlay keeps brackets on enemies for a few seconds
after sight is lost, at their live position. Jev is **not** given that: it gets
the frozen last-seen position instead, which is the more conservative choice.

**What Jev actually reads.** The server renders the observation into plain
language before asking — TypeSafe's own guidance is that Jev reads semantic
descriptions better than numbers and should not be asked to do arithmetic. An
enemy becomes, for example:

```json
{
  "distance": "24 m (medium range)",
  "crosshair_on_enemy": false,
  "turn_to_centre_crosshair": "right, medium (9.4 degrees)",
  "tilt_to_centre_crosshair": "down, fine (0.6 degrees)",
  "shooting": true
}
```

The size classes (fine, small, medium, large) are the sizes of the rotations on
offer. That restates where the enemy is in the units of the controls; which
enemy to engage, and whether to engage at all, is Jev's decision.

Under precision control each enemy is keyed by the slot that names it, and three
more facts are added — how exposed it is, how it is moving across the view (from
the player's own view of it, relative to the player's motion), and, per aim
region, how wide it looks and what share of a round's possible directions the
current and the fully aimed spread cone would put on it (illustrative values, in the exact shape `server/jev/question.ts` writes):

```json
"TARGET_0": {
  "distance": "96 m (very long range)",
  "exposure": "fully exposed",
  "motion": "moving left across the view at 2.4 m/s",
  "being_tracked": false,
  "chance_per_round_with_crosshair_on_it": {
    "CENTER_MASS": "0.29 degrees wide; unlikely with the current spread, very likely fully aimed",
    "UPPER_CHEST": "0.22 degrees wide; unlikely with the current spread, very likely fully aimed",
    "HEAD": "0.17 degrees wide; unlikely with the current spread, very likely fully aimed"
  }
}
```

Those shares are the same geometry the fire gate uses (`hitGeometry.ts`, below):
arithmetic done in code, stated as a fact. Nothing says which region to choose.

## The precision motor controller

`src/game/pilot/motor.ts`. It runs on every simulation step while Jev's latest
decision names a target, after the executor has written the frame, and rewrites
only the input. Everything it may sense passes through one narrow interface
(`MotorSense`): the eye, the real aim direction (the camera's forward — where
this step's round will go), the field of view, the player's own body and weapon,
and, for the one enemy it was given, a living body and sight-line tests with the
same `CollisionWorld.hasLineOfSight` the bots and perception use.

**Binding.** A decision naming `TARGET_n` binds the entity in that slot of that
decision's observation. The next decision re-confirms, switches or releases it.
The binding is also released — and counted, by reason — when the enemy dies,
when neither its head nor its chest has had a sight line for 0.12 s, or when no
decision has re-confirmed it for 1 s (an outage). **There is no emergency
fallback targeting:** the controller never picks an enemy by itself. When Jev
cannot answer, it finishes the current binding until that 1 s runs out, then
the seat idles — or, with `?fallback=random`, the labelled FALLBACK policy picks.

**Seeing like a player.** The target is sampled only while it is in sight, and
the controller uses those samples 50 ms late — a perceptual delay; Jev's own
decision latency sits on top. Its motion is estimated from successive samples
alone and extrapolated over at most 0.22 s (the delay, one frame of shot lag and,
for projectile weapons, the round's flight time plus gravity drop). During the
0.12 s sight-loss grace it extrapolates the last sample; it never reads where a
hidden enemy actually is. If the chosen region is the part in cover (a head
behind a parapet), it holds the part it can see.

**Control law** (`axisRate`), per axis:

- a velocity command = the target's angular velocity (feed-forward) plus the
  slower of `11.5/s × error` and the fastest rate that can still stop inside the
  acceleration limit (`0.82 × √(2·a·error)`);
- the commanded rate changes by at most 4,200 °/s² per second and never exceeds
  560 °/s from the hip, 300 °/s fully aimed (pitch 70 % of both).

Far away it is a time-optimal flick that decelerates within its own limit, so it
cannot overshoot; close in it is first order, which converges exponentially with
no oscillation. A seeded, smoothed hand tremor of 0.06° is added to the aim
point. Unit tests (`motor.test.ts`) check the rate and acceleration limits every
step, no sign reversal across a 40° flick, sub-0.15° hold on a still target,
0.35° on a 4.5 m/s strafer at 25 m, and bit-identical output for a seed.

**Recoil feed-forward.** `WeaponRuntime` still builds each weapon's recoil
pattern from its seed and still kicks the view in full on every shot, jitter
included (`authority.test.ts` asserts it). What a practised player learns is the
pattern; after each shot the controller reads that shot's deterministic kick
(`WeaponRuntime.lastPatternKickDeg`, which excludes the jitter) and queues 90 %
of it as a counter-rotation over ~30 ms. The feedback loop ignores the part the
counter will remove, so the two do not add up and dip under the target. The
random jitter and the remaining 10 % are left to feedback: visible recoil,
controlled — not removed.

**Fire gate.** Jev's FIRE or ADS_FIRE is permission to engage, not an order to
empty the magazine. On each step the gate computes the share of the weapon's
real spread cone (`WeaponRuntime.spreadDeg` — stance, speed, air, sights, bloom)
that falls on a disc inside the chosen region's hitboxes, at the current
estimated error. `WeaponRuntime.fireOne` draws a round uniformly over a disc of
the spread's radius, so that share is the small-angle geometry of the real draw,
not a tuned curve. The trigger opens at 42 % (automatic) or 55 % (single-shot),
16 % / 30 % inside 12 m where rounds are cheap and time is not, 18 % for a
multi-pellet shell; an automatic burst is held while the share stays above 24 %
(10 % close in) and is re-judged after nine rounds. Single-shot weapons get one
press per cycled round. It is judged "a step ahead", because the rig advances
the weapon's clock after the controller runs. The outcome of every round is
still the weapon runtime's spread draw and the collision world's raycast. When
the named target is gone, the trigger stays released for the rest of that
frame instead of emptying into the wall it went behind.

**Sights.** With ADS or ADS_FIRE and a target beyond 12 m, the gate waits until
the sights are 70 % up; closer, hip fire and Tac-Stance stay available.

**Movement shaping — never strategy.** Asked to fire, a SPRINT_FORWARD becomes a
walk, because a sprint blocks the weapon. If the movement spread is what keeps a
shot below the threshold and standing still would clear it, the controller
counter-strafes against the body's drift for at most 0.28 s, then gives Jev's
movement back for at least 0.7 s. It does not choose where to go, when to take
cover, or when to crouch.

**Human takeover, death, respawn, pause, a brain switch** all reset the
controller with the executor; nothing it held survives them.

## Elite Operator

`src/game/player/eliteAssist.ts`, `?playerProfile=elite` or the menus: the human
equivalent, and deliberately weaker, because the human stays authoritative. It
reshapes only the mouse's own motion for a frame, only while the crosshair is
already within a few body-widths of a visible enemy: friction across the body
(up to 22 % from the hip, 38 % aimed, strongest at its centre), a rotational
nudge while aiming and moving (30 % of the target's angular motion, capped at
6 °/s), and optional learned recoil help (45 % of the pattern kick). It never
fires, never snaps, holds one target rather than jumping to one crossing in
front, tests the sight line every frame, never pulls toward an enemy the mouse
is moving away from, and steps aside for 0.25 s on any look faster than 220 °/s.
An ELITE OPERATOR chip shows while it is on, and episode statistics are
labelled `profile: elite`.

## Places: the feet's precision control

`src/game/pilot/places.ts`, `navigator.ts`; `?jevNav=places` (the default) or
`?jevNav=steps` for the original interface. Action contract v3; observation v4.

The first benchmark's most striking behaviour was not the accuracy. It was
that Jev almost never moved: 0 m in 360 s under precision control. The move
axis offered walking directions relative to the view — FORWARD, STRAFE_LEFT —
and nothing that said where cover was, how far, or what the walk there would
cost. A brain choosing four times a second between "forward" and "left" with
no notion of the ground has no movement decision to make, so it made none.

Places give movement the same split precision control gave aim. Each
observation may list up to four places, found from the collision world and
from the threats the observation already reports — the enemies in view,
remembered sightings, gunfire heard, the direction of the last hit taken 60 m
out — and from nothing else:

| Kind        | What it is                                                                                |
| :---------- | :---------------------------------------------------------------------------------------- |
| `cover`     | the nearest reachable point no known threat can see the standing eye at                   |
| `advance`   | such a point at least 4 m nearer the nearest known threat                                 |
| `flank`     | such a point at least 35° round that threat from where the player stands, and not further |
| `withdraw`  | such a point at least 5 m further from it                                                 |
| `objective` | the objective zone's centre, in modes that have one, whatever can see it                  |

Each comes with facts, not coordinates: bearing from the crosshair, distance,
whether it is hidden from every known threat, how many metres of the straight
walk there stand in some known threat's sight, and how far the nearest known
threat would be. The server states them in words, including the time at a run.
"Hidden" is literal: hidden from the threats the observation mentions, which
may not be all the threats there are. Observation v4 tests the standing eye,
not a crouched eye; it does not promise whole-body invisibility. Route exposure
is sampled at terrain height, not a linearly interpolated floor.

The `go` axis offers `NONE`, `CONTINUE` (only while travelling) and one
`PLACE_n` per listed place. A slot binds the world point the browser kept for
that observation — the observation itself never carries it. The navigator then
writes `moveX`, `moveY` and `sprint`, relative to the body's current facing, so
it can strafe toward cover while the crosshair stays on an enemy; it runs only
toward a place mostly ahead and never while the weapon choice fires. It never
turns the view, jumps, changes stance or fires; the move axis's jump and stance
choices still apply. It lets go on arrival (1.1 m), after 1.5 s without
progress, after 1.5 s without a CONTINUE or a new place, and on NONE, death,
takeover or pause. It never chooses a destination.

Places are listed nearest first. `?placeOrder=shuffled` lists the same places
in a seeded random order instead — slot order is presentation, and the live
run in [The live model on the new game](#the-live-model-on-the-new-game) is
why the option exists.

The finder offers only places that pass a standing capsule and body-width
straight-route check: three lateral rays at three body heights, standing
capsule samples at most one metre apart, and terrain slope checks. The query
is bounded to 128 m. Objectives pass the same check; an unreachable centre
remains in the objective observation but is not offered as a place. This is
sampled reachability, not a pathfinding guarantee. If every live feeler is
blocked the navigator releases movement immediately, then reports a blocked
travel after the usual no-progress timeout. The navigation grid in `ai/navmesh.ts` is built for more and is not
used yet. The candidate search is deterministic: fixed rings of 5, 9, 14, 20
and 27 m, sixteen spokes each, the nearest three known threats tested, route
exposure measured only for the places that are listed.

## One set of senses

With places navigation, `PlacesHud` renders the same captured place facts for
the human as for an agent. Human perception is captured at 250 ms simulation
intervals on a timer; model notes use the model observation cadence. The notes
show at most two places and expire after 0.75 s. They never request inference,
choose an action, or read the debrief. Bearings and distances follow the
player; exposure is explicitly labelled as a fact at capture. No notes appear
under steps navigation. `node tools/places.mjs` checks this boundary.

A comparison between a person and a model means something only if they are
told the same things. Before this version the human's HUD drew brackets with
names and ranges on every enemy that had a sight line to the player, at any
range and whichever way the player faced, kept them at live positions after
sight was lost, and offered a UAV orbit camera, thermal and night-vision modes
and target lock — none of it available to a brain, none of it documented or
tested. It is gone. What remains follows one rule each way:

| Channel            | Human HUD                            | Brain's observation                                          |
| :----------------- | :----------------------------------- | :----------------------------------------------------------- |
| Enemies            | what is on screen                    | `sightOf`: field of view, 165 m, clear line to head or chest |
| Gunfire            | radar and compass pings within 115 m | contacts within 115 m                                        |
| Hits               | the damage direction indicator       | `damage`: bearing and age                                    |
| Teammates          | radar chevrons within 145 m          | `allies`: bearing and distance, 145 m                        |
| Remembered enemies | the player's memory                  | last-seen positions, 6 s                                     |

The asymmetries that remain are stated rather than hidden: a person hears
footsteps and sees pixels; a brain gets exact bearings and the places list.

## The debrief

`src/game/pilot/debrief.ts`, on the results screen and in every benchmark
report. For every seat — the human's included, by the same rule — it samples
a few times a second, for each living enemy, whether it was **in view**
(perception's own `sightOf`) and whether it had a **sight line to the seat**
(whichever way either faced). Each death is then classed once:

- **never seen** — the killer was not in view at any point that life;
- **seen, not engaged** — it was in view, and no round was fired at it;
- **engaged, exchange lost** — the seat fired at it and died anyway;
- **no attacker**.

It also reports the share of each life spent in some enemy's sight line, the
longest unbroken stretch, deaths with no cover within 10 m ("open ground") and
the nearest named zone, and the time from first sight to each kill. A
kill/death ratio says who won; the debrief says whether a loss was a failure
to see, a failure to act on what was seen, or a fight lost fairly — which for
a person and for a model are different failures with different fixes.

It reads the authoritative simulation — that is what "what happened" means —
and is never fed back into an observation.

## Capability negotiation

`src/game/pilot/capabilities.ts`. A brain declares what it can use —
engagement modes, navigation modes, the fastest cadence it can sustain, local
or remote inference, memory, vision — and the host declares what it accepts:
precision and direct control, places and steps, decisions every 100 ms. The
seat runs the best interface both support, notes anything not granted as
asked, and records it in the trace header (`interface`) and in every
statistic (`navigation`, `intervalMs`, `injectedLatencyMs`).
`GET /api/jev/decision` reports the Jev adapter's declaration.

Nothing in the simulation depends on the outcome. What changes is which axes
are asked, how often, and which local controllers execute.

The host accepts more than today's remote model can use at speed. For local
brains two parameters turn that headroom into an experiment: `?cadence=<ms>`
sets the decision interval (50–2000) and `?latency=<ms>` holds each answer
back (0–1500) before the loop sees it. The same policy can then be measured
at today's round trip, at half of it and at twice it — what a faster or slower
model would gain here, measured before that model exists. Neither parameter
applies to Jev, whose latency is real.

## Scripted reference policies

`src/game/pilot/policies.ts`, `?brain=script&policy=marksman|skirmisher`,
labelled SCRIPTED. A few dozen lines each; they read the observation a model
reads, choose only legal options, and go through the same executor, motor
controller and navigator. They claim no probabilities.

- **marksman** holds still, aims down the sights and engages the enemy nearest
  the crosshair — the head beyond 40 m, otherwise the upper chest; with nothing
  in view it turns toward the freshest thing heard, else sweeps a quarter turn
  at a time. It is the strategy the first benchmark found Jev playing, written
  down.
- **skirmisher** engages the same way but keeps moving: under places
  navigation it takes cover when hurt or hit, closes on distant enemies
  through places hidden from them, and otherwise goes where the fighting was
  heard or to the objective; under steps navigation it strafes and walks.

They are measuring instruments. When a model's result looks like a strategy,
write the strategy down and run it on the same seeds; if the script matches
the model, the finding is about the game.

## Decision cadence and timing

Measured before choosing: from this development container, TypeSafe answered a
Choice request in 130–490 ms round trip, and its own upstream-timing header
reported about 100 ms. So:

| Rule                              | Value                                  |
| :-------------------------------- | :------------------------------------- |
| Requests in flight                | at most one; there is no queue         |
| Minimum interval between requests | 200 ms in the browser (≤ 5 per second) |
| Server minimum per session        | 150 ms                                 |
| Control frame (TTL)               | 0.4 s of simulation time               |
| Target binding without a decision | released after 1 s                     |
| Precision controller              | every simulation step (60 Hz)          |
| Rotation completes within         | 0.15 s                                 |
| Browser request timeout           | 2.2 s                                  |
| Server → TypeSafe timeout         | 1.8 s                                  |
| Maximum decision age              | 1.5 s — older answers are discarded    |

In the benchmark below the loop settled at about 4.3 decisions per second. A new
frame normally replaces the previous one before its 0.4 s runs out, so control is
continuous; when answers stop, nothing stays held for longer than 0.4 s.

Decisions are requested from a 50 ms timer, never from `useFrame`; the fetch is
fire-and-forget; an answer becomes input only on the next rendered step. The
render and simulation loops never wait for Jev.

**Sequence and staleness.** Every observation carries the next sequence number.
An answer is accepted only for the request in flight. It is discarded as stale
if the request was abandoned (death, pause, takeover, brain switch), if the
player died or respawned since, if it is older than 1.5 s, or if a newer
decision was already accepted. A second answer for the same request is counted
as a duplicate. Failures back off: 250 ms after a timeout, the server's
`Retry-After` on rate limiting, five seconds when the service is unavailable,
and 0.5–4 s exponentially for other errors.

**Revalidation at execution** (since 29 September 2026, `staleness.ts`). An
answer that passes the loop's checks is judged once more when its frame would
start: the host recomputes what is legal _now_, by perception's rules — is the
enemy the target slot named still alive and in view, is the magazine still
loaded, is the seat still on the ground for a JUMP, is there still a travel for
a CONTINUE — and under the default `?stale=strict` refuses the whole frame if
any part has become illegal. The seat idles until the next valid decision; the
refusal is an event in the trace and a `rejected_stale` decision record.
`?stale=observe` executes it anyway and records that it did, which is how the
seat behaved before and is kept only to measure the difference. Every decision
record carries its age at execution and everything that had changed, legal or
not. Benchmarks before this date ran without the check.

## The server boundary

`POST /api/jev/decision` (`api/jev/decision.ts` → `server/jev/handler.ts`):

1. Accepts only a same-origin `application/json` body under 8 KiB holding
   `{ session, observation }`. Cross-site requests (by `Origin` or
   `Sec-Fetch-Site`) get 403.
2. Validates the observation with the shared validator and **recomputes the legal
   options itself**; a mismatch is rejected.
3. Applies the rate limits (below).
4. **Builds the question itself**: the state rendering, the instructions and the
   option descriptions all come from server code and the versioned contract. The
   browser cannot choose what is asked, so the endpoint is not a prompt proxy.
5. Asks TypeSafe one Choice question per axis that offers a real choice — four
   to seven — in one request, with a 1.8 s timeout.
6. Validates each answer: an offered option, a probability for every offered
   option and no others, each in [0, 1], summing to 1 within rounding, the choice
   the most probable, confidence in [0, 1]. Anything else is a 502.
7. Returns the frame, TypeSafe's probabilities and confidence unchanged, the
   concrete model version TypeSafe reports (e.g. `jev-1.13.0`), the measured
   upstream latency and the token usage.

Errors use one envelope, `{ schemaVersion, sequence, error: { code, message },
retryAfterMs }`:

| Status | Code                                    | Browser shows    |
| :----- | :-------------------------------------- | :--------------- |
| 400    | `invalid_request`                       | ERROR            |
| 403    | `forbidden_origin`                      | ERROR            |
| 413    | `payload_too_large`                     | ERROR            |
| 415    | `unsupported_media_type`                | ERROR            |
| 429    | `rate_limited`, `upstream_rate_limited` | ERROR, backs off |
| 502    | `upstream_auth` (TypeSafe 401/403)      | UNAVAILABLE      |
| 502    | `upstream_error`, `upstream_invalid`    | ERROR            |
| 503    | `not_configured` (no key)               | UNAVAILABLE      |
| 504    | `upstream_timeout`                      | TIMEOUT          |

`GET /api/jev/decision` reports whether the service is configured and which
model alias it asks for, without calling TypeSafe; the menu uses it to show
"Jev ready" or "Jev unavailable".

**Rate limiting and abuse protection** (`server/jev/rateLimit.ts`), all in
memory, in this order: a token bucket per client address (10 burst, 6 per
second), a 150 ms minimum interval per page session, an instance-wide bucket
(40 burst, 16 per second — under the TypeSafe account's 20 requests per second),
and at most 16 TypeSafe calls in flight. The limitation, stated plainly: this
state lives in one function instance; Vercel may run several, and a cold start
forgets everything. These are brakes, not a wall. A determined client rotating
addresses is bounded by the per-instance budget, not stopped. For durable limits,
add a rate-limit rule for `/api/jev/decision` in the Vercel project's Firewall,
or back the limiter with a shared store.

## Configuration, local development and deployment

Two server-side variables. Neither is ever `VITE_`-prefixed, because Vite inlines
`VITE_*` values into the browser bundle.

| Variable           | Required | Default      | Purpose                                          |
| :----------------- | :------- | :----------- | :----------------------------------------------- |
| `TYPESAFE_API_KEY` | for Jev  | —            | TypeSafe credential; without it, 503             |
| `TYPESAFE_MODEL`   | no       | `jev-latest` | model alias or pinned version, e.g. `jev-1.13.0` |

**Local development.** Copy `.env.example` to `.env.local` (git-ignored) and fill
in the key, or export it in the shell:

```sh
cp .env.example .env.local        # then set TYPESAFE_API_KEY=…
bun run dev                       # http://localhost:5173/play?brain=jev
```

`vite` and `vite preview` serve `/api/jev/decision` from the same handler the
Vercel function uses (`jevDecisionApi` in `vite.config.ts`); the key reaches that
handler and nothing else.

**Vercel.** Project → Settings → Environment Variables:

- `TYPESAFE_API_KEY` — type **Sensitive**, environments Production and Preview.
- `TYPESAFE_MODEL` — `jev-latest` (optional).

Then redeploy: environment variables apply to new deployments only. `vercel.json`
routes `/api/*` to functions before the single-page rewrite (which now excludes
`/api/`), marks API responses `no-store`, and caps the function at 10 seconds.
Check a deployment with:

```sh
curl -s https://<deployment>/api/jev/decision   # {"configured":true,"model":"jev-latest",…}
```

**Container image.** The nginx image serves static files only; it has no
function and no credential. The decision endpoints answer 404 in their error
shape, so `/play?brain=jev` shows JEV UNAVAILABLE (and Glide and the LLM the
same), and `/api/rain/*` answers as a runtime switched off.

## Human takeover

Press **H**, or click **Take control** on the panel. Immediately: the request in
flight is abandoned (its answer, if it comes, is stale), the sequence is
invalidated, every AI-held control — movement, trigger, aim, sprint, lean, and
any pending edge or rotation — is released, the keyboard and mouse state is
reset, the brain is switched off and the pointer is locked for the human inside
the same click or key press. The match keeps running; nothing reloads.

To hand control back, press Esc and choose a controller under **Player control**
on the pause menu.

While a brain plays, the mouse is not needed and the pointer stays free, so the
page works as a spectator view: the camera follows the player as usual, and the
cursor is visible to reach Take control.

## The HUD

A compact panel above the ammunition readout, repainted about eight times a
second from the pilot's telemetry singleton — no React state on the frame loop.
Under precision control it adds the TARGET and AIM choices (with Jev's
probability and confidence, or NOT ASKED), then three spectator lines:

```text
PRECISION · HEAD · ERR 0.06° · TRIGGER OPEN · 118 M
ACC 80% · HITS 36/45 · K/D 21/0
LATENCY 207 MS · TICK 131 · JEV-1.13.0
```

— the region actually held (marked `*` when the chosen one is in cover), the
live angle from the crosshair to it, the fire gate's state (TRACKING, ADS
SETTLING, TRIGGER OPEN, TRIGGER HELD), the range, and the episode's accuracy
and K/D. Under direct control that line reads `CONTROL DIRECT · STEPPED TURNS BY
THE BRAIN`. Everything finer — distributions, gate counts, recoil figures —
belongs to the trace and the benchmark, not the HUD. The frame below is from a
direct-control live run (`seed=43`, a few seconds in, mid-reload):

```text
JEV // BLACKSITE                  LIVE JEV EXECUTING
MOVE   HOLD             P .85 CONF .83
       HOLD .85  FORWARD .07  FORWARD_LEFT .02
TURN   TURN_LEFT_MEDIUM P .31 CONF .23
       TURN_LEFT_MEDIUM .31
       TURN_RIGHT_MEDIUM .20  NO_TURN .15
TILT   LOOK_UP_FINE     P .68 CONF .62
       LOOK_UP_FINE .68  NO_TILT .20
       LOOK_DOWN_FINE .07
WEAPON NO_FIRE          P .91 CONF .82
       NO_FIRE .91  SWAP_WEAPON .09
LATENCY 220 MS · TICK 27 · JEV-1.13.0
TARGET 59 M -6° · HP 100 · AMMO 5/210
Jev chooses · Blacksite decides what happens
[ Take control · H ]  [ Save trace ]
```

That frame was captured from an earlier build. Today the panel also draws the
motor line and the ACC · HITS · K/D line described above (and, under places
navigation, a GO row), offers **Save decisions** beside **Save trace**, and its
last line reads "Jev chooses · local controller executes · Blacksite decides".

Each axis shows the choice, its probability and TypeSafe's confidence, then up
to three candidates as TypeSafe ranked them; a long top three wraps between
candidates rather than cutting one off. The weapon row lists two because only
two were legal: a reload was in progress, which rules out firing, aiming and
reloading.

**Labels** say who is in control: **LIVE JEV** only while TypeSafe's answers are
executing; **LIVE GLIDE** only while Fastino's are; **LIVE LLM** only while a
conventional LLM's are (see
[A conventional LLM in the seat](#a-conventional-llm-in-the-seat));
**FALLBACK** from the first fallback frame until the remote brain answers
again; **HUMAN**; **RANDOM**; **SCRIPTED**; **REPLAY**; and **JEV UNAVAILABLE**
/ **GLIDE UNAVAILABLE** / **LLM UNAVAILABLE** when the service cannot answer.
Probabilities and confidence are shown only when the provider supplied them
(TypeSafe and Fastino state probabilities; an LLM's confidence is a number it
wrote) — the random brain shows "uniform over legal options", a replay none,
and nothing is ever filled in.

**Statuses**: OFF, CONNECTING, OBSERVING, DECIDING, EXECUTING, TIMEOUT,
UNAVAILABLE, ERROR, DEAD, RESPAWNING, PAUSED, MATCH_COMPLETE.

The menu's **Player control** selector (Human / Jev / Glide / LLM / Random /
Scripted / Replay) explains
each choice and probes the service before a match: "Jev ready · jev-latest" or
"Jev unavailable — …".

## Random baseline, fallback, recording and replay

**Random** (`/play?brain=random&seed=42`) uses the same observation, the same
legal options, the same cadence limits and the same executor. Under direct
control it draws exactly four numbers per decision from `mulberry32(seed)` — one
per axis, as it always has, so a seed's frames are unchanged
(`engagement.test.ts` re-derives them from the stream); precision control adds
two draws, a target slot and an aim region, whose engagements then run through
the same motor controller, and places navigation adds one, the destination,
last. It picks uniformly among the legal
options, so the same seed and the same options give the same frames: `bun run jev` runs seed 42 twice and compares every frame
decided from identical options (63 of 63 matched in the run recorded here). It answers in under a millisecond, so it decides about as often as the
200 ms cap allows; Jev decides about as often as its latency allows.

**Fallback** (`/play?brain=jev&fallback=random`, off by default): while Jev
cannot answer, the random policy acts at the normal cadence. Every such frame is
labelled FALLBACK and recorded as `fallback-random`; it is never shown as LIVE
JEV. Without the parameter, a failing Jev leaves the player idle and says why.

**Recording.** Every accepted decision is kept in memory (up to 5,000) as JSON
Lines: timestamp, sequence, observation hash (FNV-1a over canonical JSON), legal
options, frame, TypeSafe's probabilities and confidence (or `null`), model
version, round-trip and server latency, action start, expiry and end (simulation
seconds), end reason, outcome (rounds fired, hit, kill, damage taken, movement
blocked), player state after, match id and seed; plus events — timeouts, stale
and invalid answers, deaths, respawns, takeovers. **Save trace** downloads it
and keeps a copy of the last trace in local storage; `?record=1` also keeps it
there at the end of a match. No
trace can contain the credential: it never reaches the browser.

**Save decisions** downloads the episode's decision records
(`blacksite-episode-decisions/v1`): for every decision the full observation, the
options offered, the choice, its confidence as the brain stated it, latency,
validation and the outcome window. It is the file `/evaluation` opens. The
trace replays controls; the decision records explain them. Archives written
before the schema id existed carry none and are still read; a file naming any
other schema is refused.

The decision loop itself refuses an answer whose frame names an option the
observation did not offer, whoever produced it, as an `invalid` failure.
Providers validate their own output as well; the host does not rely on it.

<a id="replay"></a>**Replay** (`/play?brain=replay&trace=last`, the menu's
**Load trace**, or `bun run replay:jev -- trace.jsonl`) re-issues each recorded
frame at its recorded simulation time through the same executor, with no model
call, labelled REPLAY. Traces with another trace, contract or observation
version, or with a control this build does not know, are refused. What a replay
reproduces is the **control stream**: `replay:jev` checked 84 of 84 frames of a
recorded run executed in order. A replay record carries no probabilities and no
model: they belonged to the original observation, which the replayed world does
not reproduce, so the HUD shows "replayed control — no decision is made". Traces are now `blacksite-jev-trace/v3`; the
header records the control mode and a replay runs under the mode it was
recorded with. A replayed `TARGET_n` names the enemy in that slot of the view at
replay time — the control stream replays, the world does not. What it does not reproduce is the world — frame
pacing is not deterministic, so the bots, spread and damage diverge.

## Tuning the interface

State representation and action granularity were treated as part of the
experiment. Each change below was made because a live run showed a failure in
the interface; none weakened the game. These were single exploratory runs, not
benchmarks.

1. **One aim axis → separate turn and tilt axes.** With one "aim" question a frame
   could correct the crosshair's bearing or its height, never both. Recoil
   climbs every burst, so in a 24-second live run the view drifted to about 10°
   above level, every enemy sat 4–13° below the crosshair, and 108 rounds hit
   nothing. With turn and tilt as separate questions, pitch stayed within about
   ±2.5° in the next run.
2. **Fine steps, and corrections stated directly.** The smallest rotation was
   1.5°, but a torso subtends about ±0.6° at 25 m and ±0.15° at 100 m, so aim
   could only oscillate around a distant target. A 0.5° step was added to both
   axes (small became 2°). Jev also sometimes turned left toward an enemy
   described as "right of the crosshair" — TypeSafe documents indirection as a
   weak spot — so each enemy's offset is now also stated as the rotation that
   would centre it. The next 40-second run: 125 rounds, 6 hits, 2 kills, 1 death,
   and the controller kept deciding after the respawn.
3. **A deadlock found by the benchmark.** Resetting statistics while a frame was
   executing made that frame's outcome report −3 rounds fired; the server
   rightly refused the observation, and the bad value rode along in every
   observation after it — an entire episode without a decision. Frame outcomes
   now use counters that never reset, and the browser validates its own
   observation before sending, so a bad field fails locally, by name. Both have
   regression tests.

4. **Cognition and motor control, separated.** Measured before building it: the
   direct interface's best run hit 3.6 % of its rounds, and the reason was
   structural — a torso at 25 m is ±0.6° and the loop moved the crosshair in
   fixed steps five times a second while recoil climbed every round. The
   target and aim axes and the precision controller are the response.
5. **Too steady to be a person.** The first live precision run (45 s, seed 42)
   went 18 kills for no deaths at 89 % accuracy, 17 of them one-shot headshots
   at around 100 m, holding a 0.06° median error with a 0.03° tremor and a
   33 ms perceptual delay. Nothing was falsified — every round went through the
   weapon runtime — but no hand is that still. Tremor went to 0.06° and the
   delay to 50 ms; the next run on seed 43 hit 54 %.
6. **A latch that never re-checked.** That trace also showed an automatic burst
   firing five rounds at a 0 % hit share. The rig advances the weapon's shot
   clock _after_ the controller runs, so while the trigger was held the
   controller never saw the weapon "ready" and never re-judged the burst.
   Readiness is now judged a step ahead; a regression test side-steps an enemy
   mid-burst. The next live run (seed 44): no target-bound round left with more
   than 0.4° of error.

7. **Questions that stand alone.** Reviewed against TypeSafe's own guidance
   (the `typesafe-ai` skill): questions in one request run in parallel and
   cannot see each other's answers. The aim question had asked about "the
   tracked enemy" — an answer it cannot see — so it now states its premise
   ("Suppose the aiming controller tracks one of the enemies listed under
   `enemies_in_view_nearest_crosshair_first`…"), and both engagement questions
   name that state path. This came after the matched benchmark below; a 45 s
   live check afterwards (195 decisions, 43 hits, tracking p50 0.053°, 13/13
   checks) showed nothing broken, but the benchmark figures were measured with
   the earlier wording.

The recoil, spread, damage, hitboxes, bots and collision were not changed. The
hitbox table moved to `characters/hitboxSpecs.ts` so the colliders and the aim
geometry read one definition; a test pins its numbers. `WeaponRuntime` gained
read-only readouts (`lastPatternKickDeg`, `settledSpreadDeg`, `readyToFire`,
`cycleRemainingS`, `shotsFired`) and nothing that changes how it fires.

One pre-existing quirk, found and left as it was because changing it would
change every controller's recoil and break comparison with earlier results: the
rig adds only each shot's new kick to the view, so the runtime's
`recenterFraction` spring-back never reaches the camera — all recoil is
permanent until pulled down.

## Benchmark methodology and results

`bun run benchmark:random` and `JEV_LIVE_TEST=1 bun run benchmark:jev` (direct
control, the original benchmark), and their `:precision` variants, run
repeatable episodes (`--control`, `--episodes`, `--seconds`, `--seed`, `--mode`) in a headless
browser against the dev server and write JSON to `shots/`. Every number comes
from the simulation — rounds the weapon runtime fired, damage the resolver
applied, kills and deaths the match recorded, metres the controller moved. A
statistic without samples prints as "n/a", never zero.

The headless tools replace `renderer.render` with a matrix update, because
software WebGL renders under one frame a second on a small container and `dt` is
clamped, which would slow match time twenty-fold while decisions kept arriving
in real time. The simulation reads matrices, not pixels, and runs at the
browser's 60 Hz; `tools/jev-harness.mjs` explains this in full and `--render`
turns it off.

**The existing bot policy** cannot sit in the player's seat — it drives its actor
directly and would have to be rewritten, and it was not. Instead each episode
also measures the player's own bot teammates in the same matches. That is
context, not a controlled comparison: bots see through their own 55° cone,
share contacts, aim continuously with no step quantisation and act every frame
with no latency; the player's seat takes half damage from bots and deals 1.2×,
and bots aiming at the player react later and with a wider cone.

**Measured, 26 September 2026, this build.** Four configurations, matched: three
episodes of 120 s of match time each, seeds 42, 43 and 44, team deathmatch, 11
bots at the default skill (the player plus 5 blue bots against 6 red), the
default loadout (an automatic rifle: 2.2° hip spread, 0.02° aimed), stubbed
rendering, a dev server in this repository's development container, and for
Jev live calls to TypeSafe (`jev-1.13.0`) over the internet. The raw reports,
every episode included, are in [`docs/benchmarks/2026-09-26/`](benchmarks/2026-09-26/).
There is no bad episode left out: these are all twelve that were run.

| Measure (3 × 120 s, seeds 42–44)                   | Random · direct | Random · precision | Jev · direct       | Jev · precision     |
| :------------------------------------------------- | :-------------- | :----------------- | :----------------- | :------------------ |
| Kills / deaths                                     | 0 / 1           | 4 / 4              | 15 / 4             | 148 / 0             |
| K/D                                                | 0.00            | 1.00               | 3.75               | 148:0               |
| Kills per minute                                   | 0.00            | 0.67               | 2.50               | 24.63               |
| Rounds fired / hits                                | 126 / 0         | 163 / 20           | 720 / 44           | 323 / 249           |
| Accuracy (hits / rounds)                           | 0.0%            | 12.3%              | 6.1%               | 77.1%               |
| Headshots / upper-chest hits                       | 0 / 0           | 4 / 13             | 8 / 14             | 122 / 99            |
| Shots per kill                                     | n/a             | 40.8               | 48.0               | 2.2                 |
| Damage per shot                                    | 0.0             | 6.5                | 3.9                | 55.6                |
| Damage dealt / taken                               | 0 / 476         | 1057 / 718         | 2788 / 817         | 17962 / 14          |
| Mean survival per life                             | 88.9 s          | 48.6 s             | 48.7 s             | 120.2 s             |
| Aim error at shot, mean / p95 †                    | 6.73° / 6.73°   | 1.70° / 5.76°      | 2.18° / 6.59°      | 0.28° / 0.30°       |
| Aim error, enemy ≤10° from crosshair, mean / p95 † | 7.34° / 9.36°   | 2.32° / 7.53°      | 2.20° / 6.55°      | 1.66° / 7.63°       |
| Engagement range at shot, mean                     | 70 m            | 66 m               | 82 m               | 103 m               |
| ADS time share                                     | 7.6%            | 8.6%               | 12.4%              | 21.7%               |
| Controller tracking error, mean / p95              | —               | 0.163° / 0.529°    | —                  | 0.083° / 0.305°     |
| Target acquisition, mean / p95                     | —               | 0.25 s / 0.41 s    | —                  | 0.33 s / 0.54 s     |
| Choice → first hit, mean / p95                     | —               | 0.41 s / 0.77 s    | —                  | 0.51 s / 0.79 s     |
| Targets bound / switches / lost from sight         | —               | 397 / 254 / 4      | —                  | 303 / 26 / 8        |
| Trigger opportunities held by the gate             | —               | 862 / 878 (98.2%)  | —                  | 2378 / 2657 (89.5%) |
| Recoil counter per shot, mean                      | —               | 0.405°             | —                  | 0.268°              |
| Decision → first controller step, mean             | —               | 1.7 ms             | —                  | 2.4 ms              |
| Distance moved                                     | 810 m           | 769 m              | 75 m               | 0 m                 |
| Decisions executed                                 | 1552            | 1490               | 1390               | 1479                |
| Timeouts / stale / invalid / errors                | 0 / 0 / 0 / 0   | 0 / 0 / 0 / 0      | 0 / 0 / 0 / 0      | 0 / 0 / 0 / 0       |
| Round trip, mean / p50 / p95                       | 1 / 1 / 2 ms    | 1 / 1 / 3 ms       | 212 / 209 / 260 ms | 209 / 207 / 261 ms  |
| Blue bots in the same matches: K / D, accuracy     | 88 / 55, 15.0%  | 71 / 53, 14.8%     | 49 / 51, 12.0%     | 29 / 24, 6.8%       |

Accuracy here counted hitbox strikes, not rounds: a round passing through an
arm into the chest counted twice. It is now counted once; the difference is
small at range and does not touch kills, deaths or damage.

† Measured the same way for every controller: the angle from the aim to the
_upper chest_ of the nearest visible enemy within 10° of the crosshair. For
headshot-heavy play it is biased upward — a head at 100 m sits about 0.3° above
the upper chest — which is why Jev precision reads 0.28° there while its own
tracking error, measured to the region it chose, is 0.08°.

Per episode (kills/deaths, hits/rounds):

| Seed | Random · direct | Random · precision | Jev · direct | Jev · precision |
| :--- | :-------------- | :----------------- | :----------- | :-------------- |
| 42   | 0/0, 0/42       | 2/1, 10/49         | 6/0, 17/240  | 43/0, 70/90     |
| 43   | 0/0, 0/40       | 1/2, 9/69          | 3/2, 9/240   | 59/0, 98/125    |
| 44   | 0/1, 0/44       | 1/1, 1/45          | 6/2, 18/240  | 46/0, 81/108    |

**What the numbers show.**

- **Precision control changed what Jev can do with its choices, dramatically.**
  Against its own direct-control runs on the same seeds: accuracy 6.1 % → 77.1 %,
  damage per shot 3.9 → 55.6, shots per kill 48 → 2.2, time from choosing a
  target to hitting it 0.51 s on average, and no deaths in 360 s. Direct Jev
  fired exactly 240 rounds in every episode — its entire load, rifle and reserve
  — and ran dry; precision Jev fired 90–125 and let the gate hold 89.5 % of the
  opportunities the trigger had.
- **The controller alone is not the result.** The random brain through the same
  controller went from 0 hits to 20 (12.3 %) and from 0 kills to 4 — and died as
  often as it killed, switching targets 254 times and firing hip shots the gate
  refused 98 % of the time. Jev's choices — engaging one target at a time (26
  switches), aiming down the sights, choosing the head at range (122 of 249 hits)
  — are what turned the controller into 148 kills.
- **It is also far beyond "usually wins a fair fight".** 148 kills to 0 deaths and
  14 damage taken is not a fair fight. Jev plays as a stationary marksman
  (0 m moved) and engages at about 100 m, where the rifle's 0.02° aimed spread
  still makes a head a one-round kill and where the bots — which deal half
  damage to the player, aim at the player with twice their usual error and react
  later (`PLAYER_MERCY`, `COMBAT`) — cannot answer. The blue bots' own tally
  fell from 88 kills to 29 in these matches because Jev took the kills first.
  Nothing in the simulation was changed to produce it, and every round was drawn
  and traced by the weapon runtime; but whether this is the right _strength_ for
  a spectator is a tuning question the benchmark raises, not one it answers.
- **Blue-bot accuracy (6.8–15 %)** is context, not a controlled baseline: the
  bots cannot sit in the player's seat, so the four configurations are compared
  to each other and the bots are the backdrop.
- **Latency is unchanged** — 209 ms mean round trip, p95 261 ms — and precision
  control asks six questions instead of four without measurably slowing it.

The live suite (`bun run jev:live`, 45 s) afterwards: 200 decisions, 29 targets
bound, tracking error p50 0.051°, 37 hits for 2,146 damage from 32 rounds, the
gate holding 227 of 259 opportunities, an injected API interruption shown as
ERROR with nothing held and recovered to LIVE JEV, and control handed back on H
— 13 of 13 checks.

**Earlier measurement (contract v1, direct control only).** The first benchmark
of this interface, before precision control existed — same seeds and settings,
an earlier build — recorded Jev 10 kills / 1 death at 3.6 % accuracy (697
rounds, 25 hits) and random 0 / 1. It is kept for the record; the direct row
above is its successor on this build.

## The marksman exploit

The 26 September benchmark above ends on a question it could not answer:
148 kills to 0 deaths, standing still, is not a fair fight — but was it the
model, the controller or the map? The experiments below, all on 27 September,
answer it. They run through `tools/experiment.mjs` on seeds 42–44, 3 × 120 s
per arm, team deathmatch, 11 bots at the default skill, one arm at a time,
rendering stubbed as above; the reports are in
[`docs/benchmarks/2026-09-27/`](benchmarks/2026-09-27/). The "before" arms ran
against a worktree of commit `ea55c93` served on its own port, the "after"
arms against `d77f16a`. No episode lagged real time.

**A script matches the model.** The strategy the benchmark found Jev playing —
hold still, aim down the sights, engage the enemy nearest the crosshair, the
head beyond 40 m — written as the `marksman` policy and run through the same
precision controller on the same seeds, on the old build:

| 3 × 120 s, seeds 42–44, precision control | Kills / deaths | Damage per round | Damage taken | Moved | Range at shot |
| :---------------------------------------- | -------------: | ---------------: | -----------: | ----: | ------------: |
| Jev (live, 26 September)                  |        148 / 0 |             55.6 |           14 |   0 m |         103 m |
| scripted `marksman`, old build            |        153 / 0 |             74.6 |           80 |   0 m |         109 m |
| scripted `skirmisher`, old build          |        168 / 0 |             52.4 |          116 | 763 m |         102 m |

A plain script did what the model did, so the finding was about the game.

**Why.** `tools/kill-anatomy.mjs` records what each victim was doing when the
seat killed it. On the old build, seed 42, 90 s: 32 kills; every victim could
see the shooter; 30 were sprinting (14 flanking, 14 charging in `engage`);
18 were fighting the seat's teammates at the time. Over the same 90 s the bots
fired 46 rounds at the seat with a median aim error of 3.9° at a median range
of 136 m — about nine metres of miss. Their aim is an angular cone tuned for
10–40 m, and the seat's mercy rules halved what little landed. The ground did
not matter, because nothing on it could reach a still shooter.

**What changed** (`d77f16a`; see [`docs/BLACKSITE.md`](BLACKSITE.md#distance-exposure-heat)):
heat shimmer beyond 45 m, for every seat; bots that bound between points hidden
from the shooter instead of charging, prefer routes it sees least of, and hold
and return fire when there is nowhere to go; a steady bot converging on a still
target in metres rather than degrees; a teammate's death giving the shooter
away; anyone firing within sight turning heads; spawns out of sight to the full
165 m; and `?seat=even` to remove the seat's mercy rules.

| 3 × 120 s, seeds 42–44      | Kills / deaths | Kills / min | Damage per round | Damage taken | Headshots | In a sight line | Longest stretch |
| :-------------------------- | -------------: | ----------: | ---------------: | -----------: | --------: | --------------: | --------------: |
| `marksman`, old build       |        153 / 0 |        25.5 |             74.6 |           80 |       150 |    not measured |    not measured |
| `marksman`, new build       |         81 / 0 |        13.5 |             51.2 |           43 |        78 |             35% |           9.5 s |
| `marksman`, new build, even |         78 / 0 |        13.0 |             43.7 |          108 |       104 |             36% |           8.9 s |
| `skirmisher`, old build     |        168 / 0 |        29.3 |             52.4 |          116 |       153 |    not measured |    not measured |
| `skirmisher`, new build     |        107 / 0 |        17.8 |             59.0 |          104 |        56 |             43% |          17.2 s |
| `random`, old build         |          5 / 2 |         0.8 |              8.2 |          634 |         7 |    not measured |    not measured |
| `random`, new build         |          2 / 1 |         0.3 |              3.9 |          173 |         3 |             93% |          63.8 s |

Per seed, kills/deaths, old → new: marksman 48/0 → 27/0, 44/0 → 32/0,
61/0 → 22/0; skirmisher 58/0 → 34/0, 65/0 → 34/0, 45/0 → 39/0.

**Halved, not solved.** The farming rate fell by half and headshots by half,
the seat now takes damage, and a death at range is now possible (one did
happen in a single-episode probe under even rules). But over six minutes the
still marksman was never killed, under either seat rule. The asymmetry that
remains is first-shot lethality: the precision controller, with its 0.06°
tremor, and a 0.02° aimed rifle kill within about three seconds of first
sight, and a bot that sees it has to react, turn and settle before its first
useful round. A further change — squads that learn where a still shooter is
looking and circle behind it — was built, measured and removed: the flankers
took the right routes and died crossing its field of view at ~100 m. Closing
the rest means a less steady controller or bots with marksman-grade aim; both
change what the benchmark measures, so it is left as an open, measured design
question rather than tuned until the number looked better.

**How much the results move by themselves.** The same configuration — the
skirmisher under places navigation, no added latency, new build — ran twice
(the first arm of the places experiment and the first of the horizon
experiment): 93 and 80 kills, 36 % and 43 % of life in a sight line, longest
stretches of 11.5 s and 16.1 s. Differences smaller than that are noise.

### Places against steps

The `places` experiment: the same policies with and without places.

| 3 × 120 s, seeds 42–44, new build | Kills / deaths | Damage taken | Moved | Range at shot | In a sight line | Longest stretch |
| :-------------------------------- | -------------: | -----------: | ----: | ------------: | --------------: | --------------: |
| `skirmisher`, places              |         93 / 0 |          180 | 605 m |          60 m |             36% |          11.5 s |
| `skirmisher`, steps               |         97 / 0 |           97 | 704 m |          75 m |             44% |          27.1 s |
| `random`, places                  |          1 / 1 |          182 | 912 m |         110 m |             59% |          52.3 s |
| `random`, steps                   |          7 / 2 |          335 | 799 m |          78 m |             78% |          78.5 s |

With places the skirmisher fought closer and kept its longest exposed stretch
under half as long, at the same kill rate; its mean exposure fell by about as
much as run-to-run noise. The random brain, which picks a place at random,
spent less of its life in sight lines — cover and hidden places are most of
what is on offer — and shot less well while walking. Places cost main-thread
time: finding them takes 5–11 ms per observation (p95 23 ms), paid five times a
second while the seat is under places navigation.

### Latency: what a faster model would gain here

The `horizon` experiment holds the policy fixed — the skirmisher, places,
precision control — and delays each answer:

| Injected answer latency         | Kills / deaths | Damage taken | First sight to kill | Moved | Decisions |
| :------------------------------ | -------------: | -----------: | ------------------: | ----: | --------: |
| 0 ms (a local policy)           |         80 / 0 |           52 |               2.6 s | 751 m |      1607 |
| 250 ms (today's Jev round trip) |         87 / 0 |          115 |               3.1 s | 489 m |      1202 |
| 600 ms (a slow remote model)    |         63 / 1 |          193 |               5.8 s | 350 m |       546 |
| 250 ms, deciding every 500 ms   |         76 / 0 |          164 |               3.6 s | 492 m |       688 |

With the aim and the walk executed locally, a quarter-second round trip costs
nothing this benchmark can see; at 600 ms the policy is measurably slower to
convert a sighting into a kill and kills about a quarter less. So on this
game, today, a model's speed is not the bottleneck; its choices are. A model
twice as fast would not play better here by speed alone — and a model that
slows toward half a second would.

### The live model on the new game

Two live experiments on 27 September, `jev-1.13.0` through TypeSafe, build
`9ba93e5`, precision control, mercy rules, seeds 42–44, 3 × 120 s per arm. No
timeouts, stale, invalid or failed decisions; round trip p50 163–168 ms, p95
218–220 ms. (A first attempt at `jev-live` failed before any decision: its
first page never started its match within the harness's 60 s. The rerun is
what is reported.)

| Jev, live                 | Kills / deaths | Rounds | Damage taken |   Moved | In a sight line | Range at shot |
| :------------------------ | -------------: | -----: | -----------: | ------: | --------------: | ------------: |
| 26 Sept., old game, steps |        148 / 0 |    323 |           14 |     0 m |    not measured |         103 m |
| stepped movement          |         58 / 0 |    231 |           21 |     0 m |             52% |         117 m |
| places, nearest first     |          8 / 0 |     25 |           23 | 1 085 m |             22% |          75 m |
| places, shuffled order    |         38 / 0 |    106 |          238 |   996 m |             39% |  not compared |

- **On the new game the same model with the same interface kills 61 % less**
  (148 → 58), still standing still: the exposure changes act on a live model
  as they did on the script.
- **Given places, it moves.** 1 085 m where it had moved 0 m in every earlier
  run; 208 place choices, 190 of them cover. Its time in enemy sight lines
  more than halved (52 % → 22 %). It also nearly stopped fighting — 25 rounds
  in six minutes. No death in either arm.
- **It chose `PLACE_0` in 208 of 208 choices.** With places listed nearest
  first that is either a preference for the nearest cover or for the first
  option shown, and slot order is presentation the host controls.
  `?placeOrder=shuffled` lists the same places in a seeded random order: the
  slots it chose spread (62 / 44 / 29 for slots 0 / 1 / 2) while the kind held
  (125 of 135 cover, 93 %, against 91 %). The preference is for cover. Order
  still pulled it toward the top of the list, which is why the default is a
  documented choice rather than an accident. With shuffled order it also
  fought more (38 kills; per seed 4, 20, 14), which three episodes cannot
  explain.

What this shows is a behaviour, not a ranking: offered a way to hide, the
model hides. Whether that is good play depends on the mode — in team
deathmatch it gives up kills; in an objective mode it might not — and that is
the next experiment, not a conclusion.

## A conventional LLM in the seat

`/play?brain=llm`, `server/llm/`, `api/llm/decision.ts`. A second remote brain
behind the same seam, so the question "is this Jev, or would any capable model
do the same here?" can be asked on matched seeds.

- **The same question.** The server builds the LLM's prompt from
  `questionParts()` — the function Jev's TypeSafe request is built from — so the
  context, the rendered state, each question and each option's description are
  the same text. `server/llm/handler.test.ts` fails if they diverge. The format
  instructions say how to answer and nothing about how to play.
- **The same boundary.** Same-origin JSON under 8 KiB holding
  `{ session, observation }`, the shared validator, the same rate limits, a
  server-built question: not a prompt proxy. The key (`LLM_API_KEY`) is read
  only by `api/llm/decision.ts` and the Vite middleware; `secretBoundary.test.ts`
  and the build-output scan cover it as they cover TypeSafe's.
- **Provider and model are configuration**, never code: `LLM_PROVIDER`
  (`anthropic`, through the official SDK, or `openai-compatible`), `LLM_MODEL`,
  `LLM_BASE_URL`, `LLM_EFFORT`, `LLM_CONFIDENCE` (`verbalized` or `none`),
  timeouts, retries and a token cap — see `.env.example`. Server-side
  refusal fallbacks to another model are deliberately not enabled: a different
  model silently answering part of an arm would confound it. Each answer
  (`blacksite-llm-decision/v2`) carries `requestedModel`, what the server asked
  for, and `model`, what the provider says served it — `null` when the provider
  did not say, never filled in from configuration.
- **Every answer is validated** against the options offered. Malformed output
  is `upstream_invalid` and is not retried (resampling until valid would hide
  the failure); a refusal is `upstream_refused`; rate limits, overload, 5xx and
  dropped connections are retried within the deadline and the retries are
  returned with the decision.
- **Stated differences from Jev.** Jev answers each axis as a separate question,
  in parallel, with a probability for every option; the LLM answers all axes in
  one completion and, under `verbalized`, writes a confidence per axis, recorded
  with that source and never presented as a probability. The LLM's loop limits
  are 12 s to answer and 12 s of maximum answer age, against Jev's 2.2 s and
  1.5 s, declared in `LLM_CAPABILITIES` and recorded with every result, because
  under Jev's limits it could never act; every late answer is still revalidated
  at execution.
- **Offline.** `bun run llm` plays `/play?brain=llm` against
  `tools/fake-llm.mjs`, a blind test double that picks uniformly among the
  offered options, served on its own dev server; the real endpoint, adapter,
  validation, revalidation and records all run. Its model id is
  `fake-llm-test-double` and every report labels it TEST DOUBLE. Live runs need
  `LLM_LIVE_TEST=1`.

No live LLM run has been made in this repository yet; the comparison
experiment (`tools/experiments/llm-comparison.json`) is declared and pending.

## Fastino's Glide in the seat

`/play?brain=glide`, `server/glide/handler.ts`, `api/glide/decision.ts`.
Fastino serves the SystemOne Choice protocol TypeSafe does — a state, a set of
Choice questions asked in parallel, and per question a choice, a confidence and
a probability for every option — with its `fastino/glide` model. So Glide is
not a third integration but Jev's, pointed at another provider.

- **The same handler, the same words.** `createSystemOneDecisionHandler` in
  `server/jev/handler.ts` serves both endpoints; Glide's differs only in the
  `SystemOneUpstream` it is given (`FASTINO_UPSTREAM`). Body limits, the
  same-origin rule, rate limits, the server-built question and the answer
  validation are the same code. `server/glide/handler.test.ts` fails if
  Glide's state, questions, options or words drift from Jev's.
- **One envelope difference.** Fastino takes a question's `instructions` as a
  single string and answers an object with a 422, so the context and the
  question are joined with a blank line (`joinInstructions`). Jev still gets
  them as separate fields.
- **Its own credential, model and source.** `FASTINO_API_KEY` is read only by
  `api/glide/decision.ts` and the Vite middleware; `secretBoundary.test.ts`
  and the build-output scan cover it, including Fastino's `fast_sk_` key shape.
  `FASTINO_MODEL` defaults to `fastino/glide` and also takes a fine-tuned
  model's training-job UUID. Every answer carries `source: "fastino"` and the
  model Fastino reports running (`glide`); the browser refuses a Fastino answer
  as Jev's and a TypeSafe answer as Glide's, and the HUD labels it LIVE GLIDE.
  Its probabilities are recorded as `provider-probability`, Fastino's own.
- **Stated difference: time.** Glide answers more slowly than Jev, and how
  much more depends on the question. `GLIDE_CAPABILITIES` declares 8 s to
  answer and 8 s of maximum answer age, against Jev's 2.2 s and 1.5 s; the
  server abandons the Fastino call at 7.5 s. The negotiated limits are
  recorded with every result, and every late answer is still revalidated at
  execution. `?fallback=random` works for Glide as it does for Jev.
- **Cost unknown.** Fastino's model list prices other models but not Glide,
  and `config/pricing.json` prices nothing, so a Glide run's cost is reported
  as unknown. The token counts Fastino returns are recorded.
- **Offline first.** `bun run glide` plays `/play?brain=glide` against a fake
  endpoint inside the test browser: the label, execution, the negotiated
  limits, decision records, refusal of a TypeSafe-sourced answer, the
  unavailable state, takeover, the menu, and the answer-age contrast (an
  answer three seconds late acts under Glide and times out under Jev). Live
  runs need `FASTINO_LIVE_TEST=1`: `bun run glide:live` (`-- --control
direct` for the original interface) and `bun run benchmark:glide`.

### First live runs (2026-10-05)

One dev server in a cloud container, the real Fastino endpoint, seed 42, 45 s
of match time per control, `bun run glide:live`. Latency is the server's
measurement of the Fastino call.

| Control   | Accepted / requested | Timeouts | Latency p50 | p95     | max     | Kills | Deaths | Rounds | Hits |
| :-------- | :------------------- | :------- | :---------- | :------ | :------ | :---- | :----- | :----- | :--- |
| precision | 23 / 26              | 2        | 911 ms      | 3048 ms | 3343 ms | 3     | 0      | 10     | 7    |
| direct    | 22 / 25              | 2        | 790 ms      | 3277 ms | 5251 ms | 0     | 0      | 15     | 0    |

Every plumbing check passed in both runs: Fastino answered, reported `glide`,
the HUD said LIVE GLIDE, every record carried Fastino's probabilities, the
browser sent only `{ session, observation }`, no request or response carried a
credential, and takeover released every control. Under precision control Glide
held position in 21 of 23 decisions and chose the enemy nearest the crosshair
(`TARGET_0`) in 12, no target in 11, always at centre mass; under direct
control it held position in all 22 and turned in steps without a hit. One seed
and 45 s per control is a smoke test of the integration, not a result about
the model.

The same day, `bun run benchmark:glide -- --seeds 42,43 --seconds 60` ran two
60 s episodes under precision control with places navigation, the defaults:

| Measure             | Value                                                   |
| :------------------ | :------------------------------------------------------ |
| decisions           | 60 accepted of 66 requested; 0 stale, 0 invalid         |
| upstream timeouts   | 6, each the server abandoning Fastino at 7.5 s          |
| round trip          | p50 971 ms, p95 3252 ms                                 |
| server → Fastino    | p50 930 ms, p95 3189 ms                                 |
| kills / deaths      | 9 / 0 (2 and 7 by seed)                                 |
| rounds / hits       | 22 / 17                                                 |
| choices             | `HOLD` 58 of 60; `TARGET_0` 30, `NONE` 27, `TARGET_1` 3 |
| tokens per decision | about 3,000 in and 4 out, as Fastino reported them      |
| cost                | unknown: no price is configured                         |

The seat fought under the default mercy rules, and the precision motor
controller executed every aim: these numbers describe Glide's choices and that
controller together, on two seeds. They are not a comparison with Jev, which
would need a matched experiment on the same seeds.

### Jev and Glide on the same seeds (2026-10-05)

That matched experiment followed: `tools/experiments/glide-jev-comparison.json`,
declared and committed before it ran, with Jev, Glide and a random floor on
the same two seeds and settings. The full account, every episode and the
compressed decision records are in
[`docs/benchmarks/2026-10-05/`](benchmarks/2026-10-05/README.md).

| Arm    | Kills / deaths | Rounds / hits | Decisions | Round trip p50 / p95 | Answers that met a changed world | Time in a sight line |
| :----- | :------------- | :------------ | --------: | :------------------- | :------------------------------- | -------------------: |
| Jev    | 5 / 0          | 7 / 5         |       501 | 197 / 266 ms         | 1.4%                             |                31.3% |
| Glide  | 5 / 0          | 17 / 10       |       115 | 830 / 3,137 ms       | 20.0%                            |                53.9% |
| random | 0 / 1          | 75 / 0        |       508 | 11 / 35 ms           | 0%                               |                87.9% |

The declared prediction — Jev's kills per minute at least Glide's on each
seed — failed: Glide out-killed Jev four to two on seed 43, and the arms tied
at five kills overall. Glide decided a quarter as often and a fifth of its
answers met a changed world, as predicted, without costing it kills. The two
played differently: Jev declined to fire in 98% of decisions and moved more;
Glide never used the movement axis, moved only by places, fired more and took
damage where Jev took none. Two one-minute seeds under mercy rules and the
precision controller is exploratory, not a ranking.

### Ten seeds, even rules (2026-10-05)

Two follow-ups, declared and committed before they ran, used the 10-seed
development preset (seeds 42–51), 120 s episodes and even seat rules:
`glide-jev-even.json` with the precision controller and the scripted marksman
as a strategy check, and `glide-jev-direct.json` with each model aiming for
itself. Every episode, the paired differences and the calibration tables are
in [`docs/benchmarks/2026-10-05/`](benchmarks/2026-10-05/README.md).

| Arm (20 min of match each) | Kills / deaths | Rounds / hits | Decisions | Round trip p50 | Time in a sight line | Engage-disengage success |
| :------------------------- | :------------- | :------------ | --------: | -------------: | -------------------: | :----------------------- |
| Jev, precision             | 28 / 4         | 129 / 58      |     4,744 |         208 ms |                24.2% | 57.8% (n=225)            |
| Glide, precision           | 37 / 10        | 131 / 109     |       960 |         810 ms |                44.3% | 78.5% (n=107)            |
| Marksman script, precision | 267 / 0        | 1,292 / 609   |     5,303 |          19 ms |                44.8% | 98.0% (n=1,282)          |
| Random, precision          | 2 / 14         | 555 / 15      |     5,023 |          16 ms |                48.4% | 14.8% (n=985)            |
| Jev, direct                | 1 / 8          | 107 / 2       |     4,656 |         212 ms |                27.8% | 3.0% (n=542)             |
| Glide, direct              | 1 / 13         | 438 / 5       |       758 |         791 ms |                67.1% | 6.6% (n=366)             |
| Random, direct             | 0 / 10         | 552 / 0       |     5,090 |          16 ms |                48.0% | 0.0% (n=254)             |

- **Even rules, precision: the prediction held.** Glide's deaths per minute
  exceeded Jev's by 0.30, with a paired 95% interval of 0.12 to 0.48, higher on
  7 of 10 seeds. Kills did not separate (interval −0.87 to +1.77 a minute).
- **Direct control: the prediction failed.** It said Jev's faster decisions
  would out-aim Glide. Each scored one kill, and neither is distinguishable
  from random. The aiming controller does nearly all of the shooting, so a
  precision result is the model's choice of whom to fight plus the
  controller's aim.
- **The marksman is neither model, and beats both.** It never moved and never
  died, and the evaluation's stationary-dominance warning fires even under
  even rules. The game still rewards holding still at range.
- **Calibration.** Each model's probability for its weapon choice predicted
  engage-disengage success no better than the base rate (Brier 0.339 for Jev
  against 0.244, 0.202 for Glide against 0.169). These are probabilities of a
  choice, not forecasts of a fight.

The two experiments ran concurrently from a frozen checkout, each against its
own dev server; no episode lagged (the slowest took 1.9% more wall time than
match time).

## The evaluation harness

Everything above measures a brain's play. [`EVALUATION_PHILOSOPHY.md`](EVALUATION_PHILOSOPHY.md)
explains how the harness turns that into evidence a reader can check; in short:

- **Decision records** (`blacksite-decision/v1`): every accepted decision, with
  the observation, the options, the choice, its stated confidence and where the
  number came from, its accounting (latency, bytes, tokens, cost), its
  revalidation, what the controllers did with it, and a five-second **outcome
  window** of what the world did next (`pilot/outcomes.ts`). The benchmark writes
  them per episode beside each report.
- **Declared experiments** (`blacksite-experiment/v1`): question, hypothesis,
  primary metric, outcome contract, seeds and arms, validated and hashed before
  anything runs; paid arms run only with their flag and are otherwise PENDING.
- **Outcome contracts** (`eval/outcomeContracts.ts`): cover selection, threat
  priority, engage/disengage, navigation, reload and shot decisions, each with a
  versioned rule for beneficial, neutral and harmful.
- **The evaluation** (`blacksite-evaluation/v1`, `tools/experiment.mjs`): every
  episode, aggregates with intervals, paired differences by seed, calibration,
  the computational ledger, staleness, latency sweeps, matched-ablation
  contrasts and benchmark warnings; readable at `/evaluation`.
- **Shadow agreement** (`blacksite-shadow/v1`, `src/game/eval/shadow.ts`,
  `node tools/experiment.mjs --shadow <run dir>`): each recorded observation
  shown, in order, to the scripted reference policies, with per-axis agreement
  against the exact agreement of a uniform chooser; episodes are the unit, and
  fallback and replayed frames are set aside. Agreement on identical inputs —
  not a counterfactual outcome and not a skill score (see
  [Same observations, other minds](EVALUATION_PHILOSOPHY.md#same-observations-other-minds)).
- **New seat parameters** for experiments: `?stale=strict|observe`,
  `?motor=standard|degraded` (a slower, shakier, later hand for controller
  ablations), `?targetOrder=nearest|shuffled`, `?outcomeWindow=<s>`.

## Security

- The key is read in exactly three places, all server-side:
  `api/jev/decision.ts`, `api/rain/_config.ts` (for the R.A.I.N. Lab's optional
  bounded decisions) and the Vite middleware. `src/game/pilot/secretBoundary.test.ts` fails if
  browser code mentions or reads it, imports server code, or if another file
  starts reading it.
- `bun run build` ends with `tools/jev-secret-scan.mjs`, which fails the build if
  `dist/` — source maps included — contains the variable's name, anything
  shaped like a TypeSafe key, or the configured key's value when it is present
  in the build environment (as it is on Vercel). Verified here with the real key
  set: clean. A local `vercel build` produced a function bundle containing only
  `server/jev/*` and the three shared contract modules, and no key.
- The browser sends `{ session, observation }` and nothing else;
  `bun run jev:live` asserts that on every request. No response, header or log
  line carries the key; `server/jev/handler.test.ts` asserts that for the
  success path and for 401, 500 and network failures — including an upstream
  error body and an exception message that echo it.
- The session id is random per page and used only for pacing; it is not an
  identity, and nothing is stored server-side beyond the in-memory limiter.

## The analytical boundary

Jev belongs entirely to the illustrative simulation. It writes nothing to the
evidence ledger, changes no classification, uncertainty or provenance, and
makes no claim about real activity, procedures, tactics or layouts at Lop Nur.
It uses the geometry `/play` already uses — the same reconstruction, baked into
collision — and nothing else. The route's standing disclaimer ("Illustrative
simulation — not operational data") is unchanged and stays outside the HUD.

## Live and mock

The running application has no mock mode. A decision on screen is either a
validated answer from the provider its label names (LIVE JEV, LIVE GLIDE, LIVE
LLM) or visibly labelled as something else (HUMAN, FALLBACK, RANDOM, SCRIPTED,
REPLAY).

Test doubles exist only in tests: `src/game/pilot/testing/fixtures.ts` and
`src/game/eval/testing/fixtures.ts` (imported by `*.test.ts` only); a fake
endpoint that `tools/jev.mjs` installs by request interception inside its own
test browser, and the in-browser fake in `tools/glide.mjs`; and
`tools/fake-llm.mjs`, which `bun run llm` and experiment arms marked `fakeLlm`
run on a dev server of their own. The offline suites assert that no decision in
them came from a real provider. Nothing in ordinary CI spends API credit; live
runs require `JEV_LIVE_TEST=1`, `FASTINO_LIVE_TEST=1` or `LLM_LIVE_TEST=1` and a
configured key.

| Command                                                             | Calls TypeSafe | What it checks                                                                                                                                                                                                   |
| :------------------------------------------------------------------ | :------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run test:jev`                                                  | no             | unit tests: contract, schema, executor, motor controller, fire gate, engagement axes, places, navigator, debrief, capabilities, policies, authority, loop, providers, recorder, metrics, server, secret boundary |
| `bun run jev`                                                       | no             | browser checks: random brain, Jev client against a fake, precision control, places navigation, Elite Operator, failures, outage, takeover, switching, death, respawn, replay, hostile parameters                 |
| `JEV_LIVE_TEST=1 bun run jev:live`                                  | yes            | live decisions, model version, request shape, outage recovery, takeover                                                                                                                                          |
| `bun run benchmark:random` / `benchmark:random:precision`           | no             | episodes with the random brain, direct / precision control                                                                                                                                                       |
| `JEV_LIVE_TEST=1 bun run benchmark:jev` / `benchmark:jev:precision` | yes            | episodes with Jev, direct (the original benchmark) / precision control                                                                                                                                           |
| `bun run replay:jev -- trace.jsonl`                                 | no             | replays a recorded control stream                                                                                                                                                                                |
| `bun run scan:secrets`                                              | no             | the build-output credential scan                                                                                                                                                                                 |
| `bun run llm`                                                       | no             | the LLM seat end to end against the offline test double                                                                                                                                                          |
| `bun run glide`                                                     | no             | the Glide seat against an in-browser fake: label, execution, negotiated limits, records, wrong-provider refusal, outage, takeover, menu                                                                          |
| `FASTINO_LIVE_TEST=1 bun run glide:live` / `benchmark:glide`        | Fastino        | live Glide decisions, model, labels, probabilities, request shape, credential absence, takeover / benchmark episodes                                                                                             |
| `node tools/experiment.mjs tools/experiments/<x>.json`              | only flagged   | a declared experiment and its evaluation; Jev, Glide and LLM arms run only with `JEV_LIVE_TEST=1` / `FASTINO_LIVE_TEST=1` / `LLM_LIVE_TEST=1`, and are PENDING otherwise                                         |
| `node tools/experiment.mjs --shadow <run dir>`                      | no             | same observations, other minds: a run's recorded observations shown to the scripted policies, per-axis agreement against exact chance                                                                            |

## Limitations

These are the boundaries of the experiment as it now stands, not failures.

- **Latency is not solved; it is separated.** Remote inference remains slower
  than frame-level control: every Jev decision is about a situation 150–450 ms
  old by the time it executes, and Jev decides about four or five times a
  second. Precision control does not hide that — it gives the motor work to a
  local controller that runs every frame and leaves Jev the decisions that
  survive the delay: which enemy, which region, whether to fire, where to move.
  A slower network still means a slower Jev: later target choices, later
  switches, later reactions to a new threat.
- **Jev's cognition and the local execution are different things.** Under
  precision control the accuracy, tracking error, recoil control and trigger
  discipline in the results belong to Jev's choices _and_ a deterministic,
  hand-designed controller. The comparison that isolates Jev's contribution is
  the random brain through the same controller (`random · precision`). Direct
  control remains available, unchanged, for the question "how well does the
  model aim by itself".
- **The local controller is motor assistance, bounded and documented.** It is
  tuned to an elite human's limits — 560 °/s peak, 4,200 °/s², a 50 ms
  perceptual delay, a 0.06° tremor, 90 % of the learned recoil pattern — and
  those limits are choices, not measurements of any person. It sees only what a
  sight line reaches and never picks a target, but it is steadier and faster to
  settle than most people. Elite Operator gives a human a deliberately weaker
  version of the same kind of help.
- **Network and service dependence.** LIVE JEV needs the TypeSafe service, the
  deployment's key and a working network. When any of them fails the seat says
  so (TIMEOUT, UNAVAILABLE, ERROR), the controller lets go within a second, and
  the player idles — or, with `?fallback=random`, a labelled FALLBACK acts.
- **API cost.** Every decision is a TypeSafe request — about 270 a minute in
  play, with up to seven questions each under precision control and places
  navigation (the default). Nothing in ordinary CI
  spends credit; benchmarks and live checks require `JEV_LIVE_TEST=1`.
- **Rate limits are per instance** (see [The server boundary](#the-server-boundary)),
  and the TypeSafe account's own limit (1,200 requests per minute at the time of
  writing) caps concurrent spectators at roughly four before 429s.
- **Hand-designed observation semantics.** What Jev reads — which facts, in what
  words, the size classes, the hit-share bands — was written by hand and tuned on
  short runs. A different rendering could change its choices.
- **Places are sampled straight walks.** The navigator walks straight lines
  with feelers; the finder checks standing clearance and body width within
  128 m. A sampled check may still miss geometry, and long or obstructed
  objectives are not offered as places. Cover
  behind a building's far side, reachable only round a corner, is not offered.
  The navigation grid in `ai/navmesh.ts` would lift this and is not used yet.
- **"Hidden" means hidden from known threats.** A place is hidden from the
  enemies the observation reports, which is exactly what a brain knows and not
  necessarily all there are.
- **The results are environment-specific.** The site is large and open, bots
  spawn 45–135 m from the fight and the reference rifle's aimed spread is 0.02°,
  so most engagements are long, ADS, first-shot contests that reward steady
  aim. Under the player-seat rules (half damage taken, 1.2× dealt, bots slower
  and wider when aiming at the player) a controller that holds still and aims
  well is at its strongest here; closer, cover-heavy maps would test different
  skills.
- **Perception is close to a person's, not identical.** Since v3 the human
  HUD shows enemies only as a brain is told about them, and a brain gets the
  teammates the radar shows. A person still hears footsteps and reads pixels;
  a brain gets exact bearings and distances. The human now also reads the
  captured places list, although it shows only two entries at a time.
- **Replay reproduces controls, not outcomes.** A replayed target or place
  slot names what occupies that slot at replay time. Navigation-only frames
  refresh place slots even with target NONE and under direct control. Traces
  carrying the older observation v3 are rejected because hidden-place semantics
  changed; their saved evaluation artifacts still load.
- **The benchmarks are small** — three two-minute episodes per configuration —
  and headless, with rendering stubbed. Treat them as a measurement of this
  build on this machine, not a ranking.
- **Very slow clients degrade to TIMEOUT.** When a frame takes longer than the
  2.2 s request timeout (seen under software rendering), answers arrive too late
  and are discarded; the player idles rather than acting on a stale decision.

## Files

| Path                                                          | Role                                                                      |
| :------------------------------------------------------------ | :------------------------------------------------------------------------ |
| `src/game/pilot/contract.ts`                                  | action vocabulary, descriptions, timing (shared with the server)          |
| `src/game/pilot/observation.ts`                               | observation schema, validator, legal actions (shared)                     |
| `src/game/pilot/decision.ts`                                  | decision schema and validation (shared)                                   |
| `src/game/pilot/perception.ts`                                | builds observations from the live game                                    |
| `src/game/pilot/executor.ts`                                  | control frame → `InputState`, with expiry                                 |
| `src/game/pilot/motor.ts`                                     | the precision motor controller: tracking, recoil feed-forward, fire gate  |
| `src/game/pilot/hitGeometry.ts`                               | aim points, angular sizes, spread-cone share (shared with the server)     |
| `src/game/characters/hitboxSpecs.ts`                          | the one hitbox table colliders and aim geometry read                      |
| `src/game/player/eliteAssist.ts`                              | Elite Operator, the human aim help                                        |
| `src/game/pilot/places.ts`, `navigator.ts`                    | places navigation: the finder and the local walking controller            |
| `src/game/pilot/debrief.ts`                                   | what the seat perceived, against what happened                            |
| `src/game/pilot/capabilities.ts`                              | capability negotiation (shared with the server)                           |
| `src/game/pilot/policies.ts`                                  | the scripted reference policies                                           |
| `src/game/world/mirage.ts`                                    | heat shimmer: how far a body at range appears displaced                   |
| `tools/experiment.mjs`, `tools/experiments/*.json`            | matched experiments and their questions                                   |
| `tools/kill-anatomy.mjs`                                      | what each victim was doing when the seat killed it                        |
| `src/game/pilot/loop.ts`                                      | one request in flight, sequences, staleness, timeouts, backoff, fallback  |
| `src/game/pilot/providers.ts`                                 | the Jev HTTP brain and the seeded random brain                            |
| `src/game/pilot/pilot.ts`                                     | the pilot seat: brain selection, frames, takeover, telemetry              |
| `src/game/pilot/recorder.ts`, `traceStorage.ts`               | JSONL traces, replay parsing, local storage                               |
| `src/game/pilot/metrics.ts`                                   | episode statistics and benchmark aggregation                              |
| `src/game/pilot/rigState.ts`, `PilotHost.tsx`                 | rig facts for perception; lifecycle, H key, dev handle                    |
| `src/game/hud/JevHud.tsx`                                     | the panel and the Player control selector                                 |
| `server/jev/handler.ts`, `question.ts`, `rateLimit.ts`        | the endpoint                                                              |
| `api/jev/decision.ts`                                         | the Vercel Function                                                       |
| `tools/jev*.mjs`                                              | browser checks, benchmark, replay, secret scan                            |
| `src/game/pilot/brain.ts`, `llmDecision.ts`                   | brain descriptors and accounting; the LLM decision schema (shared)        |
| `src/game/pilot/staleness.ts`, `outcomes.ts`                  | revalidation at execution; per-decision outcome windows                   |
| `server/llm/`, `api/llm/decision.ts`                          | the LLM endpoint: prompt, adapters, handler                               |
| `src/game/eval/`                                              | records, contracts, statistics, calibration, ledger, warnings, evaluation |
| `src/routes/evaluation.tsx`, `src/game/eval/ui/`              | the `/evaluation` page                                                    |
| `config/pricing.json`                                         | the only place a model price may live (none is set)                       |
| `tools/experiment.mjs`, `tools/fake-llm.mjs`, `tools/llm.mjs` | experiments and evaluations; the offline LLM test double                  |
| `server/glide/`, `api/glide/decision.ts`, `tools/glide.mjs`   | Glide: Fastino's SystemOne endpoint, its function and browser checks      |

The shared modules (now also `hitGeometry.ts` and `characters/hitboxSpecs.ts`)
import each other as `./x.js`: the Vercel function runs as
native Node ESM, which resolves nothing without an extension, and TypeScript and
Vite map `./x.js` back to `./x.ts`. Keep them free of `@/` aliases for the same
reason.
