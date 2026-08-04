import {
  damageAtRange,
  shotInterval,
  type DamageProfilePoint,
  type WeaponClass,
  type WeaponDef,
} from "@/game/core/types";

/**
 * The arsenal.
 *
 * Sixteen weapons, balanced against the numbers a modern military shooter
 * actually ships: assault rifles land a 3-4 shot kill inside 30 m and decay to
 * 5 past 60 m, SMGs trade damage for 900-1000 rpm, snipers one-shot the upper
 * torso and pay for it with a 1.3 s bolt cycle.
 *
 * Every designation here is invented. The naming grammar is deliberate — a
 * codename plus a calibre or a mark number — because that is the idiom the
 * genre uses, but no real product name appears.
 *
 * ## Reading the numbers
 *
 * Damage curves are **per bullet, before hit-region multipliers**, and are
 * linearly interpolated by `damageAtRange`, so a flat plateau needs two points
 * (`{0, d}` and `{plateauEnd, d}`). Shots-to-kill against a 100 hp target is
 * `ceil(100 / damage)` and time-to-kill is `(stk - 1) * 60 / rpm` — the first
 * round lands at t=0. `ttkTable()` at the bottom prints the whole matrix, and
 * the design target is 200-500 ms for every automatic weapon at 10/25/50 m.
 *
 * Recoil is expressed as a *profile*, not a pattern: `runtime.ts` expands it
 * into a deterministic per-weapon spray pattern from `seed`, the way a CoD or
 * CS spray is authored, so two rifles with the same vertical figure still walk
 * differently.
 */

/* ------------------------------------------------------------------ */
/* Curve helpers                                                       */
/* ------------------------------------------------------------------ */

/** `[range, damage]` pairs, written compactly and frozen into the def. */
function curve(...points: readonly (readonly [number, number])[]): readonly DamageProfilePoint[] {
  return points.map(([rangeM, damage]) => ({ rangeM, damage }));
}

/* ------------------------------------------------------------------ */
/* Weapon definitions                                                  */
/* ------------------------------------------------------------------ */

