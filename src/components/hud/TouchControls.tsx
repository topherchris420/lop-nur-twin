import { useMemo, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { useTwinStore } from "@/lib/store";
import { touchInput, isCoarsePointer } from "@/lib/touchInput";

const RADIUS = 58; // px of thumb travel = full deflection
const SPRINT_AT = 0.9;

/**
 * Mobile first-person controls: a left thumb-stick to walk and the right half
 * of the screen to look around. Everything is written straight into the
 * `touchInput` singleton from pointer handlers and the joystick visuals are
 * moved via refs, so this never re-renders while you drive. Only mounted on
 * touch devices, and only in first-person mode.
 */
export function TouchControls() {
  const mode = useTwinStore((s) => s.cameraMode);
  const coarse = useMemo(isCoarsePointer, []);

  const moveId = useRef<number | null>(null);
  const lookId = useRef<number | null>(null);
  const origin = useRef({ x: 0, y: 0 });
  const lookLast = useRef({ x: 0, y: 0 });
  const baseRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);

  if (!coarse || mode !== "fps") return null;

  const showStick = (x: number, y: number) => {
    const base = baseRef.current;
    if (!base) return;
    base.style.left = `${x}px`;
    base.style.top = `${y}px`;
    base.style.opacity = "1";
    if (thumbRef.current) thumbRef.current.style.transform = "translate(-50%, -50%)";
  };
  const hideStick = () => {
    if (baseRef.current) baseRef.current.style.opacity = "0";
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const half = window.innerWidth / 2;
    if (e.clientX < half && moveId.current === null) {
      moveId.current = e.pointerId;
      origin.current = { x: e.clientX, y: e.clientY };
      showStick(e.clientX, e.clientY);
      e.currentTarget.setPointerCapture(e.pointerId);
    } else if (lookId.current === null) {
      lookId.current = e.pointerId;
      lookLast.current = { x: e.clientX, y: e.clientY };
      e.currentTarget.setPointerCapture(e.pointerId);
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerId === moveId.current) {
      let dx = e.clientX - origin.current.x;
      let dy = e.clientY - origin.current.y;
      const len = Math.hypot(dx, dy);
      if (len > RADIUS) {
        dx = (dx / len) * RADIUS;
        dy = (dy / len) * RADIUS;
      }
      if (thumbRef.current) {
        thumbRef.current.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      }
      touchInput.moveX = dx / RADIUS;
      touchInput.moveY = -dy / RADIUS; // screen up = forward
      touchInput.sprint = Math.hypot(touchInput.moveX, touchInput.moveY) > SPRINT_AT;
    } else if (e.pointerId === lookId.current) {
      touchInput.lookDX += e.clientX - lookLast.current.x;
      touchInput.lookDY += e.clientY - lookLast.current.y;
      lookLast.current = { x: e.clientX, y: e.clientY };
    }
  };

  const endPointer = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerId === moveId.current) {
      moveId.current = null;
      touchInput.moveX = 0;
      touchInput.moveY = 0;
      touchInput.sprint = false;
      hideStick();
    } else if (e.pointerId === lookId.current) {
      lookId.current = null;
    }
  };

  return (
    <div
      className="absolute inset-0 touch-none select-none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* zone affordances */}
      <div className="pointer-events-none absolute bottom-6 left-6 font-mono text-[10px] tracking-[0.2em] text-foreground/35 uppercase">
        ◀ drag to move
      </div>
      <div className="pointer-events-none absolute right-6 bottom-6 font-mono text-[10px] tracking-[0.2em] text-foreground/35 uppercase">
        drag to look ▶
      </div>

      {/* dynamic joystick (positioned/faded via refs) */}
      <div
        ref={baseRef}
        className="pointer-events-none absolute h-[128px] w-[128px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-primary/40 bg-black/20 opacity-0 backdrop-blur-sm transition-opacity"
      >
        <div
          ref={thumbRef}
          className="absolute top-1/2 left-1/2 h-[60px] w-[60px] rounded-full border border-primary/60 bg-primary/25"
        />
      </div>
    </div>
  );
}
