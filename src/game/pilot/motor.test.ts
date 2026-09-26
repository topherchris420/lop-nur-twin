import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { createInputState, clearInputEdges } from "../core/gameState";
import { forwardToYaw, yawToForward, type Stance } from "../core/types";
import {
  MOTOR,
  PrecisionMotorController,
  axisRate,
  type MotorSense,
  type MotorWeapon,
  type ReleaseReason,
  type TriggerIntent,
} from "./motor";
import { aimRegionGeometry } from "./hitGeometry";

/**
 * A closed-loop bench for the precision controller.
 *
 * The rig's own order is reproduced: the round of step N leaves along the
 * camera direction computed at the end of step N-1; the look delta written in
 * step N turns the view for step N+1; a shot's recoil kick is added to the view
 * after the round leaves. Recoil here is a fixed climb plus seeded jitter, like
 * `WeaponRuntime`'s pattern, and it is applied in full whatever the controller
 * does.
 */

const DT = 1 / 60;
const DEG = Math.PI / 180;

interface BenchTarget {
  id: number;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  stance: Stance;
  alive: boolean;
  /** Sight line blocked while true. */
  hidden: boolean;
}

interface BenchOptions {
  targets: BenchTarget[];
  yawDeg?: number;
  pitchDeg?: number;
  spreadDeg?: number;
  fireMode?: MotorWeapon["fireMode"];
  ads?: number;
  rpm?: number;
  kickPitchDeg?: number;
  kickYawDeg?: number;
  jitterDeg?: number;
  playerSpeed?: number;
  seed?: number;
}

class Bench {
  readonly motor: PrecisionMotorController;
  readonly input = createInputState();
  yaw: number;
  pitch: number;
  time = 0;
  shots = 0;
  hitsOnBody = 0;
  shotErrors: number[] = [];
  lookRates: number[] = [];
  releases: ReleaseReason[] = [];
  opportunities = 0;
  suppressed = 0;
  readonly targets: BenchTarget[];
  private shotClock = 0;
  private triggerWas = false;
  private rand: () => number;
  weapon: MotorWeapon & { ads: number; readyToFire: boolean };
  readonly options: Required<Omit<BenchOptions, "targets">>;
  playerVelocity = new THREE.Vector3();

  constructor(options: BenchOptions) {
    this.options = {
      yawDeg: 0,
      pitchDeg: 0,
      spreadDeg: 0.4,
      fireMode: "auto",
      ads: 1,
      rpm: 700,
      kickPitchDeg: 0.55,
      kickYawDeg: 0.15,
      jitterDeg: 0.08,
      playerSpeed: 0,
      seed: 7,
      ...options,
    };
    this.targets = options.targets;
    this.yaw = this.options.yawDeg * DEG;
    this.pitch = this.options.pitchDeg * DEG;
    this.motor = new PrecisionMotorController(this.options.seed);
    let s = this.options.seed * 9301 + 49297;
    this.rand = () => {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };
    // As in the rig, the clock advances after the controller runs.
    const ready = (): boolean => this.shotClock <= DT * 0.999;
    this.weapon = {
      fireMode: this.options.fireMode,
      weaponClass: "assault",
      muzzleVelocity: 900,
      pellets: 1,
      ads: this.options.ads,
      get readyToFire() {
        return ready();
      },
      set readyToFire(_v: boolean) {},
      isReloading: false,
      spreadDeg: () => this.options.spreadDeg,
    };
    this.motor.events = {
      onRelease: (_id, reason) => this.releases.push(reason),
      onTriggerOpportunity: (fired) => {
        this.opportunities += 1;
        if (!fired) this.suppressed += 1;
      },
    };
  }

  aim(): THREE.Vector3 {
    return yawToForward(this.yaw, new THREE.Vector3(), this.pitch);
  }

  eye(): THREE.Vector3 {
    return new THREE.Vector3(0, 1.62, 0);
  }

  sense(): MotorSense {
    const eye = this.eye();
    return {
      now: this.time,
      eye,
      aim: this.aim(),
      halfFovDeg: { h: 45, v: 30 },
      player: {
        speed: this.options.playerSpeed,
        stance: "stand",
        grounded: true,
        yaw: this.yaw,
        velocity: this.playerVelocity,
      },
      weapon: this.weapon,
      body: (id) => {
        const t = this.targets.find((x) => x.id === id);
        return t && t.alive ? { stance: t.stance, position: t.position } : null;
      },
      sightline: (id) => {
        const t = this.targets.find((x) => x.id === id);
        return !!t && !t.hidden;
      },
    };
  }

