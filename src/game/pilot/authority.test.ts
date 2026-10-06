import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { REGION_SPECS } from "../characters/hitboxSpecs";
import { createActor } from "../core/gameState";
import { CollisionWorld } from "../physics/collisionWorld";
import { getWeapon } from "../weapons/arsenal";
import { WeaponRuntime } from "../weapons/runtime";

/**
 * Blacksite's authority, checked.
 *
 * A brain chooses; the precision controller and Elite Operator execute; the
 * weapon runtime, the collision world and the damage resolver decide. These
 * tests fail if control-layer code reaches past the input into the parts that
 * decide — the damage queue, colliders, health, the weapon's own firing — or if
 * the hitboxes it aims at quietly change size.
 */

const ROOT = join(__dirname, "..", "..", "..");
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8");

/**
 * Everything between a brain's choice and the `InputState`: every source file
 * in the player-seat directory, read from disk rather than listed by hand — a
 * hand-kept list had already missed four files — plus the human aim assist.
 * A new control file is covered the moment it exists.
 */
const PILOT_DIR = "src/game/pilot";
const CONTROL_LAYER = [
  ...readdirSync(join(ROOT, PILOT_DIR))
    .filter((name) => /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name))
    .sort()
    .map((name) => `${PILOT_DIR}/${name}`),
  "src/game/player/eliteAssist.ts",
];