const DEFS: readonly WeaponDef[] = [
  /* ---------------------------------------------------------------- */
  /* Assault rifles                                                    */
  /* ---------------------------------------------------------------- */
  {
    id: "oslo-14",
    name: "Oslo 14",
    shortName: "OSLO 14",
    weaponClass: "assault",
    fireModes: ["auto", "semi"],
    rpm: 720,
    burstCount: 0,
    burstDelay: 0,
    magSize: 30,
    startingReserve: 210,
    ballistics: {
      muzzleVelocity: 880,
      pellets: 1,
      // 4-shot kill to 45 m, 5 past 70 m.
      damage: curve([0, 33], [28, 33], [45, 26], [70, 22], [140, 20]),
      penetrationScale: 1,
      tracerEvery: 4,
      tracerColor: 0xffc46a,
    },
    recoil: {
      verticalDeg: 0.62,
      horizontalDeg: 0.24,
      rampShots: 6,
      sustainScale: 0.78,
      recenterFraction: 0.62,
      recoveryTime: 0.32,
      jitterDeg: 0.1,
      viewKickM: 0.016,
      viewRollRad: 0.02,
    },
    spread: {
      hipDeg: 2.6,
      adsDeg: 0.2,
      moveDeg: 1.3,
      airDeg: 3.2,
      crouchScale: 0.82,
      bloomPerShotDeg: 0.1,
      maxBloomDeg: 1.4,
      bloomDecayDegPerSec: 3.2,
    },
    handling: {
      adsTime: 0.26,
      raiseTime: 0.6,
      lowerTime: 0.45,
      reloadTime: 2.1,
      reloadEmptyTime: 2.9,
      sprintOutTime: 0.2,
      adsFov: 55,
      moveScale: 1,
      adsMoveScale: 0.55,
    },
    seed: 0x05107,
    blurb:
      "Short-stroke 5.56 rifle with a free-float handguard. The reference weapon: nothing it does is best in class, nothing it does is bad.",
  },
  {
    id: "halberd-762",
    name: "Halberd 762",
    shortName: "HALBERD",
    weaponClass: "assault",
    fireModes: ["auto", "semi"],
    rpm: 600,
    burstCount: 0,
    burstDelay: 0,
    magSize: 20,
    startingReserve: 140,
    ballistics: {
      muzzleVelocity: 820,
      pellets: 1,
      // 3-shot kill all the way to 55 m — the reason to carry it.
      damage: curve([0, 40], [30, 40], [55, 34], [90, 28], [160, 26]),
      penetrationScale: 1.55,
      tracerEvery: 3,
      tracerColor: 0xffb14a,
    },
    recoil: {
      verticalDeg: 1.02,
      horizontalDeg: 0.42,
      rampShots: 4,
      sustainScale: 0.86,
      recenterFraction: 0.5,
      recoveryTime: 0.42,
      jitterDeg: 0.18,
      viewKickM: 0.028,
      viewRollRad: 0.036,
    },
    spread: {
      hipDeg: 3.1,
      adsDeg: 0.22,
      moveDeg: 1.6,
      airDeg: 3.8,
      crouchScale: 0.8,
      bloomPerShotDeg: 0.16,
      maxBloomDeg: 1.9,
      bloomDecayDegPerSec: 3,
    },
    handling: {
      adsTime: 0.32,
      raiseTime: 0.72,
      lowerTime: 0.52,
      reloadTime: 2.45,
      reloadEmptyTime: 3.25,
      sprintOutTime: 0.26,
      adsFov: 52,
      moveScale: 0.94,
      adsMoveScale: 0.48,
    },
    seed: 0x07621,
    blurb:
      "Long-stroke 7.62 battle rifle. Twenty rounds, a hard three-shot kill and enough energy to punch a hangar wall — if you can hold the muzzle down.",
  },
  {
    id: "cinder-33",
    name: "Cinder 33",
    shortName: "CINDER",
    weaponClass: "assault",
    fireModes: ["auto", "semi"],
    rpm: 780,
    burstCount: 0,
    burstDelay: 0,
    magSize: 30,
    startingReserve: 210,
    ballistics: {
      muzzleVelocity: 900,
      pellets: 1,
      damage: curve([0, 30], [22, 30], [42, 25], [65, 21], [130, 19]),
      penetrationScale: 0.9,
      tracerEvery: 5,
      tracerColor: 0xffd27a,
    },
    recoil: {
      verticalDeg: 0.52,
      horizontalDeg: 0.34,
      rampShots: 9,
      sustainScale: 0.92,
      recenterFraction: 0.68,
      recoveryTime: 0.26,
      jitterDeg: 0.16,
      viewKickM: 0.013,
      viewRollRad: 0.018,
    },
    spread: {
      hipDeg: 2.5,
      adsDeg: 0.24,
      moveDeg: 1.2,
      airDeg: 3,
      crouchScale: 0.84,
      bloomPerShotDeg: 0.11,
      maxBloomDeg: 1.55,
      bloomDecayDegPerSec: 3.6,
    },
    handling: {
      adsTime: 0.24,
      raiseTime: 0.56,
      lowerTime: 0.42,
      reloadTime: 1.95,
      reloadEmptyTime: 2.7,
      sprintOutTime: 0.18,
      adsFov: 56,
      moveScale: 1.02,
      adsMoveScale: 0.58,
    },
    seed: 0x03318,
    blurb:
      "Stamped 5.45 carbine built for volume of fire. The pattern climbs slowly but wanders wide once the barrel is hot.",
  },
  {
    id: "ronin-68",
    name: "Ronin 6.8",
    shortName: "RONIN",
    weaponClass: "assault",
    fireModes: ["auto", "burst", "semi"],
    rpm: 690,
    burstCount: 3,
    burstDelay: 0.24,
    magSize: 25,
    startingReserve: 175,
    ballistics: {
      muzzleVelocity: 855,
      pellets: 1,
      // The flattest AR curve in the arsenal: 4-shot kill out to 58 m.
      damage: curve([0, 31], [34, 31], [58, 27], [95, 24], [170, 22]),
      penetrationScale: 1.25,
      tracerEvery: 4,
      tracerColor: 0xffc059,
    },
    recoil: {
      verticalDeg: 0.7,
      horizontalDeg: 0.2,
      rampShots: 5,
      sustainScale: 0.74,
      recenterFraction: 0.66,
      recoveryTime: 0.3,
      jitterDeg: 0.08,
      viewKickM: 0.019,
      viewRollRad: 0.022,
    },
    spread: {
      hipDeg: 2.7,
      adsDeg: 0.18,
      moveDeg: 1.35,
      airDeg: 3.3,
      crouchScale: 0.78,
      bloomPerShotDeg: 0.09,
      maxBloomDeg: 1.25,
      bloomDecayDegPerSec: 3.4,
    },
    handling: {
      adsTime: 0.28,
      raiseTime: 0.64,
      lowerTime: 0.48,
      reloadTime: 2.2,
      reloadEmptyTime: 3,
      sprintOutTime: 0.22,
      adsFov: 53,
      moveScale: 0.97,
      adsMoveScale: 0.52,
    },
    seed: 0x06834,
    blurb:
      "Intermediate 6.8 rifle with a three-round burst group. Recoil is almost purely vertical, which makes the pattern trivial to learn.",
  },

  /* ---------------------------------------------------------------- */
  /* Submachine guns                                                   */
  /* ---------------------------------------------------------------- */
  {
    id: "wasp-9",
    name: "Wasp 9",
    shortName: "WASP 9",
    weaponClass: "smg",
    fireModes: ["auto", "semi"],
    rpm: 900,
    burstCount: 0,
    burstDelay: 0,
    magSize: 32,
    startingReserve: 224,
    ballistics: {
      muzzleVelocity: 400,
      pellets: 1,
      damage: curve([0, 25], [16, 25], [28, 20], [45, 15], [90, 14]),
      penetrationScale: 0.6,
      tracerEvery: 5,
      tracerColor: 0xffd489,
    },
    recoil: {
      verticalDeg: 0.44,
      horizontalDeg: 0.3,
      rampShots: 8,
      sustainScale: 0.9,
      recenterFraction: 0.72,
      recoveryTime: 0.22,
      jitterDeg: 0.14,
      viewKickM: 0.011,
      viewRollRad: 0.016,
    },
    spread: {
      hipDeg: 2,
      adsDeg: 0.34,
      moveDeg: 0.8,
      airDeg: 2.4,
      crouchScale: 0.88,
      bloomPerShotDeg: 0.1,
      maxBloomDeg: 1.5,
      bloomDecayDegPerSec: 4.2,
    },
    handling: {
      adsTime: 0.19,
      raiseTime: 0.46,
      lowerTime: 0.34,
      reloadTime: 1.72,
      reloadEmptyTime: 2.35,
      sprintOutTime: 0.13,
      adsFov: 62,
      moveScale: 1.1,
      adsMoveScale: 0.72,
    },
    seed: 0x09091,
    blurb:
      "Roller-delayed 9 mm with a folding stock. Two-hundred-millisecond kills inside sixteen metres and it moves like it is not there.",
  },
  {
    id: "kestrel-45",
    name: "Kestrel 45",
    shortName: "KESTREL",
    weaponClass: "smg",
    fireModes: ["auto", "semi"],
    rpm: 800,
    burstCount: 0,
    burstDelay: 0,
    magSize: 25,
    startingReserve: 175,
    ballistics: {
      muzzleVelocity: 320,
      pellets: 1,
      damage: curve([0, 29], [14, 29], [24, 23], [40, 17], [80, 16]),
      penetrationScale: 0.7,
      tracerEvery: 4,
      tracerColor: 0xffbf6d,
    },
    recoil: {
      verticalDeg: 0.66,
      horizontalDeg: 0.36,
      rampShots: 6,
      sustainScale: 0.84,
      recenterFraction: 0.66,
      recoveryTime: 0.26,
      jitterDeg: 0.2,
      viewKickM: 0.017,
      viewRollRad: 0.026,
    },
    spread: {
      hipDeg: 2.2,
      adsDeg: 0.36,
      moveDeg: 0.9,
      airDeg: 2.6,
      crouchScale: 0.86,
      bloomPerShotDeg: 0.14,
      maxBloomDeg: 1.8,
      bloomDecayDegPerSec: 4,
    },
    handling: {
      adsTime: 0.21,
      raiseTime: 0.5,
      lowerTime: 0.36,
      reloadTime: 1.85,
      reloadEmptyTime: 2.5,
      sprintOutTime: 0.15,
      adsFov: 60,
      moveScale: 1.06,
      adsMoveScale: 0.68,
    },
    seed: 0x04512,
    blurb:
      "Blowback .45 with a heavy bolt. Hits harder than anything else in its class and falls off a cliff past twenty-four metres.",
  },
  {
    id: "hornet-pdw",
    name: "Hornet PDW",
    shortName: "HORNET",
    weaponClass: "smg",
    fireModes: ["auto"],
    rpm: 1000,
    burstCount: 0,
    burstDelay: 0,
    magSize: 25,
    startingReserve: 180,
    ballistics: {
      muzzleVelocity: 380,
      pellets: 1,
      damage: curve([0, 22], [12, 22], [22, 18], [38, 14], [75, 13]),
      penetrationScale: 0.55,
      tracerEvery: 6,
      tracerColor: 0xffe0a0,
    },
    recoil: {
      verticalDeg: 0.38,
      horizontalDeg: 0.44,
      rampShots: 10,
      sustainScale: 1,
      recenterFraction: 0.78,
      recoveryTime: 0.2,
      jitterDeg: 0.24,
      viewKickM: 0.009,
      viewRollRad: 0.012,
    },
    spread: {
      hipDeg: 1.8,
      adsDeg: 0.42,
      moveDeg: 0.7,
      airDeg: 2.2,
      crouchScale: 0.9,
      bloomPerShotDeg: 0.12,
      maxBloomDeg: 2,
      bloomDecayDegPerSec: 4.6,
    },
    handling: {
      adsTime: 0.16,
      raiseTime: 0.4,
      lowerTime: 0.3,
      reloadTime: 1.6,
      reloadEmptyTime: 2.15,
      sprintOutTime: 0.11,
      adsFov: 65,
      moveScale: 1.14,
      adsMoveScale: 0.78,
    },
    seed: 0x01000,
    blurb:
      "A thousand rounds a minute out of a twenty-five round magazine. Empties in one and a half seconds; make every one of them count.",
  },

  /* ---------------------------------------------------------------- */
  /* Light machine gun                                                 */
  /* ---------------------------------------------------------------- */
  {
    id: "bulwark-7",
    name: "Bulwark 7",
    shortName: "BULWARK",
    weaponClass: "lmg",
    fireModes: ["auto"],
    rpm: 600,
    burstCount: 0,
    burstDelay: 0,
    magSize: 100,
    startingReserve: 200,
    ballistics: {
      muzzleVelocity: 840,
      pellets: 1,
      damage: curve([0, 34], [40, 34], [70, 29], [110, 25], [200, 23]),
      penetrationScale: 1.75,
      tracerEvery: 4,
      tracerColor: 0xff9a3c,
    },
    recoil: {
      verticalDeg: 0.86,
      horizontalDeg: 0.3,
      rampShots: 12,
      sustainScale: 0.62,
      recenterFraction: 0.58,
      recoveryTime: 0.44,
      jitterDeg: 0.15,
      viewKickM: 0.024,
      viewRollRad: 0.03,
    },
    spread: {
      hipDeg: 4.2,
      adsDeg: 0.2,
      moveDeg: 2.4,
      airDeg: 5,
      crouchScale: 0.66,
      bloomPerShotDeg: 0.06,
      maxBloomDeg: 1.1,
      bloomDecayDegPerSec: 2.4,
    },
    handling: {
      adsTime: 0.42,
      raiseTime: 0.95,
      lowerTime: 0.7,
      reloadTime: 6.4,
      reloadEmptyTime: 7.8,
      sprintOutTime: 0.38,
      adsFov: 50,
      moveScale: 0.82,
      adsMoveScale: 0.38,
    },
    seed: 0x0be17,
    blurb:
      "Belt-fed 7.62 on a quick-change barrel. A hundred rounds of suppression, a three-shot kill, and eight seconds of helplessness when it runs dry.",
  },

  /* ---------------------------------------------------------------- */
  /* Marksman                                                          */
  /* ---------------------------------------------------------------- */
  {
    id: "longbow-dmr",
    name: "Longbow DMR",
    shortName: "LONGBOW",
    weaponClass: "marksman",
    fireModes: ["semi"],
    rpm: 300,
    burstCount: 0,
    burstDelay: 0,
    magSize: 20,
    startingReserve: 120,
    ballistics: {
      muzzleVelocity: 810,
      pellets: 1,
      damage: curve([0, 56], [60, 56], [110, 48], [180, 44], [300, 42]),
      penetrationScale: 1.6,
      tracerEvery: 2,
      tracerColor: 0xffa845,
    },
    recoil: {
      verticalDeg: 1.35,
      horizontalDeg: 0.3,
      rampShots: 3,
      sustainScale: 0.95,
      recenterFraction: 0.88,
      recoveryTime: 0.3,
      jitterDeg: 0.1,
      viewKickM: 0.032,
      viewRollRad: 0.03,
    },
    spread: {
      hipDeg: 3.4,
      adsDeg: 0.05,
      moveDeg: 2,
      airDeg: 4.4,
      crouchScale: 0.72,
      bloomPerShotDeg: 0.22,
      maxBloomDeg: 1.2,
      bloomDecayDegPerSec: 2.8,
    },
    handling: {
      adsTime: 0.34,
      raiseTime: 0.78,
      lowerTime: 0.56,
      reloadTime: 2.5,
      reloadEmptyTime: 3.3,
      sprintOutTime: 0.28,
      adsFov: 38,
      moveScale: 0.93,
      adsMoveScale: 0.46,
    },
    seed: 0x0d114,
    blurb:
      "Gas-piston designated marksman rifle. Two rounds anywhere in the torso to sixty metres, and it will trade with a sniper at range.",
  },

  /* ---------------------------------------------------------------- */
  /* Snipers                                                           */
  /* ---------------------------------------------------------------- */
  {
    id: "meridian-338",
    name: "Meridian .338",
    shortName: "MERIDIAN",
    weaponClass: "sniper",
    fireModes: ["semi"],
    rpm: 65,
    burstCount: 0,
    burstDelay: 0,
    magSize: 7,
    startingReserve: 42,
    ballistics: {
      muzzleVelocity: 870,
      pellets: 1,
      // 95 x 1.15 chest = 109: a one-shot kill on the upper torso only.
      damage: curve([0, 95], [120, 95], [240, 88], [450, 80]),
      penetrationScale: 2.4,
      tracerEvery: 0,
      tracerColor: 0xfff0c0,
    },
    recoil: {
      verticalDeg: 2.9,
      horizontalDeg: 0.5,
      rampShots: 2,
      sustainScale: 1,
      recenterFraction: 0.94,
      recoveryTime: 0.5,
      jitterDeg: 0.12,
      viewKickM: 0.055,
      viewRollRad: 0.05,
    },
    spread: {
      hipDeg: 5.5,
      adsDeg: 0,
      moveDeg: 3.6,
      airDeg: 7,
      crouchScale: 0.6,
      bloomPerShotDeg: 0.4,
      maxBloomDeg: 1.6,
      bloomDecayDegPerSec: 2,
    },
    handling: {
      adsTime: 0.44,
      raiseTime: 0.9,
      lowerTime: 0.66,
      reloadTime: 3.1,
      reloadEmptyTime: 3.9,
      sprintOutTime: 0.36,
      adsFov: 22,
      moveScale: 0.88,
      adsMoveScale: 0.36,
    },
    seed: 0x03380,
    blurb:
      "Semi-automatic .338 with a detachable box magazine. Upper-chest and above is a kill; everything else needs a follow-up.",
  },
  {
    id: "warden-50",
    name: "Warden .50",
    shortName: "WARDEN",
    weaponClass: "sniper",
    fireModes: ["bolt"],
    rpm: 45,
    burstCount: 0,
    burstDelay: 0,
    magSize: 5,
    startingReserve: 30,
    ballistics: {
      muzzleVelocity: 928,
      pellets: 1,
      // 122 base: torso and arms drop instantly, legs and feet do not.
      damage: curve([0, 122], [200, 122], [400, 112], [800, 104]),
      penetrationScale: 3.4,
      tracerEvery: 0,
      tracerColor: 0xfff4d2,
    },
    recoil: {
      verticalDeg: 4.6,
      horizontalDeg: 0.8,
      rampShots: 1,
      sustainScale: 1,
      recenterFraction: 0.96,
      recoveryTime: 0.62,
      jitterDeg: 0.2,
      viewKickM: 0.085,
      viewRollRad: 0.07,
    },
    spread: {
      hipDeg: 6.5,
      adsDeg: 0,
      moveDeg: 4.4,
      airDeg: 8,
      crouchScale: 0.55,
      bloomPerShotDeg: 0.5,
      maxBloomDeg: 1.8,
      bloomDecayDegPerSec: 1.8,
    },
    handling: {
      adsTime: 0.52,
      raiseTime: 1.05,
      lowerTime: 0.78,
      reloadTime: 3.4,
      reloadEmptyTime: 4.3,
      sprintOutTime: 0.42,
      adsFov: 16,
      moveScale: 0.84,
      adsMoveScale: 0.3,
    },
    seed: 0x05000,
    blurb:
      "Bolt-action .50 anti-materiel rifle. One-and-a-third seconds between shots, and it does not care what is in the way.",
  },

  /* ---------------------------------------------------------------- */
  /* Shotgun                                                           */
  /* ---------------------------------------------------------------- */
  {
    id: "breaker-12",
    name: "Breaker 12",
    shortName: "BREAKER",
    weaponClass: "shotgun",
    fireModes: ["pump"],
    rpm: 75,
    burstCount: 0,
    burstDelay: 0,
    magSize: 6,
    startingReserve: 36,
    ballistics: {
      muzzleVelocity: 400,
      pellets: 8,
      // Per pellet. 8 x 17 = 136 inside nine metres, 8 x 10 = 80 at sixteen.
      damage: curve([0, 17], [9, 17], [16, 10], [24, 5], [45, 3]),
      penetrationScale: 0.35,
      tracerEvery: 0,
      tracerColor: 0xffb060,
    },
    recoil: {
      verticalDeg: 3.2,
      horizontalDeg: 0.9,
      rampShots: 2,
      sustainScale: 1,
      recenterFraction: 0.82,
      recoveryTime: 0.46,
      jitterDeg: 0.3,
      viewKickM: 0.062,
      viewRollRad: 0.06,
    },
    spread: {
      // Pellet cone is driven by these numbers, not by aim error.
      hipDeg: 4.6,
      adsDeg: 3.1,
      moveDeg: 1.2,
      airDeg: 2.6,
      crouchScale: 0.92,
      bloomPerShotDeg: 0.3,
      maxBloomDeg: 1.2,
      bloomDecayDegPerSec: 3,
    },
    handling: {
      adsTime: 0.24,
      raiseTime: 0.6,
      lowerTime: 0.44,
      reloadTime: 0.62,
      reloadEmptyTime: 0.9,
      sprintOutTime: 0.18,
      adsFov: 64,
      moveScale: 0.98,
      adsMoveScale: 0.6,
    },
    seed: 0x0c012,
    blurb:
      "Pump twelve-gauge, shell-by-shell top-up. A single one-shot kill inside nine metres, then eight hundred milliseconds of praying.",
  },

  /* ---------------------------------------------------------------- */
  /* Pistols                                                           */
  /* ---------------------------------------------------------------- */
  {
    id: "sidewinder-9",
    name: "Sidewinder 9",
    shortName: "SIDEWINDER",
    weaponClass: "pistol",
    fireModes: ["semi"],
    rpm: 450,
    burstCount: 0,
    burstDelay: 0,
    magSize: 17,
    startingReserve: 68,
    ballistics: {
      muzzleVelocity: 375,
      pellets: 1,
      damage: curve([0, 29], [15, 29], [28, 22], [50, 18], [90, 16]),
      penetrationScale: 0.5,
      tracerEvery: 0,
      tracerColor: 0xffce8a,
    },
    recoil: {
      verticalDeg: 1.1,
      horizontalDeg: 0.35,
      rampShots: 4,
      sustainScale: 0.9,
      recenterFraction: 0.86,
      recoveryTime: 0.24,
      jitterDeg: 0.16,
      viewKickM: 0.022,
      viewRollRad: 0.028,
    },
    spread: {
      hipDeg: 2.4,
      adsDeg: 0.4,
      moveDeg: 1.1,
      airDeg: 2.8,
      crouchScale: 0.86,
      bloomPerShotDeg: 0.24,
      maxBloomDeg: 1.6,
      bloomDecayDegPerSec: 5,
    },
    handling: {
      adsTime: 0.15,
      raiseTime: 0.34,
      lowerTime: 0.26,
      reloadTime: 1.45,
      reloadEmptyTime: 1.95,
      sprintOutTime: 0.1,
      adsFov: 66,
      moveScale: 1.16,
      adsMoveScale: 0.84,
    },
    seed: 0x09019,
    blurb:
      "Striker-fired 9 mm sidearm. Seventeen rounds, a hundred-and-fifty-millisecond raise, and the fastest bail-out in the game.",
  },
  {
    id: "magnus-44",
    name: "Magnus .44",
    shortName: "MAGNUS",
    weaponClass: "pistol",
    fireModes: ["semi"],
    rpm: 220,
    burstCount: 0,
    burstDelay: 0,
    magSize: 8,
    startingReserve: 40,
    ballistics: {
      muzzleVelocity: 440,
      pellets: 1,
      damage: curve([0, 55], [22, 55], [40, 42], [70, 36], [120, 34]),
      penetrationScale: 1.2,
      tracerEvery: 0,
      tracerColor: 0xffb257,
    },
    recoil: {
      verticalDeg: 2.6,
      horizontalDeg: 0.7,
      rampShots: 2,
      sustainScale: 1,
      recenterFraction: 0.9,
      recoveryTime: 0.38,
      jitterDeg: 0.26,
      viewKickM: 0.048,
      viewRollRad: 0.055,
    },
    spread: {
      hipDeg: 2.8,
      adsDeg: 0.28,
      moveDeg: 1.4,
      airDeg: 3.4,
      crouchScale: 0.8,
      bloomPerShotDeg: 0.36,
      maxBloomDeg: 1.7,
      bloomDecayDegPerSec: 4,
    },
    handling: {
      adsTime: 0.2,
      raiseTime: 0.44,
      lowerTime: 0.34,
      reloadTime: 1.75,
      reloadEmptyTime: 2.3,
      sprintOutTime: 0.14,
      adsFov: 60,
      moveScale: 1.1,
      adsMoveScale: 0.76,
    },
    seed: 0x04444,
    blurb:
      "Long-slide .44 with a ported barrel. Two rounds to the chest at any range a pistol fight actually happens at.",
  },

  /* ---------------------------------------------------------------- */
  /* Launcher                                                          */
  /* ---------------------------------------------------------------- */
  {
    id: "pylon-at",
    name: "Pylon AT",
    shortName: "PYLON",
    weaponClass: "launcher",
    fireModes: ["semi"],
    rpm: 40,
    burstCount: 0,
    burstDelay: 0,
    magSize: 1,
    startingReserve: 3,
    ballistics: {
      muzzleVelocity: 145,
      pellets: 1,
      // Direct-impact damage; the blast is resolved by the explosion system.
      damage: curve([0, 150], [400, 150]),
      penetrationScale: 0,
      tracerEvery: 1,
      tracerColor: 0xffd9a0,
    },
    recoil: {
      verticalDeg: 3.6,
      horizontalDeg: 0.6,
      rampShots: 1,
      sustainScale: 1,
      recenterFraction: 0.9,
      recoveryTime: 0.7,
      jitterDeg: 0.1,
      viewKickM: 0.07,
      viewRollRad: 0.04,
    },
    spread: {
      hipDeg: 1.6,
      adsDeg: 0.2,
      moveDeg: 0.8,
      airDeg: 2,
      crouchScale: 0.9,
      bloomPerShotDeg: 0,
      maxBloomDeg: 0,
      bloomDecayDegPerSec: 1,
    },
    handling: {
      adsTime: 0.5,
      raiseTime: 1.1,
      lowerTime: 0.8,
      reloadTime: 3.6,
      reloadEmptyTime: 3.6,
      sprintOutTime: 0.4,
      adsFov: 48,
      moveScale: 0.86,
      adsMoveScale: 0.4,
    },
    seed: 0x0a770,
    blurb:
      "Disposable-tube anti-armour launcher with a fixed optical sight. Slow, loud, and the only answer to a hardened vehicle.",
  },

  /* ---------------------------------------------------------------- */
  /* Melee                                                             */
  /* ---------------------------------------------------------------- */
  {
    id: "trench-knife",
    name: "Trench Knife",
    shortName: "KNIFE",
    weaponClass: "melee",
    fireModes: ["semi"],
    rpm: 120,
    burstCount: 0,
    burstDelay: 0,
    magSize: 0,
    startingReserve: 0,
    ballistics: {
      muzzleVelocity: 0,
      pellets: 1,
      // Lethal inside 1.9 m, nothing beyond it.
      damage: curve([0, 150], [1.9, 150], [2.1, 0]),
      penetrationScale: 0,
      tracerEvery: 0,
      tracerColor: 0x000000,
    },
    recoil: {
      verticalDeg: 0,
      horizontalDeg: 0,
      rampShots: 1,
      sustainScale: 1,
      recenterFraction: 1,
      recoveryTime: 0.2,
      viewKickM: 0,
      viewRollRad: 0,
      jitterDeg: 0,
    },
    spread: {
      hipDeg: 0,
      adsDeg: 0,
      moveDeg: 0,
      airDeg: 0,
      crouchScale: 1,
      bloomPerShotDeg: 0,
      maxBloomDeg: 0,
      bloomDecayDegPerSec: 1,
    },
    handling: {
      adsTime: 0.12,
      raiseTime: 0.28,
      lowerTime: 0.2,
      reloadTime: 0,
      reloadEmptyTime: 0,
      sprintOutTime: 0.06,
      adsFov: 80,
      moveScale: 1.22,
      adsMoveScale: 1.1,
    },
    seed: 0x01fe,
    blurb:
      "Stacked-leather grip, parkerised clip-point blade. Silent, instant, and it never runs out.",
  },
];

