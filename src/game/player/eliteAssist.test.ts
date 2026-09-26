import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { createInputState } from "../core/gameState";
import { yawToForward } from "../core/types";
import {
  ELITE,
  EliteOperatorAssist,
  type AssistEnemy,
  type AssistSense,
} from "./eliteAssist";

const DT = 1 / 60;
const DEG = Math.PI / 180;

function enemyAt(id: number, distance: number, bearingDeg: number): AssistEnemy {
  const b = bearingDeg * DEG;
  return {
    id,
    position: new THREE.Vector3(Math.sin(b) * distance, 0, -Math.cos(b) * distance),
    stance: "stand",
  };
}

function sense(
  enemies: AssistEnemy[],
  options: {
    yawDeg?: number;
    pitchDeg?: number;
    ads?: number;
    blocked?: boolean;
    speed?: number;
  } = {},
): AssistSense {
  return {
    dt: DT,
    eye: new THREE.Vector3(0, 1.62, 0),
    aim: yawToForward(
      (options.yawDeg ?? 0) * DEG,
      new THREE.Vector3(),
      (options.pitchDeg ?? -0.4) * DEG,
    ),
    halfFovDeg: { h: 40, v: 25 },
    ads: options.ads ?? 1,
    playerSpeed: options.speed ?? 0,
    enemies,
    sightline: () => !options.blocked,
  };
}

/** Mouse look for one frame, in degrees (yaw left-positive). */
function look(yawDeg: number, pitchDeg = 0) {
  const input = createInputState();
  input.lookYaw = yawDeg * DEG;
  input.lookPitch = pitchDeg * DEG;
  input.fire = false;
  return input;
}

describe("Elite Operator", () => {
  it("slows the look across a visible enemy near the crosshair", () => {
    const assist = new EliteOperatorAssist();
    const input = look(-0.1); // sweeping right, across the body
    assist.apply(input, sense([enemyAt(1, 25, 0.1)]));
    expect(Math.abs(input.lookYaw)).toBeLessThan(0.1 * DEG);
    expect(Math.abs(input.lookYaw)).toBeGreaterThan(
      0.1 * DEG * (1 - ELITE.frictionAds) - 1e-9,
    );
    expect(assist.telemetry.active).toBe(true);
  });

  it("gets out of the way of a flick: the mouse overpowers the assist", () => {
    const assist = new EliteOperatorAssist();
    const input = look(-6); // 360 °/s
    assist.apply(input, sense([enemyAt(1, 25, 0.1)]));
    expect(input.lookYaw).toBeCloseTo(-6 * DEG, 12);
    expect(assist.telemetry.overridden).toBe(true);
    // And stays out of the way for a moment after it.
    const next = look(-0.1);
    assist.apply(next, sense([enemyAt(1, 25, 0.1)]));
    expect(next.lookYaw).toBeCloseTo(-0.1 * DEG, 12);
  });

  it("never helps toward an enemy behind a wall", () => {
    const assist = new EliteOperatorAssist();
    const input = look(-0.1);
    assist.apply(input, sense([enemyAt(1, 25, 0.1)], { blocked: true }));
    expect(input.lookYaw).toBeCloseTo(-0.1 * DEG, 12);
    expect(assist.telemetry.active).toBe(false);
  });

  it("does not pull toward an enemy the mouse is moving away from", () => {
    const assist = new EliteOperatorAssist();
    // The enemy is 1° to the right; the mouse moves left at 60 °/s.
    const input = look(1);
    assist.apply(input, sense([enemyAt(1, 25, 1)], { speed: 3 }));
    expect(input.lookYaw).toBeCloseTo(1 * DEG, 12);
  });

  it("does nothing for an enemy far from the crosshair", () => {
    const assist = new EliteOperatorAssist();
    const input = look(-0.1);
    assist.apply(input, sense([enemyAt(1, 25, 15)]));
    expect(input.lookYaw).toBeCloseTo(-0.1 * DEG, 12);
  });

  it("never fires and never touches movement", () => {
    const assist = new EliteOperatorAssist();
    const input = look(-0.1);
    input.moveX = 1;
    assist.apply(input, sense([enemyAt(1, 25, 0)]));
    expect(input.fire).toBe(false);
    expect(input.firePressed).toBe(false);
    expect(input.moveX).toBe(1);
  });

  it("caps the rotational assist at a few degrees a second while aimed", () => {
    const assist = new EliteOperatorAssist();
    const enemy = enemyAt(1, 10, 0);
    let added = 0;
    for (let i = 0; i < 30; i += 1) {
      // The enemy runs right at 8 m/s — 45 °/s at 10 m; the player holds still.
      enemy.position.x += 8 * DT;
      const input = look(0);
      assist.apply(input, sense([enemy], { speed: 1 }));
      added = Math.max(added, Math.abs(input.lookYaw) / DEG / DT);
    }
    expect(added).toBeLessThanOrEqual(ELITE.maxAssistDegS + 1e-6);
  });

  it("gives no rotational help from the hip", () => {
    const assist = new EliteOperatorAssist();
    const enemy = enemyAt(1, 10, 0);
    for (let i = 0; i < 20; i += 1) {
      enemy.position.x += 8 * DT;
      const input = look(0);
      assist.apply(input, sense([enemy], { ads: 0, speed: 3 }));
      expect(input.lookYaw).toBe(0);
    }
  });

  it("does not jump from the held enemy to one crossing in front of it", () => {
    const assist = new EliteOperatorAssist();
    const held = enemyAt(1, 30, 0.2);
    const crossing = enemyAt(2, 20, 0.6);
    assist.apply(look(-0.05), sense([held]));
    expect(assist.telemetry.candidateId).toBe(1);
    assist.apply(look(-0.05), sense([held, crossing]));
    expect(assist.telemetry.candidateId).toBe(1);
  });

  it("counters part of the learned recoil pattern only when asked to", () => {
    const off = new EliteOperatorAssist();
    off.onShot({ pitch: 0.6, yaw: 0.1 }, false);
    const a = look(0);
    off.apply(a, sense([]));
    expect(a.lookPitch).toBe(0);

    const on = new EliteOperatorAssist();
    on.onShot({ pitch: 0.6, yaw: 0.1 }, true);
    let total = 0;
    for (let i = 0; i < 60; i += 1) {
      const input = look(0);
      on.apply(input, sense([]));
      total += input.lookPitch / DEG;
    }
    // Most of the configured share, and never the whole kick.
    expect(total).toBeLessThan(0);
    expect(Math.abs(total)).toBeCloseTo(0.6 * ELITE.recoilShare, 2);
    expect(Math.abs(total)).toBeLessThan(0.6);
  });
});
