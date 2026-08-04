import { clearInputEdges, createInputState, type InputState } from "../core/gameState";

/**
 * Keyboard + mouse capture for the combat layer.
 *
 * Held keys write booleans; one-shot actions write `*Pressed` edges that the
 * simulation clears after it consumes them, so a click that lands between two
 * frames is never dropped. Mouse deltas accumulate into `lookYaw`/`lookPitch`
 * and are also cleared per step — this is the only correct way to read a
 * pointer-locked mouse, because the browser can deliver several movement
 * events per animation frame.
 */

export interface InputBindings {
  forward: string[];
  back: string[];
  left: string[];
  right: string[];
  jump: string[];
  crouch: string[];
  prone: string[];
  sprint: string[];
  reload: string[];
  swap: string[];
  melee: string[];
  use: string[];
  grenade: string[];
  tactical: string[];
  leanLeft: string[];
  leanRight: string[];
  fireMode: string[];
  scoreboard: string[];
}

export const DEFAULT_BINDINGS: InputBindings = {
  forward: ["KeyW", "ArrowUp"],
  back: ["KeyS", "ArrowDown"],
  left: ["KeyA", "ArrowLeft"],
  right: ["KeyD", "ArrowRight"],
  jump: ["Space"],
  crouch: ["ControlLeft", "KeyC"],
  prone: ["KeyZ"],
  sprint: ["ShiftLeft"],
  reload: ["KeyR"],
  // `Q` is the lean key, so it cannot also swap weapons — bound to both, every
  // lean left also put a different gun in your hands.
  swap: ["Digit1", "Digit2"],
  melee: ["KeyV"],
  use: ["KeyF"],
  grenade: ["KeyG"],
  tactical: ["KeyT"],
  leanLeft: ["KeyQ"],
  leanRight: ["KeyE"],
  fireMode: ["KeyB"],
  scoreboard: ["Tab"],
};

export interface InputOptions {
  sensitivity: number;
  adsSensitivity: number;
  invertY: boolean;
  /** Called when the pointer lock state changes. */
  onLockChange?: (locked: boolean) => void;
  /** Called on Escape while locked. */
  onPause?: () => void;
}

const LOOK_SCALE = 0.0022;

export class InputManager {
  readonly state: InputState = createInputState();
  private readonly held = new Set<string>();
  private element: HTMLElement | null = null;
  private locked = false;
  private options: InputOptions;
  private readonly bindings: InputBindings;
  /** 0..1 aim blend, so ADS sensitivity can be applied smoothly. */
  adsBlend = 0;
  /** Raw deltas this frame, exposed for weapon sway. */
  rawYaw = 0;
  rawPitch = 0;

  constructor(options: InputOptions, bindings: InputBindings = DEFAULT_BINDINGS) {
    this.options = options;
    this.bindings = bindings;
  }

  setOptions(options: Partial<InputOptions>): void {
    this.options = { ...this.options, ...options };
  }

  get isLocked(): boolean {
    return this.locked;
  }

  attach(element: HTMLElement): void {
    this.element = element;
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mouseup", this.onMouseUp);
    window.addEventListener("mousemove", this.onMouseMove);
    window.addEventListener("wheel", this.onWheel, { passive: true });
    window.addEventListener("blur", this.onBlur);
    document.addEventListener("pointerlockchange", this.onPointerLockChange);
    document.addEventListener("contextmenu", this.onContextMenu);
  }

  detach(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("mousedown", this.onMouseDown);
    window.removeEventListener("mouseup", this.onMouseUp);
    window.removeEventListener("mousemove", this.onMouseMove);
    window.removeEventListener("wheel", this.onWheel);
    window.removeEventListener("blur", this.onBlur);
    document.removeEventListener("pointerlockchange", this.onPointerLockChange);
    document.removeEventListener("contextmenu", this.onContextMenu);
    this.element = null;
  }

  requestLock(): void {
    // Modern browsers return a promise here and reject it when the call did
    // not follow a user gesture. Left unhandled that surfaces as an uncaught
    // rejection in the console on every automated capture.
    const result = this.element?.requestPointerLock?.() as unknown;
    if (result instanceof Promise) result.catch(() => undefined);
  }

  releaseLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /** Call after the simulation step has consumed the state. */
  endFrame(): void {
    this.rawYaw = this.state.lookYaw;
    this.rawPitch = this.state.lookPitch;
    clearInputEdges(this.state);
  }

  private matches(list: string[], code: string): boolean {
    return list.includes(code);
  }

  private onContextMenu = (event: MouseEvent): void => {
    if (this.locked) event.preventDefault();
  };

  private onPointerLockChange = (): void => {
    this.locked = document.pointerLockElement === this.element;
    if (!this.locked) this.clearHeld();
    this.options.onLockChange?.(this.locked);
  };

  private onBlur = (): void => {
    this.clearHeld();
  };

  private clearHeld(): void {
    this.held.clear();
    const s = this.state;
    s.moveX = 0;
    s.moveY = 0;
    s.fire = false;
    s.ads = false;
    s.sprint = false;
    s.jump = false;
    s.crouch = false;
    s.leanLeft = false;
    s.leanRight = false;
    s.scoreboard = false;
  }

  private syncMovement(): void {
    const s = this.state;
    const b = this.bindings;
    const down = (list: string[]): boolean => list.some((code) => this.held.has(code));
    s.moveY = (down(b.forward) ? 1 : 0) - (down(b.back) ? 1 : 0);
    s.moveX = (down(b.right) ? 1 : 0) - (down(b.left) ? 1 : 0);
    s.jump = down(b.jump);
    s.crouch = down(b.crouch);
    s.sprint = down(b.sprint);
    s.leanLeft = down(b.leanLeft) && !down(b.swap);
    s.leanRight = down(b.leanRight);
    s.scoreboard = down(b.scoreboard);
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.code === "Escape") {
      this.options.onPause?.();
      return;
    }
    if (event.code === "Tab") event.preventDefault();
    if (!this.locked) return;
    if (event.repeat) {
      return;
    }
    this.held.add(event.code);
    const s = this.state;
    const b = this.bindings;
    if (this.matches(b.jump, event.code)) s.jumpPressed = true;
    if (this.matches(b.crouch, event.code)) s.crouchPressed = true;
    if (this.matches(b.prone, event.code)) s.pronePressed = true;
    if (this.matches(b.reload, event.code)) s.reloadPressed = true;
    if (this.matches(b.swap, event.code)) s.swapPressed = true;
    if (this.matches(b.melee, event.code)) s.meleePressed = true;
    if (this.matches(b.use, event.code)) s.usePressed = true;
    if (this.matches(b.grenade, event.code)) s.grenadePressed = true;
    if (this.matches(b.tactical, event.code)) s.tacticalPressed = true;
    if (this.matches(b.fireMode, event.code)) s.fireModePressed = true;
    if (event.code.startsWith("Digit")) {
      const n = Number(event.code.slice(5));
      if (n >= 3 && n <= 9) s.killstreakPressed = n - 3;
    }
    this.syncMovement();
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    this.held.delete(event.code);
    this.syncMovement();
  };

  private onMouseDown = (event: MouseEvent): void => {
    if (!this.locked) return;
    if (event.button === 0) {
      this.state.fire = true;
      this.state.firePressed = true;
    } else if (event.button === 2) {
      this.state.ads = true;
    } else if (event.button === 1) {
      this.state.meleePressed = true;
    }
  };

  private onMouseUp = (event: MouseEvent): void => {
    if (event.button === 0) this.state.fire = false;
    else if (event.button === 2) this.state.ads = false;
  };

  private onMouseMove = (event: MouseEvent): void => {
    if (!this.locked) return;
    // ADS lowers sensitivity so a scoped shot is controllable; the blend keeps
    // it continuous rather than snapping when the aim starts.
    const scale =
      LOOK_SCALE *
      this.options.sensitivity *
      (1 + (this.options.adsSensitivity - 1) * this.adsBlend);
    this.state.lookYaw -= event.movementX * scale;
    this.state.lookPitch -= event.movementY * scale * (this.options.invertY ? -1 : 1);
  };

  private onWheel = (event: WheelEvent): void => {
    if (!this.locked) return;
    if (Math.abs(event.deltaY) > 4) this.state.swapPressed = true;
  };
}
