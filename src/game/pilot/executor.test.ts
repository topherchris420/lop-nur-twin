import { beforeEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  CONTROL_WINDOW_S,
  LOOK_APPLY_S,
  TILT_STEP_DEG,
  TURN_STEP_DEG,
  type ControlFrame,
} from "./contract";
import { ActionExecutor, type ExecutionContext, type FrameEndReason } from "./executor";
import { clearInputEdges, createActor, createInputState } from "../core/gameState";
import { PlayerController } from "../player/controller";
import { CollisionWorld } from "../physics/collisionWorld";

const DT = 1 / 60;
const frame = (overrides: Partial<ControlFrame> = {}): ControlFrame => ({
  move: "HOLD",
  turn: "NO_TURN",
  tilt: "NO_TILT",
  weapon: "NO_FIRE",
  target: "NONE",
  aim: "CENTER_MASS",
  ...overrides,
});
const ctx = (
  simTime: number,
  overrides: Partial<ExecutionContext> = {},
): ExecutionContext => ({
  simTime,
  dt: DT,
  stance: "stand",
  fireMode: "auto",
  ...overrides,
});

describe("action → InputState", () => {
  let executor: ActionExecutor;
  beforeEach(() => {
    executor = new ActionExecutor();
  });

  it("writes held movement, sprint, trigger and aim-down-sights", () => {
    const input = createInputState();
    executor.start(frame({ move: "STRAFE_LEFT", weapon: "ADS_FIRE" }), 0);
    executor.apply(input, ctx(0));
    expect(input.moveX).toBe(-1);
    expect(input.moveY).toBe(0);
    expect(input.fire).toBe(true);
    expect(input.ads).toBe(true);
    expect(input.sprint).toBe(false);

    executor.start(frame({ move: "SPRINT_FORWARD" }), 0.1);
    executor.apply(input, ctx(0.1));
    expect(input.moveY).toBe(1);
    expect(input.sprint).toBe(true);
    expect(input.fire).toBe(false);
    expect(input.ads).toBe(false);
  });

  it("raises one-shot edges exactly once", () => {
    const input = createInputState();
    executor.start(frame({ move: "JUMP", weapon: "RELOAD" }), 0);
    executor.apply(input, ctx(0));
    expect(input.jumpPressed).toBe(true);
    expect(input.reloadPressed).toBe(true);
    clearInputEdges(input);
    executor.apply(input, ctx(DT));
    expect(input.jumpPressed).toBe(false);
    expect(input.reloadPressed).toBe(false);
  });

  it("resolves stance controls against the stance at execution time", () => {
    const input = createInputState();
    executor.start(frame({ move: "STAND" }), 0);
    executor.apply(input, ctx(0, { stance: "crouch" }));
    expect(input.crouchPressed).toBe(true);
    expect(input.pronePressed).toBe(false);

    clearInputEdges(input);
    executor.start(frame({ move: "STAND" }), 1);
    executor.apply(input, ctx(1, { stance: "prone" }));
    expect(input.pronePressed).toBe(true);

    // Already standing: STAND must not toggle the player into a crouch.
    clearInputEdges(input);
    executor.start(frame({ move: "STAND" }), 2);
    executor.apply(input, ctx(2, { stance: "stand" }));
    expect(input.crouchPressed).toBe(false);
    expect(input.pronePressed).toBe(false);
  });

  it("applies a fixed rotation through lookYaw/lookPitch, spread over the look window", () => {
    const input = createInputState();
    executor.start(frame({ turn: "TURN_RIGHT_MEDIUM", tilt: "LOOK_DOWN_SMALL" }), 0);
    let yaw = 0;
    let pitch = 0;
    let steps = 0;
    for (let t = 0; t < CONTROL_WINDOW_S - 1e-9; t += DT) {
      executor.apply(input, ctx(t));
      yaw += input.lookYaw;
      pitch += input.lookPitch;
      clearInputEdges(input);
      steps += 1;
    }
    // The rig's convention: turning right is negative yaw; looking down is negative pitch.
    expect(yaw).toBeCloseTo((-TURN_STEP_DEG.TURN_RIGHT_MEDIUM * Math.PI) / 180, 9);
    expect(pitch).toBeCloseTo((TILT_STEP_DEG.LOOK_DOWN_SMALL * Math.PI) / 180, 9);
    // Spread over several steps, not snapped in one.
    expect(steps).toBeGreaterThan(Math.floor(LOOK_APPLY_S / DT));
  });

  it("never writes the camera or the player's yaw directly — only deltas", () => {
    const input = createInputState();
    executor.start(frame({ turn: "TURN_AROUND" }), 0);
    executor.apply(input, ctx(0));
    const perStep = Math.abs(input.lookYaw);
    expect(perStep).toBeGreaterThan(0);
    expect(perStep).toBeLessThan(Math.PI / 4);
  });

  it("expires every held control at the end of the control window", () => {
    const input = createInputState();
    const ended: FrameEndReason[] = [];
    executor.onFrameEnd = (_frame, reason) => ended.push(reason);
    executor.start(frame({ move: "FORWARD", weapon: "ADS_FIRE" }), 10);
    executor.apply(input, ctx(10 + CONTROL_WINDOW_S - 0.01));
    expect(input.moveY).toBe(1);
    expect(input.fire).toBe(true);
    executor.apply(input, ctx(10 + CONTROL_WINDOW_S + 0.001));
    expect(input.moveY).toBe(0);
    expect(input.fire).toBe(false);
    expect(input.ads).toBe(false);
    expect(input.sprint).toBe(false);
    expect(executor.current).toBeNull();
    expect(ended).toEqual(["expired"]);
  });

  it("a replacing frame ends the previous one and takes over cleanly", () => {
    const input = createInputState();
    const ended: FrameEndReason[] = [];
    executor.onFrameEnd = (_frame, reason) => ended.push(reason);
    executor.start(frame({ move: "FORWARD", weapon: "FIRE" }), 0);
    executor.apply(input, ctx(0));
    executor.start(frame({ move: "BACK" }), 0.2);
    executor.apply(input, ctx(0.2));
    expect(input.moveY).toBe(-1);
    expect(input.fire).toBe(false);
    expect(ended).toEqual(["replaced"]);
  });

  it("clear() releases everything at once, edges and pending rotation included", () => {
    const input = createInputState();
    executor.start(
      frame({ move: "SPRINT_FORWARD", turn: "TURN_AROUND", weapon: "ADS_FIRE" }),
      0,
    );
    executor.apply(input, ctx(0));
    input.leanLeft = true;
    executor.clear(input, 0.05);
    expect(input).toEqual({ ...createInputState() });
    // Nothing left to apply afterwards.
    executor.apply(input, ctx(0.1));
    expect(input.lookYaw).toBe(0);
    expect(input.moveY).toBe(0);
  });

  it("re-presses the trigger for a semi-automatic, but holds it for automatic fire", () => {
    const input = createInputState();
    executor.start(frame({ weapon: "FIRE" }), 0);
    executor.apply(input, ctx(0, { fireMode: "semi" }));
    expect(input.fire).toBe(true);
    executor.start(frame({ weapon: "FIRE" }), 0.2);
    executor.apply(input, ctx(0.2, { fireMode: "semi" }));
    expect(input.fire).toBe(false); // one released step so the next pull registers
    executor.apply(input, ctx(0.2 + DT, { fireMode: "semi" }));
    expect(input.fire).toBe(true);

    const auto = new ActionExecutor();
    const held = createInputState();
    auto.start(frame({ weapon: "FIRE" }), 0);
    auto.apply(held, ctx(0));
    auto.start(frame({ weapon: "FIRE" }), 0.2);
    auto.apply(held, ctx(0.2));
    expect(held.fire).toBe(true);
  });
});