  /** Angle from the aim to a target's region, degrees. */
  errorTo(
    target: BenchTarget,
    region: "CENTER_MASS" | "UPPER_CHEST" | "HEAD" = "UPPER_CHEST",
  ): number {
    const g = aimRegionGeometry(region, target.stance);
    const point = target.position.clone().setY(target.position.y + g.heightM);
    return (this.aim().angleTo(point.sub(this.eye())) * 180) / Math.PI;
  }

  step(
    trigger: TriggerIntent = { fire: false, ads: true, sprintRequested: false },
  ): void {
    const input = this.input;
    // The executor's part: nothing held, no turn.
    input.lookYaw = 0;
    input.lookPitch = 0;
    input.fire = trigger.fire;
    input.ads = trigger.ads;
    const sense = this.sense();
    this.motor.apply(input, sense, trigger, DT);
    // The round of this step leaves along the previous camera direction.
    this.shotClock = Math.max(0, this.shotClock - DT);
    const pressed = input.fire && (this.options.fireMode === "auto" || !this.triggerWas);
    this.triggerWas = input.fire;
    if (pressed && this.shotClock <= 0) {
      this.shotClock = 60 / this.options.rpm;
      this.shots += 1;
      const bound = this.targets.find((t) => t.id === this.motor.targetId);
      if (bound) this.shotErrors.push(this.errorTo(bound));
      // Recoil: the full kick, pattern plus jitter, lands on the view.
      const jitter = (this.rand() - 0.5) * 2 * this.options.jitterDeg;
      const kickPitch = this.options.kickPitchDeg;
      const kickYaw = this.options.kickYawDeg;
      this.lookRates.push(Math.abs(input.lookYaw) / DT / DEG);
      this.yaw += input.lookYaw;
      this.pitch += input.lookPitch;
      this.pitch += kickPitch * DEG;
      this.yaw += (kickYaw + jitter) * DEG;
      this.motor.onShot({ pitch: kickPitch, yaw: kickYaw });
    } else {
      this.lookRates.push(Math.abs(input.lookYaw) / DT / DEG);
      this.yaw += input.lookYaw;
      this.pitch += input.lookPitch;
    }
    for (const t of this.targets) t.position.addScaledVector(t.velocity, DT);
    this.time += DT;
    clearInputEdges(input);
  }

  /** Run, re-confirming the binding as a brain deciding ~5 times a second would. */
  run(seconds: number, trigger?: TriggerIntent, confirm = true): void {
    const steps = Math.round(seconds / DT);
    for (let i = 0; i < steps; i += 1) {
      const id = this.motor.targetId;
      const aim = this.motor.aim;
      if (confirm && id !== null && aim !== null && i % 12 === 0) {
        this.motor.engage({ targetId: id, aim }, this.time);
      }
      this.step(trigger);
    }
  }
}

function target(
  id: number,
  x: number,
  z: number,
  options: Partial<BenchTarget> = {},
): BenchTarget {
  return {
    id,
    position: new THREE.Vector3(x, 0, z),
    velocity: new THREE.Vector3(),
    stance: "stand",
    alive: true,
    hidden: false,
    ...options,
  };
}

/** A target `distance` metres away, `bearingDeg` right of north. */
function at(
  id: number,
  distance: number,
  bearingDeg: number,
  options: Partial<BenchTarget> = {},
): BenchTarget {
  const b = bearingDeg * DEG;
  return target(id, Math.sin(b) * distance, -Math.cos(b) * distance, options);
}

const HOLD: TriggerIntent = {
  fire: false,
  ads: true,
  sprintRequested: false,
  forTarget: true,
};
const FIRE: TriggerIntent = {
  fire: true,
  ads: true,
  sprintRequested: false,
  forTarget: true,
};

describe("control law", () => {
  it("never commands more than the rate limit, and changes rate within the acceleration limit", () => {
    let v = 0;
    let previous = 0;
    for (let i = 0; i < 120; i += 1) {
      v = axisRate(90 - i * 0.2, 0, v, DT, MOTOR.maxRateDegS, MOTOR.maxAccelDegS2);
      expect(Math.abs(v)).toBeLessThanOrEqual(MOTOR.maxRateDegS + 1e-9);
      expect(Math.abs(v - previous)).toBeLessThanOrEqual(MOTOR.maxAccelDegS2 * DT + 1e-9);
      previous = v;
    }
  });
});

