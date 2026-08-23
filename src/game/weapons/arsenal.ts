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
function curve(
  ...points: readonly (readonly [number, number])[]
): readonly DamageProfilePoint[] {
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
      // 3-shot kill to 35 m, 4-shot past 60 m
      damage: curve([0, 42], [35, 42], [55, 34], [80, 28], [150, 25]),
      penetrationScale: 1.1,
      tracerEvery: 4,
      tracerColor: 0xffc46a,
    },
    recoil: {
      verticalDeg: 0.52,
      horizontalDeg: 0.18,
      rampShots: 6,
      sustainScale: 0.75,
      recenterFraction: 0.72,
      recoveryTime: 0.28,
      jitterDeg: 0.08,
      viewKickM: 0.014,
      viewRollRad: 0.016,
    },
    spread: {
      hipDeg: 2.2,
      adsDeg: 0.02,
      moveDeg: 0.8,
      airDeg: 2.4,
      crouchScale: 0.82,
      bloomPerShotDeg: 0.06,
      maxBloomDeg: 0.85,
      bloomDecayDegPerSec: 4.2,
    },
    handling: {
      adsTime: 0.22,
      raiseTime: 0.52,
      lowerTime: 0.38,
      reloadTime: 1.9,
      reloadEmptyTime: 2.5,
      sprintOutTime: 0.16,
      adsFov: 55,
      moveScale: 1.02,
      adsMoveScale: 0.65,
    },
    seed: 0x05107,
    blurb:
      "Short-stroke 5.56 rifle with a free-float handguard. The reference weapon: crisp three-shot kills close in, pinpoint ADS accuracy, and manageable recoil.",
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
      // Hard 2-shot kill to 35 m, 3-shot past 60 m
      damage: curve([0, 52], [35, 52], [65, 44], [100, 36], [180, 32]),
      penetrationScale: 1.75,
      tracerEvery: 3,
      tracerColor: 0xffb14a,
    },
    recoil: {
      verticalDeg: 0.88,
      horizontalDeg: 0.32,
      rampShots: 4,
      sustainScale: 0.82,
      recenterFraction: 0.62,
      recoveryTime: 0.35,
      jitterDeg: 0.12,
      viewKickM: 0.024,
      viewRollRad: 0.028,
    },
    spread: {
      hipDeg: 2.6,
      adsDeg: 0.02,
      moveDeg: 0.9,
      airDeg: 2.8,
      crouchScale: 0.8,
      bloomPerShotDeg: 0.08,
      maxBloomDeg: 1.1,
      bloomDecayDegPerSec: 3.8,
    },
    handling: {
      adsTime: 0.26,
      raiseTime: 0.62,
      lowerTime: 0.44,
      reloadTime: 2.15,
      reloadEmptyTime: 2.85,
      sprintOutTime: 0.2,
      adsFov: 52,
      moveScale: 0.98,
      adsMoveScale: 0.58,
    },
    seed: 0x07621,
    blurb:
      "Long-stroke 7.62 battle rifle. Twenty rounds, a devastating two-shot kill and enough energy to punch a hangar wall.",
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
      damage: curve([0, 38], [28, 38], [50, 32], [75, 26], [140, 24]),
      penetrationScale: 1,
      tracerEvery: 5,
      tracerColor: 0xffd27a,
    },
    recoil: {
      verticalDeg: 0.44,
      horizontalDeg: 0.24,
      rampShots: 9,
      sustainScale: 0.88,
      recenterFraction: 0.74,
      recoveryTime: 0.22,
      jitterDeg: 0.1,
      viewKickM: 0.011,
      viewRollRad: 0.014,
    },
    spread: {
      hipDeg: 2.1,
      adsDeg: 0.02,
      moveDeg: 0.75,
      airDeg: 2.2,
      crouchScale: 0.84,
      bloomPerShotDeg: 0.05,
      maxBloomDeg: 0.9,
      bloomDecayDegPerSec: 4.4,
    },
    handling: {
      adsTime: 0.2,
      raiseTime: 0.48,
      lowerTime: 0.35,
      reloadTime: 1.75,
      reloadEmptyTime: 2.35,
      sprintOutTime: 0.14,
      adsFov: 56,
      moveScale: 1.05,
      adsMoveScale: 0.68,
    },
    seed: 0x03318,
    blurb:
      "Stamped 5.45 carbine built for volume of fire. Rapid three-shot capability with lightning handling and high mobility.",
  },
  {
    id: "ronin-68",
    name: "Ronin 6.8",
    shortName: "RONIN",
    weaponClass: "assault",
    fireModes: ["auto", "burst", "semi"],
    rpm: 690,
    burstCount: 3,
    burstDelay: 0.2,
    magSize: 25,
    startingReserve: 175,
    ballistics: {
      muzzleVelocity: 855,
      pellets: 1,
      // Flat curve: 3-shot kill out to 45 m
      damage: curve([0, 44], [45, 44], [70, 36], [105, 30], [180, 26]),
      penetrationScale: 1.35,
      tracerEvery: 4,
      tracerColor: 0xffc059,
    },
    recoil: {
      verticalDeg: 0.58,
      horizontalDeg: 0.14,
      rampShots: 5,
      sustainScale: 0.7,
      recenterFraction: 0.75,
      recoveryTime: 0.24,
      jitterDeg: 0.06,
      viewKickM: 0.015,
      viewRollRad: 0.018,
    },
    spread: {
      hipDeg: 2.2,
      adsDeg: 0.015,
      moveDeg: 0.8,
      airDeg: 2.4,
      crouchScale: 0.78,
      bloomPerShotDeg: 0.05,
      maxBloomDeg: 0.8,
      bloomDecayDegPerSec: 4.2,
    },
    handling: {
      adsTime: 0.23,
      raiseTime: 0.54,
      lowerTime: 0.4,
      reloadTime: 1.95,
      reloadEmptyTime: 2.6,
      sprintOutTime: 0.17,
      adsFov: 53,
      moveScale: 1.0,
      adsMoveScale: 0.62,
    },
    seed: 0x06834,
    blurb:
      "Intermediate 6.8 rifle with a three-round burst group. Clean one-burst eliminations and near-zero horizontal sway.",
  },

  /* ---------------------------------------------------------------- */
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
      // 3-shot kill up to 18 m, 4-shot to 35 m
      damage: curve([0, 36], [18, 36], [32, 28], [55, 20], [90, 16]),
      penetrationScale: 0.75,
      tracerEvery: 5,
      tracerColor: 0xffd489,
    },
    recoil: {
      verticalDeg: 0.38,
      horizontalDeg: 0.22,
      rampShots: 8,
      sustainScale: 0.88,
      recenterFraction: 0.76,
      recoveryTime: 0.2,
      jitterDeg: 0.1,
      viewKickM: 0.01,
      viewRollRad: 0.012,
    },
    spread: {
      hipDeg: 1.8,
      adsDeg: 0.03,
      moveDeg: 0.5,
      airDeg: 1.8,
      crouchScale: 0.88,
      bloomPerShotDeg: 0.06,
      maxBloomDeg: 0.9,
      bloomDecayDegPerSec: 4.8,
    },
    handling: {
      adsTime: 0.16,
      raiseTime: 0.4,
      lowerTime: 0.3,
      reloadTime: 1.55,
      reloadEmptyTime: 2.1,
      sprintOutTime: 0.11,
      adsFov: 62,
      moveScale: 1.12,
      adsMoveScale: 0.78,
    },
    seed: 0x09091,
    blurb:
      "Roller-delayed 9 mm with a folding stock. Lethal 200 ms TTK inside eighteen metres with supreme mobility.",
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
      // Hard hitting .45 ACP: 3-shot kill up to 20 m
      damage: curve([0, 42], [20, 42], [32, 32], [50, 24], [80, 20]),
      penetrationScale: 0.85,
      tracerEvery: 4,
      tracerColor: 0xffbf6d,
    },
    recoil: {
      verticalDeg: 0.54,
      horizontalDeg: 0.26,
      rampShots: 6,
      sustainScale: 0.82,
      recenterFraction: 0.72,
      recoveryTime: 0.22,
      jitterDeg: 0.14,
      viewKickM: 0.014,
      viewRollRad: 0.02,
    },
    spread: {
      hipDeg: 1.9,
      adsDeg: 0.03,
      moveDeg: 0.55,
      airDeg: 2.0,
      crouchScale: 0.86,
      bloomPerShotDeg: 0.08,
      maxBloomDeg: 1.1,
      bloomDecayDegPerSec: 4.6,
    },
    handling: {
      adsTime: 0.18,
      raiseTime: 0.44,
      lowerTime: 0.32,
      reloadTime: 1.65,
      reloadEmptyTime: 2.25,
      sprintOutTime: 0.12,
      adsFov: 60,
      moveScale: 1.08,
      adsMoveScale: 0.72,
    },
    seed: 0x04512,
    blurb:
      "Blowback .45 with a heavy bolt. High stopping power in CQB with hard three-shot impacts.",
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
      damage: curve([0, 32], [16, 32], [28, 24], [45, 18], [75, 15]),
      penetrationScale: 0.7,
      tracerEvery: 6,
      tracerColor: 0xffe0a0,
    },
    recoil: {
      verticalDeg: 0.32,
      horizontalDeg: 0.32,
      rampShots: 10,
      sustainScale: 0.95,
      recenterFraction: 0.82,
      recoveryTime: 0.18,
      jitterDeg: 0.16,
      viewKickM: 0.008,
      viewRollRad: 0.01,
    },
    spread: {
      hipDeg: 1.6,
      adsDeg: 0.035,
      moveDeg: 0.45,
      airDeg: 1.8,
      crouchScale: 0.9,
      bloomPerShotDeg: 0.07,
      maxBloomDeg: 1.2,
      bloomDecayDegPerSec: 5.2,
    },
    handling: {
      adsTime: 0.14,
      raiseTime: 0.36,
      lowerTime: 0.26,
      reloadTime: 1.45,
      reloadEmptyTime: 1.95,
      sprintOutTime: 0.09,
      adsFov: 65,
      moveScale: 1.15,
      adsMoveScale: 0.82,
    },
    seed: 0x01000,
    blurb:
      "A thousand rounds a minute out of a compact chassis. Devastating rate of fire shreds targets instantly in close quarters.",
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
      // 3-shot kill all the way to 55 m
      damage: curve([0, 46], [55, 46], [85, 38], [125, 32], [200, 28]),
      penetrationScale: 2.2,
      tracerEvery: 4,
      tracerColor: 0xff9a3c,
    },
    recoil: {
      verticalDeg: 0.68,
      horizontalDeg: 0.22,
      rampShots: 12,
      sustainScale: 0.55,
      recenterFraction: 0.68,
      recoveryTime: 0.36,
      jitterDeg: 0.1,
      viewKickM: 0.018,
      viewRollRad: 0.022,
    },
    spread: {
      hipDeg: 3.4,
      adsDeg: 0.02,
      moveDeg: 1.4,
      airDeg: 3.8,
      crouchScale: 0.66,
      bloomPerShotDeg: 0.04,
      maxBloomDeg: 0.75,
      bloomDecayDegPerSec: 3.4,
    },
    handling: {
      adsTime: 0.34,
      raiseTime: 0.8,
      lowerTime: 0.58,
      reloadTime: 4.8,
      reloadEmptyTime: 6.2,
      sprintOutTime: 0.28,
      adsFov: 50,
      moveScale: 0.88,
      adsMoveScale: 0.46,
    },
    seed: 0x0be17,
    blurb:
      "Belt-fed 7.62 on a quick-change barrel. Sustained suppressive firepower with heavy three-shot stopping power.",
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
      // 2-shot kill anywhere on torso, 1-shot headshot
      damage: curve([0, 72], [70, 72], [130, 62], [200, 54], [300, 48]),
      penetrationScale: 1.85,
      tracerEvery: 2,
      tracerColor: 0xffa845,
    },
    recoil: {
      verticalDeg: 1.05,
      horizontalDeg: 0.2,
      rampShots: 3,
      sustainScale: 0.92,
      recenterFraction: 0.92,
      recoveryTime: 0.24,
      jitterDeg: 0.06,
      viewKickM: 0.024,
      viewRollRad: 0.022,
    },
    spread: {
      hipDeg: 2.8,
      adsDeg: 0.01,
      moveDeg: 1.1,
      airDeg: 3.2,
      crouchScale: 0.72,
      bloomPerShotDeg: 0.12,
      maxBloomDeg: 0.7,
      bloomDecayDegPerSec: 3.8,
    },
    handling: {
      adsTime: 0.26,
      raiseTime: 0.62,
      lowerTime: 0.44,
      reloadTime: 2.1,
      reloadEmptyTime: 2.75,
      sprintOutTime: 0.2,
      adsFov: 38,
      moveScale: 0.96,
      adsMoveScale: 0.54,
    },
    seed: 0x0d114,
    blurb:
      "Gas-piston designated marksman rifle. Crisp two-shot torso kills and lethal one-shot headshot precision.",
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
      // 115 base: 1-shot kill anywhere on torso & head
      damage: curve([0, 115], [150, 115], [280, 105], [500, 95]),
      penetrationScale: 2.8,
      tracerEvery: 0,
      tracerColor: 0xfff0c0,
    },
    recoil: {
      verticalDeg: 2.4,
      horizontalDeg: 0.35,
      rampShots: 2,
      sustainScale: 1,
      recenterFraction: 0.95,
      recoveryTime: 0.42,
      jitterDeg: 0.08,
      viewKickM: 0.045,
      viewRollRad: 0.038,
    },
    spread: {
      hipDeg: 4.5,
      adsDeg: 0,
      moveDeg: 2.2,
      airDeg: 5,
      crouchScale: 0.6,
      bloomPerShotDeg: 0.25,
      maxBloomDeg: 1.0,
      bloomDecayDegPerSec: 3.2,
    },
    handling: {
      adsTime: 0.36,
      raiseTime: 0.75,
      lowerTime: 0.52,
      reloadTime: 2.6,
      reloadEmptyTime: 3.3,
      sprintOutTime: 0.28,
      adsFov: 22,
      moveScale: 0.92,
      adsMoveScale: 0.44,
    },
    seed: 0x03380,
    blurb:
      "Semi-automatic .338 with a detachable box magazine. Instant one-shot kills across the entire torso.",
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
      // 160 base: 1-shot kill anywhere on body
      damage: curve([0, 160], [250, 160], [500, 145], [900, 130]),
      penetrationScale: 4.2,
      tracerEvery: 0,
      tracerColor: 0xfff4d2,
    },
    recoil: {
      verticalDeg: 3.8,
      horizontalDeg: 0.6,
      rampShots: 1,
      sustainScale: 1,
      recenterFraction: 0.98,
      recoveryTime: 0.52,
      jitterDeg: 0.14,
      viewKickM: 0.07,
      viewRollRad: 0.055,
    },
    spread: {
      hipDeg: 5.2,
      adsDeg: 0,
      moveDeg: 2.8,
      airDeg: 6,
      crouchScale: 0.55,
      bloomPerShotDeg: 0.35,
      maxBloomDeg: 1.2,
      bloomDecayDegPerSec: 2.8,
    },
    handling: {
      adsTime: 0.42,
      raiseTime: 0.88,
      lowerTime: 0.64,
      reloadTime: 2.9,
      reloadEmptyTime: 3.7,
      sprintOutTime: 0.34,
      adsFov: 16,
      moveScale: 0.88,
      adsMoveScale: 0.38,
    },
    seed: 0x05000,
    blurb:
      "Bolt-action .50 anti-materiel rifle. Devastating one-shot kills across any distance and through heavy cover.",
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
      // 8 x 24 = 192 inside 10 m -> Guaranteed 1-shot kill close range
      damage: curve([0, 24], [10, 24], [18, 15], [28, 9], [45, 5]),
      penetrationScale: 0.45,
      tracerEvery: 0,
      tracerColor: 0xffb060,
    },
    recoil: {
      verticalDeg: 2.6,
      horizontalDeg: 0.6,
      rampShots: 2,
      sustainScale: 1,
      recenterFraction: 0.88,
      recoveryTime: 0.38,
      jitterDeg: 0.2,
      viewKickM: 0.048,
      viewRollRad: 0.045,
    },
    spread: {
      hipDeg: 3.8,
      adsDeg: 2.2,
      moveDeg: 0.8,
      airDeg: 2.0,
      crouchScale: 0.92,
      bloomPerShotDeg: 0.2,
      maxBloomDeg: 0.9,
      bloomDecayDegPerSec: 4.2,
    },
    handling: {
      adsTime: 0.2,
      raiseTime: 0.48,
      lowerTime: 0.36,
      reloadTime: 0.52,
      reloadEmptyTime: 0.78,
      sprintOutTime: 0.14,
      adsFov: 64,
      moveScale: 1.02,
      adsMoveScale: 0.68,
    },
    seed: 0x0c012,
    blurb:
      "Pump twelve-gauge, shell-by-shell top-up. Devastating one-shot point-blank stopping power with tight choke grouping.",
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
      // 3-shot kill inside 18 m
      damage: curve([0, 42], [18, 42], [32, 30], [55, 24], [90, 20]),
      penetrationScale: 0.65,
      tracerEvery: 0,
      tracerColor: 0xffce8a,
    },
    recoil: {
      verticalDeg: 0.85,
      horizontalDeg: 0.24,
      rampShots: 4,
      sustainScale: 0.88,
      recenterFraction: 0.9,
      recoveryTime: 0.18,
      jitterDeg: 0.1,
      viewKickM: 0.016,
      viewRollRad: 0.02,
    },
    spread: {
      hipDeg: 1.9,
      adsDeg: 0.03,
      moveDeg: 0.6,
      airDeg: 2.0,
      crouchScale: 0.86,
      bloomPerShotDeg: 0.14,
      maxBloomDeg: 1.1,
      bloomDecayDegPerSec: 5.8,
    },
    handling: {
      adsTime: 0.12,
      raiseTime: 0.28,
      lowerTime: 0.2,
      reloadTime: 1.25,
      reloadEmptyTime: 1.65,
      sprintOutTime: 0.08,
      adsFov: 66,
      moveScale: 1.18,
      adsMoveScale: 0.9,
    },
    seed: 0x09019,
    blurb:
      "Striker-fired 9 mm sidearm. Seventeen rounds, lightning draw time, and reliable three-shot backup lethality.",
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
      // 2-shot kill inside 25 m, 1-shot headshot
      damage: curve([0, 75], [25, 75], [45, 58], [75, 48], [120, 42]),
      penetrationScale: 1.4,
      tracerEvery: 0,
      tracerColor: 0xffb257,
    },
    recoil: {
      verticalDeg: 2.0,
      horizontalDeg: 0.45,
      rampShots: 2,
      sustainScale: 1,
      recenterFraction: 0.94,
      recoveryTime: 0.3,
      jitterDeg: 0.18,
      viewKickM: 0.036,
      viewRollRad: 0.04,
    },
    spread: {
      hipDeg: 2.2,
      adsDeg: 0.02,
      moveDeg: 0.8,
      airDeg: 2.4,
      crouchScale: 0.8,
      bloomPerShotDeg: 0.22,
      maxBloomDeg: 1.1,
      bloomDecayDegPerSec: 5.2,
    },
    handling: {
      adsTime: 0.16,
      raiseTime: 0.36,
      lowerTime: 0.26,
      reloadTime: 1.5,
      reloadEmptyTime: 1.95,
      sprintOutTime: 0.11,
      adsFov: 60,
      moveScale: 1.12,
      adsMoveScale: 0.82,
    },
    seed: 0x04444,
    blurb:
      "Long-slide .44 with a ported barrel. Two-shot lethal power with guaranteed one-shot headshot elimination.",
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
  return WEAPONS[id] ?? (WEAPON_ALIASES[id] ? WEAPONS[WEAPON_ALIASES[id]] : undefined);
}

export const WEAPONS_BY_CLASS: Readonly<Record<WeaponClass, readonly WeaponDef[]>> =
  (() => {
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