/* ------------------------------------------------------------------ */
/* Registry                                                            */
/* ------------------------------------------------------------------ */

export const WEAPONS: Record<string, WeaponDef> = Object.fromEntries(
  DEFS.map((def) => [def.id, def]),
);

export const WEAPON_LIST: readonly WeaponDef[] = DEFS;

/**
 * Ids used by `gameState.ts` / `gameStore.ts` defaults that predate this
 * arsenal. Resolved transparently so those modules keep working untouched —
 * see the report accompanying this change.
 */
export const WEAPON_ALIASES: Readonly<Record<string, string>> = {
  "kilo-141": "oslo-14",
  m19: "sidewinder-9",
  m4: "oslo-14",
  knife: "trench-knife",
};

export function resolveWeaponId(id: string): string {
  return WEAPONS[id] ? id : (WEAPON_ALIASES[id] ?? id);
}

/** Fallback is the reference rifle, so an unknown id never crashes a match. */
export const DEFAULT_WEAPON_ID = "oslo-14";

export function getWeapon(id: string): WeaponDef {
  const direct = WEAPONS[id];
  if (direct) return direct;
  const aliased = WEAPON_ALIASES[id];
  if (aliased) {
    const def = WEAPONS[aliased];
    if (def) return def;
  }
  return WEAPONS[DEFAULT_WEAPON_ID]!;
}

