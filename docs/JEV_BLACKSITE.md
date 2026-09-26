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
- [Decision cadence and timing](#decision-cadence-and-timing)
- [The server boundary](#the-server-boundary)
- [Configuration, local development and deployment](#configuration-local-development-and-deployment)
- [Human takeover](#human-takeover)
- [The HUD](#the-hud)
- [Random baseline, fallback, recording and replay](#random-baseline-fallback-recording-and-replay)
- [Tuning the interface](#tuning-the-interface)
- [Benchmark methodology and results](#benchmark-methodology-and-results)
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
TypeSafe Jev — four Choice questions answered in parallel
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

`src/game/pilot/contract.ts`, versioned `blacksite-jev-actions/v2`. A decision
is one **control frame**: exactly one action per axis — `move`, `turn`, `tilt`,
`weapon`, `target`, `aim`.

**An axis with a single legal option is not a choice, and is not asked.** In
direct control `target` is always `NONE` and `aim` always `CENTER_MASS`, so the
server sends TypeSafe exactly the original four questions and the decision
carries `null` for the other two — no probability or confidence is invented
for them. In precision control, with `n` enemies listed, `target` offers `NONE`
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
current stance, no jump in the air, no tilt past 80°. Every axis always keeps at
least two options.

## The observation

`src/game/pilot/observation.ts`, versioned `blacksite-jev-observation/v2`. It
holds only numbers, booleans and strings from closed vocabularies; the validator
rejects unknown fields, out-of-range numbers and oversized arrays.

```text
interface JevObservation {   // a sketch; the exact types are in observation.ts
  schemaVersion: "blacksite-jev-observation/v2";
  actionContract: "blacksite-jev-actions/v2";
  sequence: number;                       // monotonic per page
  control: "direct" | "precision";
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
  };
  objective: { kind: "none" | "zone" | "hardpoint"; bearingDeg; distanceM; state };
  previous: { frame: ControlFrame | null; outcome: { shotsFired; hitConfirmed; killConfirmed; damageTaken; movementBlocked } | null };
  legal: { move: []; turn: []; tilt: []; weapon: []; target: []; aim: [] };
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
current and the fully aimed spread cone would put on it:

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
5. Asks TypeSafe four Choice questions in one request, with a 1.8 s timeout.
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
function and no credential. `/api/*` answers 404 in the endpoint's own error
shape, and `/play?brain=jev` shows JEV UNAVAILABLE.

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

Each axis shows the choice, its probability and TypeSafe's confidence, then up
to three candidates as TypeSafe ranked them; a long top three wraps between
candidates rather than cutting one off. The weapon row lists two because only
two were legal: a reload was in progress, which rules out firing, aiming and
reloading.

**Labels** say who is in control: **LIVE JEV** only while TypeSafe's answers are
executing; **FALLBACK** from the first fallback frame until Jev answers again;
**RANDOM**; **REPLAY**; and **JEV UNAVAILABLE** when the service cannot answer.
Probabilities and confidence are shown only when TypeSafe supplied them — the
random brain shows "uniform over legal options", and nothing is ever filled in.

**Statuses**: OFF, CONNECTING, OBSERVING, DECIDING, EXECUTING, TIMEOUT,
UNAVAILABLE, ERROR, DEAD, RESPAWNING, PAUSED, MATCH_COMPLETE.

The menu's **Player control** selector (Human / Jev / Random / Replay) explains
each choice and probes the service before a match: "Jev ready · jev-latest" or
"Jev unavailable — …".

## Random baseline, fallback, recording and replay

**Random** (`/play?brain=random&seed=42`) uses the same observation, the same
legal options, the same cadence limits and the same executor. Under direct
control it draws exactly four numbers per decision from `mulberry32(seed)` — one
per axis, as it always has, so a seed's frames are unchanged
(`engagement.test.ts` re-derives them from the stream); under precision control
it draws six, adding a target slot and an aim region, and its engagements then
run through the same motor controller. It picks uniformly among the legal
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
and invalid answers, deaths, respawns, takeovers. **Save trace** downloads it;
`?record=1` also keeps the last trace in local storage at the end of a match. No
trace can contain the credential: it never reaches the browser.

<a id="replay"></a>**Replay** (`/play?brain=replay&trace=last`, the menu's
**Load trace**, or `bun run replay:jev -- trace.jsonl`) re-issues each recorded
frame at its recorded simulation time through the same executor, with no model
call, labelled REPLAY. Traces with another trace, contract or observation
version, or with a control this build does not know, are refused. What a replay
reproduces is the **control stream**: `replay:jev` checked 84 of 84 frames of a
recorded run executed in order. Traces are now `blacksite-jev-trace/v2`; the
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

`bun run benchmark:random` and `JEV_LIVE_TEST=1 bun run benchmark:jev` run
repeatable episodes (`--episodes`, `--seconds`, `--seed`, `--mode`) in a headless
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

**Measured, 26 September 2026.** Three episodes of 120 s of match time per brain,
seeds 42–44, team deathmatch, 11 bots at the default skill (player plus 5 blue
bots against 6 red), local dev server in this repository's development container
calling TypeSafe over the internet. Six episodes are a small sample; treat these
as a first measurement, not a ranking.

| Measure (360 s of match per brain)  | Jev (`jev-1.13.0`, live)                     | Random (seed 42–44) |
| :---------------------------------- | :------------------------------------------- | :------------------ |
| Kills / deaths                      | 10 / 1                                       | 0 / 1               |
| Kills per minute                    | 1.66                                         | 0.00                |
| Rounds fired / hits                 | 697 / 25 (3.6%)                              | 144 / 0 (0%)        |
| Damage dealt / taken                | 1,658 / 556                                  | 0 / 730             |
| Mean survival per life              | 88.9 s                                       | 88.8 s              |
| Distance moved                      | 15 m                                         | 815 m               |
| Decisions executed                  | 1,537                                        | 1,593               |
| Timeouts / stale / invalid / errors | 0 / 0 / 0 / 0                                | 0 / 0 / 0 / 0       |
| Round trip, browser ↔ TypeSafe      | mean 179 ms, p50 172 ms, p95 231 ms          | < 1 ms              |
| Server ↔ TypeSafe                   | mean 167 ms, p50 163 ms, p95 214 ms          | —                   |
| Mean TypeSafe confidence            | move 0.68, turn 0.54, tilt 0.68, weapon 0.48 | —                   |

Per episode, Jev: 2 kills / 1 death, 6 / 0, and 2 / 0. Blue bots in the same
matches, for context: 84 kills and 43 deaths in the Jev episodes, 88 and 68 in
the random episodes (about 30 bot-minutes each).

What the numbers show, and do not: Jev engaged, aimed and fired through the same
controls and scored kills where the random policy scored none, under identical
conditions. Jev also almost never moved (1,520 of 1,537 frames were HOLD) — it
plays as a stationary shooter, which the bots, converging on the player, make
viable. Win rates are not reported: two-minute episodes in which ten bots do
most of the fighting cannot attribute a team result to the player.

A separate 60-second live check (`bun run jev:live`) made 278 decisions, fired
240 rounds, executed 9 reload frames, landed 22 hits for 1,608 damage, rode out
an injected three-second API outage with nothing held and recovered to LIVE JEV,
and handed control back on H.

## Security

- The key is read in exactly two places, both server-side: `api/jev/decision.ts`
  and the Vite middleware. `src/game/pilot/secretBoundary.test.ts` fails if
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

The running application has no mock mode. A decision on screen is either
TypeSafe's (LIVE JEV) or visibly labelled as something else (FALLBACK, RANDOM,
REPLAY).

The test double exists only in tests: `src/game/pilot/testing/fixtures.ts`
(imported by `*.test.ts` only) and a fake endpoint that `tools/jev.mjs` installs
by request interception inside its own test browser. The offline browser suite
asserts that no decision in it came from TypeSafe. Nothing in ordinary CI
spends API credit; live runs require `JEV_LIVE_TEST=1` and a configured key.

| Command                                                             | Calls TypeSafe | What it checks                                                                                                                                                                   |
| :------------------------------------------------------------------ | :------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run test:jev`                                                  | no             | unit tests: contract, schema, executor, motor controller, fire gate, engagement axes, authority, loop, providers, recorder, metrics, server, secret boundary                     |
| `bun run jev`                                                       | no             | 72 browser checks: random brain, Jev client against a fake, precision control, Elite Operator, failures, outage, takeover, switching, death, respawn, replay, hostile parameters |
| `JEV_LIVE_TEST=1 bun run jev:live`                                  | yes            | live decisions, model version, request shape, outage recovery, takeover                                                                                                          |
| `bun run benchmark:random` / `benchmark:random:precision`           | no             | episodes with the random brain, direct / precision control                                                                                                                       |
| `JEV_LIVE_TEST=1 bun run benchmark:jev` / `benchmark:jev:precision` | yes            | episodes with Jev, direct (the original benchmark) / precision control                                                                                                           |
| `bun run replay:jev -- trace.jsonl`                                 | no             | replays a recorded control stream                                                                                                                                                |
| `bun run scan:secrets`                                              | no             | the build-output credential scan                                                                                                                                                 |

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
  play, six questions each under precision control. Nothing in ordinary CI
  spends credit; benchmarks and live checks require `JEV_LIVE_TEST=1`.
- **Rate limits are per instance** (see [The server boundary](#the-server-boundary)),
  and the TypeSafe account's own limit (1,200 requests per minute at the time of
  writing) caps concurrent spectators at roughly four before 429s.
- **Hand-designed observation semantics.** What Jev reads — which facts, in what
  words, the size classes, the hit-share bands — was written by hand and tuned on
  short runs. A different rendering could change its choices.
- **Jev still barely moves.** It chose HOLD in almost every frame, as it did
  before: it plays as a stationary marksman, which the bots — converging on the
  player across open ground — make effective. Nothing prevents movement and
  nothing prompts it; the controller shapes movement but never chooses it.
- **The results are environment-specific.** The site is large and open, bots
  spawn 45–135 m from the fight and the reference rifle's aimed spread is 0.02°,
  so most engagements are long, ADS, first-shot contests that reward steady
  aim. Under the player-seat rules (half damage taken, 1.2× dealt, bots slower
  and wider when aiming at the player) a controller that holds still and aims
  well is at its strongest here; closer, cover-heavy maps would test different
  skills.
- **Perception is conservative.** Jev gets no audio (footsteps), no teammates'
  positions and no live overlay brackets, all of which a person has.
- **Replay reproduces controls, not outcomes**, and a replayed target slot
  names whoever is in that slot of the view at replay time.
- **The benchmarks are small** — three two-minute episodes per configuration —
  and headless, with rendering stubbed. Treat them as a measurement of this
  build on this machine, not a ranking.
- **Very slow clients degrade to TIMEOUT.** When a frame takes longer than the
  2.2 s request timeout (seen under software rendering), answers arrive too late
  and are discarded; the player idles rather than acting on a stale decision.

## Files

| Path                                                   | Role                                                                     |
| :----------------------------------------------------- | :----------------------------------------------------------------------- |
| `src/game/pilot/contract.ts`                           | action vocabulary, descriptions, timing (shared with the server)         |
| `src/game/pilot/observation.ts`                        | observation schema, validator, legal actions (shared)                    |
| `src/game/pilot/decision.ts`                           | decision schema and validation (shared)                                  |
| `src/game/pilot/perception.ts`                         | builds observations from the live game                                   |
| `src/game/pilot/executor.ts`                           | control frame → `InputState`, with expiry                                |
| `src/game/pilot/motor.ts`                              | the precision motor controller: tracking, recoil feed-forward, fire gate |
| `src/game/pilot/hitGeometry.ts`                        | aim points, angular sizes, spread-cone share (shared with the server)    |
| `src/game/characters/hitboxSpecs.ts`                   | the one hitbox table colliders and aim geometry read                     |
| `src/game/player/eliteAssist.ts`                       | Elite Operator, the human aim help                                       |
| `src/game/pilot/loop.ts`                               | one request in flight, sequences, staleness, timeouts, backoff, fallback |
| `src/game/pilot/providers.ts`                          | the Jev HTTP brain and the seeded random brain                           |
| `src/game/pilot/pilot.ts`                              | the pilot seat: brain selection, frames, takeover, telemetry             |
| `src/game/pilot/recorder.ts`, `traceStorage.ts`        | JSONL traces, replay parsing, local storage                              |
| `src/game/pilot/metrics.ts`                            | episode statistics and benchmark aggregation                             |
| `src/game/pilot/rigState.ts`, `PilotHost.tsx`          | rig facts for perception; lifecycle, H key, dev handle                   |
| `src/game/hud/JevHud.tsx`                              | the panel and the Player control selector                                |
| `server/jev/handler.ts`, `question.ts`, `rateLimit.ts` | the endpoint                                                             |
| `api/jev/decision.ts`                                  | the Vercel Function                                                      |
| `tools/jev*.mjs`                                       | browser checks, benchmark, replay, secret scan                           |

The shared modules (now also `hitGeometry.ts` and `characters/hitboxSpecs.ts`)
import each other as `./x.js`: the Vercel function runs as
native Node ESM, which resolves nothing without an extension, and TypeScript and
Vite map `./x.js` back to `./x.ts`. Keep them free of `@/` aliases for the same
reason.