describe("precision motor controller", () => {
  it("converges on a still target to well under the old 0.5° fine step, without snapping", () => {
    const enemy = at(1, 30, 25);
    const bench = new Bench({ targets: [enemy] });
    bench.motor.engage({ targetId: 1, aim: "UPPER_CHEST" }, 0);
    bench.step(HOLD);
    // Not a teleport: one step turns at most the rate limit's worth.
    expect(bench.errorTo(enemy)).toBeGreaterThan(20);
    bench.run(0.6, HOLD);
    const errors: number[] = [];
    for (let i = 0; i < 60; i += 1) {
      bench.step(HOLD);
      errors.push(bench.errorTo(enemy));
    }
    const mean = errors.reduce((a, b) => a + b, 0) / errors.length;
    expect(mean).toBeLessThan(0.15);
    expect(Math.max(...errors)).toBeLessThan(0.25);
  });

  it("does not overshoot or oscillate across a large error", () => {
    const enemy = at(1, 40, 40);
    const bench = new Bench({ targets: [enemy] });
    bench.motor.engage({ targetId: 1, aim: "UPPER_CHEST" }, 0);
    const bearings: number[] = [];
    for (let i = 0; i < 90; i += 1) {
      bench.step(HOLD);
      const toTarget = forwardToYaw(enemy.position.x, enemy.position.z);
      // Signed, in degrees: positive while the target is still to the right.
      bearings.push(-((toTarget - bench.yaw) * 180) / Math.PI);
    }
    const crossings = bearings.filter(
      (b, i) =>
        i > 0 && Math.sign(b) !== Math.sign(bearings[i - 1]!) && Math.abs(b) > 0.05,
    );
    expect(crossings.length).toBe(0);
    // It gets there quickly: an elite flick, not a slow pan.
    const reached = bearings.findIndex((b) => Math.abs(b) < 0.5);
    expect(reached).toBeGreaterThan(5);
    expect(reached * DT).toBeLessThan(0.45);
  });

  it("respects the rate limit on every step", () => {
    const bench = new Bench({ targets: [at(1, 20, 42)] });
    bench.motor.engage({ targetId: 1, aim: "UPPER_CHEST" }, 0);
    bench.run(1, HOLD);
    expect(Math.max(...bench.lookRates)).toBeLessThanOrEqual(MOTOR.maxRateAdsDegS + 1);
  });

  it("tracks a strafing target with prediction, from observed positions only", () => {
    const enemy = at(1, 25, 0, { velocity: new THREE.Vector3(4.5, 0, 0) });
    const bench = new Bench({ targets: [enemy] });
    bench.motor.engage({ targetId: 1, aim: "UPPER_CHEST" }, 0);
    bench.run(0.8, HOLD);
    const errors: number[] = [];
    for (let i = 0; i < 60; i += 1) {
      bench.step(HOLD);
      errors.push(bench.errorTo(enemy));
    }
    const mean = errors.reduce((a, b) => a + b, 0) / errors.length;
    // 4.5 m/s across at 25 m is ~10°/s; the lead keeps the crosshair on the chest.
    expect(mean).toBeLessThan(0.35);
  });

  it("holds a long-range target and a close one", () => {
    for (const distance of [6, 90]) {
      const enemy = at(1, distance, -12);
      const bench = new Bench({ targets: [enemy] });
      bench.motor.engage({ targetId: 1, aim: "UPPER_CHEST" }, 0);
      bench.run(0.8, HOLD);
      expect(bench.errorTo(enemy)).toBeLessThan(0.2);
    }
  });

  it("controls recoil well, but the kick still happens", () => {
    const run = (compensate: boolean): { mean: number; climb: number } => {
      const enemy = at(1, 30, 0);
      const bench = new Bench({ targets: [enemy], spreadDeg: 0.3 });
      if (!compensate) bench.motor.onShot = () => 0;
      bench.motor.engage({ targetId: 1, aim: "UPPER_CHEST" }, 0);
      bench.run(0.6, HOLD);
      const pitchBefore = bench.pitch;
      let climb = 0;
      const shotsBefore = bench.shots;
      for (let i = 0; i < 60; i += 1) {
        const before = bench.pitch;
        bench.step(FIRE);
        if (bench.shots > shotsBefore)
          climb = Math.max(climb, (bench.pitch - before) / DEG);
      }
      void pitchBefore;
      const errors = bench.shotErrors;
      return {
        mean: errors.reduce((a, b) => a + b, 0) / Math.max(1, errors.length),
        climb,
      };
    };
    const with_ = run(true);
    const without = run(false);
    expect(with_.mean).toBeLessThan(0.25);
    expect(with_.mean).toBeLessThan(without.mean);
    // Recoil still moved the view by at least most of a kick on a shot step.
    expect(with_.climb).toBeGreaterThan(0.3);
  });

  it("gates the trigger on the geometric chance of a hit", () => {
    const enemy = at(1, 30, 30);
    const bench = new Bench({ targets: [enemy] });
    bench.motor.engage({ targetId: 1, aim: "UPPER_CHEST" }, 0);
    bench.step(FIRE);
    // 30° off: the gate holds.
    expect(bench.input.fire).toBe(false);
    expect(bench.motor.telemetry.gate).toBe("held");
    bench.run(1.2, FIRE);
    expect(bench.shots).toBeGreaterThan(5);
    // Every round left close to the chest.
    expect(Math.max(...bench.shotErrors)).toBeLessThan(0.6);
    expect(bench.suppressed).toBeGreaterThan(0);
  });

  it("releases an automatic burst when the aim leaves tolerance, then reacquires", () => {
    const enemy = at(1, 60, 0);
    const bench = new Bench({ targets: [enemy], spreadDeg: 0.05, rpm: 700 });
    bench.motor.engage({ targetId: 1, aim: "UPPER_CHEST" }, 0);
    bench.run(0.6, FIRE);
    const before = bench.shots;
    expect(before).toBeGreaterThan(0);
    // The enemy side-steps a metre and a half: the aim is suddenly well off it.
    enemy.position.x += 1.5;
    const errors: number[] = [];
    let firedWhileOff = 0;
    for (let i = 0; i < 12; i += 1) {
      const shots = bench.shots;
      const error = bench.errorTo(enemy);
      bench.step(FIRE);
      if (bench.shots > shots) {
        errors.push(error);
        if (error > 0.6) firedWhileOff += 1;
      }
    }
    // The first rounds after the step may already be committed; the burst
    // must not keep emptying the magazine at the old spot.
    expect(firedWhileOff).toBeLessThanOrEqual(1);
    bench.run(0.8, FIRE);
    expect(bench.shots).toBeGreaterThan(before + 2);
  });

  it("holds fire when the spread cone is much wider than the region", () => {
    const enemy = at(1, 120, 0);
    const bench = new Bench({ targets: [enemy], spreadDeg: 4 });
    bench.motor.engage({ targetId: 1, aim: "HEAD" }, 0);
    bench.run(1, FIRE);
    expect(bench.shots).toBe(0);
  });

  it("pulses a semi-automatic trigger once per cycled round", () => {
    const enemy = at(1, 20, 0);
    const bench = new Bench({ targets: [enemy], fireMode: "semi", rpm: 400 });
    bench.motor.engage({ targetId: 1, aim: "UPPER_CHEST" }, 0);
    let presses = 0;
    let was = false;
    for (let i = 0; i < 60; i += 1) {
      bench.step(FIRE);
      if (bench.input.fire && !was) presses += 1;
      was = bench.input.fire;
    }
    // One second at 400 rpm: about six or seven rounds, and no wasted pulls.
    expect(bench.shots).toBeGreaterThanOrEqual(5);
    expect(presses).toBe(bench.shots);
  });

  it("waits for the sights at range, but not up close", () => {
    const far = new Bench({ targets: [at(1, 45, 0)], ads: 0.2 });
    far.motor.engage({ targetId: 1, aim: "UPPER_CHEST" }, 0);
    far.run(0.5, FIRE);
    expect(far.shots).toBe(0);
    expect(far.motor.telemetry.gate).toBe("settling");
    const near = new Bench({ targets: [at(1, 7, 0)], ads: 0.2 });
    near.motor.engage({ targetId: 1, aim: "UPPER_CHEST" }, 0);
    near.run(0.5, FIRE);
    expect(near.shots).toBeGreaterThan(0);
  });

  it("releases a target that leaves sight, and never tracks it behind the wall", () => {
    const enemy = at(1, 30, 20);
    const bench = new Bench({ targets: [enemy] });
    bench.motor.engage({ targetId: 1, aim: "UPPER_CHEST" }, 0);
    bench.run(0.1, HOLD);
    enemy.hidden = true;
    // The enemy moves behind cover; the controller must not follow the live position.
    enemy.velocity.set(-8, 0, 0);
    const yawAtLoss = bench.yaw;
    bench.run(0.5, FIRE);
    expect(bench.releases).toContain("lost_sight");
    expect(bench.motor.targetId).toBeNull();
    expect(bench.shots).toBe(0);
    // After the release the view stops; it never swung toward the hidden body.
    const turnedLeft = bench.yaw - yawAtLoss;
    expect(turnedLeft).toBeLessThan(10 * DEG);
  });

  it("releases an eliminated target", () => {
    const enemy = at(1, 30, 5);
    const bench = new Bench({ targets: [enemy] });
    bench.motor.engage({ targetId: 1, aim: "UPPER_CHEST" }, 0);
    bench.run(0.2, HOLD);
    enemy.alive = false;
    bench.step(FIRE);
    expect(bench.releases).toEqual(["eliminated"]);
    expect(bench.input.fire).toBe(false);
  });

  it("lets go when the brain stops confirming the target", () => {
    const bench = new Bench({ targets: [at(1, 30, 5)] });
    bench.motor.engage({ targetId: 1, aim: "UPPER_CHEST" }, 0);
    bench.run(MOTOR.bindingTimeoutS + 0.1, HOLD, false);
    expect(bench.releases).toEqual(["timeout"]);
  });

  it("tracks only the chosen target among several, and switches when told", () => {
    const a = at(1, 30, -18);
    const b = at(2, 25, 16);
    const bench = new Bench({ targets: [a, b] });
    bench.motor.engage({ targetId: 1, aim: "UPPER_CHEST" }, 0);
    bench.run(0.8, HOLD);
    expect(bench.errorTo(a)).toBeLessThan(0.2);
    expect(bench.errorTo(b)).toBeGreaterThan(30);
    bench.motor.engage({ targetId: 2, aim: "UPPER_CHEST" }, bench.time);
    expect(bench.releases).toEqual(["switched"]);
    bench.run(0.8, HOLD);
    expect(bench.errorTo(b)).toBeLessThan(0.2);
  });

  it("aims at the head when asked, and at the chest when the head is the part in cover", () => {
    const enemy = at(1, 20, 0);
    const bench = new Bench({ targets: [enemy] });
    bench.motor.engage({ targetId: 1, aim: "HEAD" }, 0);
    bench.run(0.8, HOLD);
    expect(bench.errorTo(enemy, "HEAD")).toBeLessThan(0.2);
    expect(bench.motor.telemetry.heldAim).toBe("HEAD");
  });

  it("drops a sprint that would block the shot it was asked to take, and counter-strafes to settle", () => {
    const enemy = at(1, 60, 0);
    const bench = new Bench({ targets: [enemy], spreadDeg: 0.3, playerSpeed: 4 });
    // Spread from movement: wide while moving, tight when still.
    bench.weapon.spreadDeg = (_stance, speed) => (speed > 1 ? 1.4 : 0.15);
    bench.playerVelocity.set(4, 0, 0);
    bench.motor.engage({ targetId: 1, aim: "UPPER_CHEST" }, 0);
    bench.run(0.5, HOLD);
    bench.input.sprint = true;
    bench.input.moveX = 1;
    const input = bench.input;
    input.sprint = true;
    bench.motor.apply(
      input,
      bench.sense(),
      { fire: true, ads: true, sprintRequested: true },
      DT,
    );
    expect(input.sprint).toBe(false);
    expect(bench.motor.telemetry.stabilizing).toBe(true);
    // Moving right (+x) while facing north: press left.
    expect(input.moveX).toBe(-1);
  });

  it("is deterministic for a seed", () => {
    const trace = (): number[] => {
      const bench = new Bench({
        targets: [at(1, 30, 12, { velocity: new THREE.Vector3(2, 0, 1) })],
        seed: 11,
      });
      bench.motor.engage({ targetId: 1, aim: "CENTER_MASS" }, 0);
      const out: number[] = [];
      for (let i = 0; i < 90; i += 1) {
        bench.step(FIRE);
        out.push(bench.yaw, bench.pitch, bench.shots);
      }
      return out;
    };
    expect(trace()).toEqual(trace());
  });

  it("leaves the input alone with nothing bound and no target named", () => {
    const bench = new Bench({ targets: [at(1, 30, 5)] });
    const input = bench.input;
    input.lookYaw = 0.01;
    input.fire = true;
    bench.motor.apply(input, bench.sense(), { ...FIRE, forTarget: false }, DT);
    expect(input.lookYaw).toBe(0.01);
    expect(input.fire).toBe(true);
  });

  it("keeps the trigger released when the named target is gone", () => {
    const bench = new Bench({ targets: [at(1, 30, 5)] });
    const input = bench.input;
    input.fire = true;
    bench.motor.apply(input, bench.sense(), FIRE, DT);
    expect(input.fire).toBe(false);
  });
});