export function tryGetWeapon(id: string): WeaponDef | undefined {
  return WEAPONS[id] ?? (WEAPON_ALIASES[id] ? WEAPONS[WEAPON_ALIASES[id]!] : undefined);
}

export const WEAPONS_BY_CLASS: Readonly<Record<WeaponClass, readonly WeaponDef[]>> = (() => {
  const out: Record<WeaponClass, WeaponDef[]> = {
    assault: [],
    smg: [],
    lmg: [],
    marksman: [],
    sniper: [],
    shotgun: [],
    pistol: [],
    launcher: [],
    melee: [],
  };
  for (const def of DEFS) out[def.weaponClass].push(def);
  return out;
})();

/** Weapons that fly a simulated projectile rather than a hitscan ray. */
export function usesProjectile(def: WeaponDef): boolean {
  return (
    def.weaponClass === "sniper" ||
    def.weaponClass === "marksman" ||
    def.weaponClass === "launcher"
  );
}

/* ------------------------------------------------------------------ */
/* Balance instrumentation                                             */
/* ------------------------------------------------------------------ */

export interface TtkRow {
  id: string;
  name: string;
  weaponClass: WeaponClass;
  rpm: number;
  /** Shots to kill a 100 hp target with body shots, per range. */
  stk: number[];
  /** Milliseconds from first round to lethal round, per range. */
  ttkMs: number[];
  ranges: readonly number[];
}

