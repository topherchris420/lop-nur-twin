# circuit-informed/v2: mechanism design, fixed before the held-out set was read

Written 2026-11-01, before the candidate held-out observations were opened.
It fixes which mechanisms v2 adds, what each parameter's kind is, and which
development observations each fitted value is fitted to. Held-out
observations may change none of this.

Basis: the digital-fly/8 calibration report (fd5687c) and Zacarias et al.
2018's full text. Both are development material for v2: every observation in
the report as of 97c4aa0 has been seen.

## Mechanisms (each one can be switched off for an ablation)

1. **Wall following (thigmotaxis).** A walking fly that meets a wall or an edge
   it cannot pass turns the shorter way along it and walks on, instead of
   stopping and turning away. It picks the side from the visual asymmetry of
   its approach (the side whose time to contact was shorter is the wall's).
   For `wallHoldS` after a contact it counts as "at the wall". While at the
   wall, spontaneous turns toward the open side are suppressed by
   `centrophobia` (fitted to `walking.wall.liu`).
2. **Exploration that decays.** In a new place a fly walks more and settles
   over minutes. The walk-start rate is multiplied by
   g(t) = 1 + A·exp(−t/τ) and the walk-stop rate divided by it, with t the
   time since the fly was placed. A and τ are fitted to
   `walking.moving.minute1..3`. Walking speeds come from a distribution
   inside the body's range (7.2–40 mm/s). Its scale is fitted to
   `walking.speed.minute1..3`.
3. **Saccadic walking.** The reduced-order fly's smooth random turns are
   replaced by body saccades: brief, fast turns between nearly straight
   segments with a little residual yaw drift.
   - Published (Geurten et al. 2014): mean heading change about 15° and
     median duration 90 ms.
   - Model choices: the amplitude distribution's shape (gamma, shape 2) and
     the drift.
   - The paper states no rate. The plan was to fit the rate to
     `walking.turns.30`, but a development probe showed that with 15°
     saccades no rate up to 10/s brings the share under 30° below 96%
     (published 60%). The rate is therefore a model value (1.5/s), and all
     three `walking.turns.*` stay development and are not fitted.
4. **Freeze or flee when enclosed (Zacarias et al. 2018).** A perched fly
   with no way up (a surface over it within `enclosedM`) answers a detected
   loom by freezing or fleeing, not by the open-space takeoff. The
   probability of freezing falls with its speed 0.5 s before the loom:
   p(v) = pFreeze·exp(−v/vScale). vScale is a model value; pFreeze is fitted.
   - A freezing fly stays immobile until a hazard ends the freeze; the mean
     freeze is fitted. It does not take off at later looms.
   - A fly that does not freeze flees: with probability `qJump` it takes
     off through the escape circuit (fitted); otherwise it runs, turning
     away from the threat at an elevated speed for a model-set time.
   - Fit targets: `escape.walking.freeze` and `escape.walking.jump`.
     `escape.walking.habituation` stays development and is not fitted.
   - In the open (no surface over it), v2 keeps v1's escape circuit
     unchanged. That is Zacarias's own contrast: with an exit through the
     lid, 90% (36/40) of flies jumped.
   - "A surface over it" is the paradigm's statement that a lid covers the
     fly (`Setting.enclosed`, set the same way `dusted` is). The simulator
     renders no view of the lid, so this stands in for what the fly would
     see overhead. It is an approximation, named in each paradigm.
5. **Flight saccade statistics.** Saccade amplitudes follow van Breugel &
   Dickinson 2012's log-normal (mean 40°, scale 2.3), which makes
   `flight.saccade-amplitude` a design observation. The spontaneous saccade
   rate is fitted to `flight.saccade-rate.censi`.

v2 keeps everything else from v1 (the giant fiber, the grooming circuit and
the reduced-order controller under them).

## Roles for v2

- Observations registered before 97c4aa0 are **development** for v2, apart
  from the fit targets named above (**fit**) and van Breugel's amplitude
  (**design**). For the reduced-order and v1 controllers their roles are
  unchanged.
- Observations in the new set are **held-out** for every controller.
  They are committed before any v2 code, and v2 is not run on their
  paradigms until the final evaluation from a clean commit.

## Ablations

v2 minus each mechanism (1–5), as knockouts: the full v2's fitted values are
kept, not refitted, on the same seeds. An ablation shows what that one
mechanism contributes to the fitted model, not what a model built without it
could reach.