describe("the existing controller executes the frame", () => {
  it("moves the actor through PlayerController and nothing else", () => {
    const world = new CollisionWorld(() => 0);
    const controller = new PlayerController();
    const actor = createActor(0, "pilot", "blue", true);
    const input = createInputState();
    const executor = new ActionExecutor();
    executor.start(frame({ move: "FORWARD" }), 0);
    for (let i = 0; i < 20; i += 1) {
      executor.apply(input, ctx(i * DT));
      controller.update(actor, input, world, DT, 0);
      clearInputEdges(input);
    }
    // Yaw 0 faces north (−z); the controller, not the executor, moved the body.
    expect(actor.position.z).toBeLessThan(-0.5);
    expect(Math.abs(actor.position.x)).toBeLessThan(1e-6);
  });

  it("turns the view only when the rig integrates the look delta", () => {
    const actor = createActor(0, "pilot", "blue", true);
    const input = createInputState();
    const executor = new ActionExecutor();
    executor.start(frame({ turn: "TURN_LEFT_LARGE" }), 0);
    for (let i = 0; i < 30; i += 1) {
      executor.apply(input, ctx(i * DT));
      // What PlayerRig does with the input each step.
      actor.yaw += input.lookYaw;
      clearInputEdges(input);
    }
    expect(THREE.MathUtils.radToDeg(actor.yaw)).toBeCloseTo(25, 6);
  });
});
