import { afterEach, describe, expect, it } from "vitest";
import {
  KEYBOARD_PAN_STRENGTH,
  keyboardPan,
  resetKeyboardPan,
  stepKeyboardPan,
} from "./keyboardPan";
import { resetTouchInput, touchInput } from "./touchInput";

afterEach(() => {
  resetKeyboardPan();
  resetTouchInput();
});

describe("keyboard pan", () => {
  it("never touches the touch pan-stick's deflection while it is held", () => {
    // The stick is held at a steady deflection and no key is down: the
    // keyboard's ease-out used to multiply this by 0.8 every 16 ms tick.
    touchInput.moveX = 0.6;
    touchInput.moveY = -0.4;
    for (let tick = 0; tick < 120; tick += 1) stepKeyboardPan(new Set());
    expect(touchInput.moveX).toBe(0.6);
    expect(touchInput.moveY).toBe(-0.4);
  });

  it("pans at full strength while a key is held and leaves the stick alone", () => {
    touchInput.moveX = 0.3;
    stepKeyboardPan(new Set(["ArrowUp", "KeyA"]));
    expect(keyboardPan.moveY).toBe(KEYBOARD_PAN_STRENGTH);
    expect(keyboardPan.moveX).toBe(-KEYBOARD_PAN_STRENGTH);
    expect(touchInput.moveX).toBe(0.3);
    expect(touchInput.moveY).toBe(0);
  });

  it("eases out after release and settles at exactly zero", () => {
    stepKeyboardPan(new Set(["KeyD", "KeyS"]));
    stepKeyboardPan(new Set());
    expect(keyboardPan.moveX).toBeCloseTo(KEYBOARD_PAN_STRENGTH * 0.8, 10);
    expect(keyboardPan.moveY).toBeCloseTo(-KEYBOARD_PAN_STRENGTH * 0.8, 10);
    for (let tick = 0; tick < 100; tick += 1) stepKeyboardPan(new Set());
    expect(keyboardPan.moveX).toBe(0);
    expect(keyboardPan.moveY).toBe(0);
  });
});