/** Calls and writes only the simulation may make. */
const FORBIDDEN: [RegExp, string][] = [
  [/\bqueueDamage\s*\(/, "queues damage"],
  [/\bresolveDamage\s*\(/, "resolves damage"],
  [/\bdamageQueue\b/, "touches the damage queue"],
  [/\bkillActor\s*\(/, "kills an actor"],
  [/\b(updateCollider|makeCollider|addDynamic|removeDynamic)\s*\(/, "changes a collider"],
  [/\.health\s*(=|-=|\+=)(?!=)/, "writes health"],
  [/\bhitmarker\w*\s*=(?!=)/, "writes a hitmarker"],
  [/\.fire\s*\(\s*\{/, "fires a weapon directly"],
  [/\.(beginReload|refill|raise)\s*\(/, "drives the weapon runtime"],
  [/\.(ammo|reserve|kickPitch|kickYaw)\s*(=|-=|\+=)(?!=)/, "writes weapon state"],
  [
    /\b(body|actor|other|target)\.(position|velocity)\.(set|copy|add|sub|addScaledVector)\s*\(/,
    "moves a body",
  ],
  [/\b(body|actor|other|target)\.(yaw|pitch|alive|stance)\s*=(?!=)/, "writes a body"],
  [/game\.player\.(yaw|pitch|position|health)\s*(=|-=|\+=)(?!=)/, "writes the player"],
  [/\bcamera\.(quaternion|position|rotation)\b/, "touches the camera"],
];

describe("no control-layer code decides an outcome", () => {
  for (const file of CONTROL_LAYER) {
    it(`${file} only reads the simulation`, () => {
      const source = read(file);
      const found = FORBIDDEN.filter(([pattern]) => pattern.test(source)).map(
        ([, what]) => what,
      );
      expect(found).toEqual([]);
    });
  }

  it("would catch each of those, so the scan above cannot pass vacuously", () => {
    const samples = [
      "queueDamage({",
      "resolveDamage(t, out)",
      "game.damageQueue.push(e)",
      "killActor(v, a, e, t)",
      "updateCollider(c, p, q)",
      "victim.health -= 10",
      "hud.hitmarker = 240",
      "weapon.fire({ shooter })",
      "weapon.beginReload()",
      "weapon.ammo = 30",
      "body.position.copy(p)",
      "target.alive = false",
      "game.player.yaw = 0",
      "camera.quaternion.copy(q)",
    ];
    FORBIDDEN.forEach(([pattern], i) => expect(pattern.test(samples[i]!)).toBe(true));
    expect(samples).toHaveLength(FORBIDDEN.length);
  });

  it("takes nothing from the damage resolver but its read-only observer tap", () => {
    // The host subscribes to applied-damage reports to count outcomes; that
    // tap, and types, are the only things control-layer code may import from
    // the resolver. Anything else there decides an outcome.
    const IMPORT = /import\s+(type\s+)?\{([^}]*)\}\s*from\s*["']\.\.\/core\/combat["']/g;
    for (const file of CONTROL_LAYER) {
      const source = read(file);
      expect(source, file).not.toMatch(/import\s+\*\s+as\s+\w+\s+from\s+["']\.\.\/core\/combat["']/);
      for (const match of source.matchAll(IMPORT)) {
        const typeOnly = match[1] !== undefined;
        const names = (match[2] ?? "")
          .split(",")
          .map((name) => name.trim())
          .filter((name) => name.length > 0 && !name.startsWith("type "));
        if (typeOnly) continue;
        expect(names, file).toEqual(names.filter((name) => name === "damageObservers"));
      }
    }
  });
});

describe("hitboxes", () => {
  it("are exactly the table the colliders are built from — no enlargement for anyone", () => {
    expect(REGION_SPECS.map((s) => [s.region, s.centre, ...s.half])).toEqual([
      ["head", 0.94, 0.145, 0.16, 0.15],
      ["neck", 0.862, 0.11, 0.08, 0.11],
      ["chest", 0.755, 0.26, 0.19, 0.18],
      ["stomach", 0.6, 0.24, 0.175, 0.165],
      ["arm", 0.73, 0.34, 0.2, 0.14],
      ["leg", 0.34, 0.22, 0.36, 0.16],
      ["foot", 0.085, 0.22, 0.16, 0.2],
    ]);
  });

  it("are built by the character manager from that table, and nowhere else", () => {
    const manager = read("src/game/characters/manager.ts");
    expect(manager).toMatch(/for \(const spec of REGION_SPECS\)/);
    expect(manager).not.toMatch(/region: "head", centre/);
  });
});

describe("the weapon runtime still decides recoil and spread", () => {
  const shoot = (runtime: WeaponRuntime): void => {
    const shooter = createActor(0, "player", "blue", true);
    runtime.fire({
      shooter,
      world: new CollisionWorld(() => 0),
      time: 1,
      direction: new THREE.Vector3(0, 0, -1),
      origin: new THREE.Vector3(0, 1.6, 0),
      accuracy: 1,
    });
  };

  it("kicks the view on every shot, whoever is holding it", () => {
    const runtime = new WeaponRuntime(getWeapon("oslo-14"));
    runtime.ads = 1;
    let previous = runtime.kickPitch;
    for (let i = 0; i < 8; i += 1) {
      shoot(runtime);
      expect(runtime.kickPitch).toBeGreaterThan(previous);
      previous = runtime.kickPitch;
    }
  });

  it("reports the learned pattern without the jitter nobody can learn", () => {
    const def = getWeapon("oslo-14");
    const runtime = new WeaponRuntime(def);
    runtime.ads = 1;
    const beforePitch = runtime.kickPitch;
    const beforeYaw = runtime.kickYaw;
    shoot(runtime);
    const pitchDeg = ((runtime.kickPitch - beforePitch) * 180) / Math.PI;
    const yawDeg = ((runtime.kickYaw - beforeYaw) * 180) / Math.PI;
    // Pitch carries no jitter: the readout is the whole kick.
    expect(runtime.lastPatternKickDeg.pitch).toBeCloseTo(pitchDeg, 9);
    // Yaw does: the readout differs from the real kick by at most the jitter.
    expect(Math.abs(yawDeg - runtime.lastPatternKickDeg.yaw)).toBeLessThanOrEqual(
      def.recoil.jitterDeg + 1e-9,
    );
  });

  it("keeps a spread cone from the hip and down the sights", () => {
    const runtime = new WeaponRuntime(getWeapon("oslo-14"));
    const hip = runtime.spreadDeg("stand", 0, false);
    runtime.ads = 1;
    const aimed = runtime.spreadDeg("stand", 0, false);
    expect(hip).toBeGreaterThan(1);
    expect(aimed).toBeGreaterThan(0);
    expect(aimed).toBeLessThan(hip);
    expect(runtime.settledSpreadDeg("stand")).toBeCloseTo(aimed, 9);
    // Movement still widens it.
    expect(runtime.spreadDeg("stand", 5, false)).toBeGreaterThan(aimed);
  });
});
