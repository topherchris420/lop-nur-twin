import { describe, expect, it } from "vitest";
import {
  LookDrag,
  MOUSE_LOOK,
  STICK_DEADZONE,
  STICK_HURRY,
  TOUCH_LOOK,
  stepFor,
  walkIntent,
} from "./walkInput";

const rest = { x: 0, y: 0 };
const pointer = (
  pointerId: number,
  clientX: number,
  clientY: number,
  pointerType = "touch",
  movementX = 0,
  movementY = 0,
) => ({ pointerId, clientX, clientY, pointerType, movementX, movementY }) as PointerEvent;

describe("walkIntent", () => {
  it("takes the step WASD always took", () => {
    const yaw = 0.7;
    for (const [keys, x, z] of [
      [["KeyW"], 0, -1],
      [["KeyS", "KeyD"], 1, 1],
      [["KeyA", "KeyW", "ShiftLeft"], -1, -1],
    ] as const) {
      const held = new Set<string>(keys);
      const speed = held.has("ShiftLeft") ? 0.65 : 0.32;
      const norm = Math.hypot(x, z);
      const step = stepFor(walkIntent(held, rest)!, yaw, 0.32, 0.65);
      expect(step.dx).toBeCloseTo(
        ((x * Math.cos(yaw) + z * Math.sin(yaw)) * speed) / norm,
        12,
      );
      expect(step.dz).toBeCloseTo(
        ((-x * Math.sin(yaw) + z * Math.cos(yaw)) * speed) / norm,
        12,
      );
    }
  });

  it("lets held keys win over the stick", () => {
    const intent = walkIntent(new Set(["KeyS"]), { x: 0, y: 1 })!;
    expect(intent).toMatchObject({ x: 0, z: 1, pace: 1 });
  });

  it("reads the arrows only where they walk", () => {
    expect(walkIntent(new Set(["ArrowUp"]), rest)).toBeNull();
    expect(walkIntent(new Set(["ArrowUp"]), rest, true)).toMatchObject({ x: 0, z: -1 });
  });

  it("ignores a resting thumb and anything not finite", () => {
    expect(walkIntent(new Set(), { x: STICK_DEADZONE * 0.9, y: 0 })).toBeNull();
    expect(walkIntent(new Set(), { x: Number.NaN, y: 1 })).toBeNull();
    expect(walkIntent(new Set(), { x: 0, y: Number.POSITIVE_INFINITY })).toBeNull();
  });

  it("walks slower for a small push and hurries at the edge", () => {
    const small = walkIntent(new Set(), { x: 0, y: STICK_DEADZONE + 0.01 })!;
    expect(small.hurry).toBe(false);
    expect(small.pace).toBeGreaterThanOrEqual(0.2);
    expect(small.pace).toBeLessThan(1);
    const edge = walkIntent(new Set(), { x: 0, y: STICK_HURRY })!;
    expect(edge).toMatchObject({ hurry: true, pace: 1 });
    const step = stepFor(edge, 0, 0.32, 0.65);
    expect(Math.hypot(step.dx, step.dz)).toBeCloseTo(0.65, 12);
    // Up the screen is forward: with no turn, forward is -z.
    expect(step.dz).toBeLessThan(0);
  });

  it("never steps further than the hurry speed, however far the stick reads", () => {
    const step = stepFor(walkIntent(new Set(), { x: 3, y: 4 })!, 1.1, 0.32, 0.65);
    expect(Math.hypot(step.dx, step.dz)).toBeCloseTo(0.65, 12);
  });
});

describe("LookDrag", () => {
  it("turns by a finger's own movement, one finger at a time", () => {
    const look = new LookDrag();
    expect(look.begin(pointer(1, 100, 100))).toBe(true);
    expect(look.begin(pointer(2, 300, 100))).toBe(false);
    expect(look.turn(pointer(2, 250, 100), false)).toBeNull();
    const turn = look.turn(pointer(1, 90, 110), false)!;
    expect(turn.yaw).toBeCloseTo(10 * TOUCH_LOOK, 12);
    expect(turn.pitch).toBeCloseTo(-10 * TOUCH_LOOK, 12);
    look.end(pointer(2, 0, 0));
    expect(look.active).toBe(true);
    look.end(pointer(1, 0, 0));
    expect(look.active).toBe(false);
  });

  it("turns a mouse at its own speed, and a locked mouse by its movement", () => {
    const look = new LookDrag(0.0022);
    look.begin(pointer(1, 0, 0, "mouse"));
    expect(look.turn(pointer(1, -10, 0, "mouse"), false)!.yaw).toBeCloseTo(0.022, 12);
    const locked = new LookDrag().turn(pointer(9, 0, 0, "mouse", 5, -5), true)!;
    expect(locked.yaw).toBeCloseTo(-5 * MOUSE_LOOK, 12);
    expect(locked.pitch).toBeCloseTo(5 * MOUSE_LOOK, 12);
  });
});