const DEFAULT_TTK_RANGES = [10, 25, 50] as const;

/**
 * Shots to kill an unarmoured target, using the stomach multiplier (1.0) so the
 * number is the honest "centre mass" figure rather than a best case.
 */
export function shotsToKill(def: WeaponDef, rangeM: number, health = 100): number {
  const perProjectile = damageAtRange(def.ballistics.damage, rangeM);
  const perShot = perProjectile * Math.max(1, def.ballistics.pellets);
  if (perShot <= 0) return Infinity;
  return Math.ceil(health / perShot);
}

/**
 * Milliseconds between the first round leaving the barrel and the lethal one
 * landing. Burst weapons pay the inter-burst delay; pump/bolt guns pay their
 * full cycle, which is already baked into `rpm`.
 */
export function timeToKillMs(def: WeaponDef, rangeM: number, health = 100): number {
  const stk = shotsToKill(def, rangeM, health);
  if (!Number.isFinite(stk)) return Infinity;
  const gap = shotInterval(def.rpm);
  const primary = def.fireModes[0];
  if (primary === "burst" && def.burstCount > 1) {
    const bursts = Math.floor((stk - 1) / def.burstCount);
    return ((stk - 1) * gap + bursts * def.burstDelay) * 1000;
  }
  return (stk - 1) * gap * 1000;
}

export function ttkTable(
  ranges: readonly number[] = DEFAULT_TTK_RANGES,
): readonly TtkRow[] {
  return DEFS.map((def) => ({
    id: def.id,
    name: def.name,
    weaponClass: def.weaponClass,
    rpm: def.rpm,
    ranges,
    stk: ranges.map((r) => shotsToKill(def, r)),
    ttkMs: ranges.map((r) => Math.round(timeToKillMs(def, r))),
  }));
}

/** Formats `ttkTable()` as fixed-width text for a console sanity check. */
export function formatTtkTable(ranges: readonly number[] = DEFAULT_TTK_RANGES): string {
  const rows = ttkTable(ranges);
  const head = [
    "weapon".padEnd(16),
    "class".padEnd(9),
    "rpm".padStart(5),
    ...ranges.map((r) => `${r}m stk`.padStart(8)),
    ...ranges.map((r) => `${r}m ttk`.padStart(9)),
  ].join(" ");
  const lines = rows.map((row) =>
    [
      row.name.padEnd(16),
      row.weaponClass.padEnd(9),
      String(row.rpm).padStart(5),
      ...row.stk.map((s) => (Number.isFinite(s) ? String(s) : "-").padStart(8)),
      ...row.ttkMs.map((t) => (Number.isFinite(t) ? `${t}ms` : "-").padStart(9)),
    ].join(" "),
  );
  return [head, "-".repeat(head.length), ...lines].join("\n");
}
