import {
  useEffect,
  useMemo,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Move } from "lucide-react";
import { useTwinStore } from "@/lib/store";
import { touchInput, isCoarsePointer } from "@/lib/touchInput";

const RADIUS = 46; // px of thumb travel = full deflection

/**
 * Mobile pan-stick for the free-fly orbit camera. Orbit mode already rotates
 * with one finger and zooms with a pinch, but gliding the view across the
 * airfield otherwise needs an awkward two-finger drag — so on touch devices we
 * offer a fixed thumb-stick that slides the camera over the ground.
 *
 * Like the first-person controls, deflection is written straight into the
 * `touchInput` singleton and consumed by `OrbitRig` in `useFrame`; the thumb
 * moves via a ref, so this never re-renders while you drive. Only mounted on
 * touch devices, and only in orbit mode.
 */
export function OrbitJoystick() {
  const mode = useTwinStore((s) => s.cameraMode);
  const coarse = useMemo(isCoarsePointer, []);

  const activeId = useRef<number | null>(null);
  const center = useRef({ x: 0, y: 0 });
  const baseRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);

  // ensure we never leave stale deflection behind when unmounting / switching
  useEffect(() => {
    return () => {
      touchInput.moveX = 0;
      touchInput.moveY = 0;
    };
  }, []);

  if (!coarse || mode !== "orbit") return null;

  const setThumb = (dx: number, dy: number) => {
    if (thumbRef.current) {
      thumbRef.current.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    }
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (activeId.current !== null || !baseRef.current) return;
    activeId.current = e.pointerId;
    const rect = baseRef.current.getBoundingClientRect();
    center.current = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    e.currentTarget.setPointerCapture(e.pointerId);
    onPointerMove(e);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerId !== activeId.current) return;
    let dx = e.clientX - center.current.x;
    let dy = e.clientY - center.current.y;
    const len = Math.hypot(dx, dy);
    if (len > RADIUS) {
      dx = (dx / len) * RADIUS;
      dy = (dy / len) * RADIUS;
    }
    setThumb(dx, dy);
    touchInput.moveX = dx / RADIUS;
    touchInput.moveY = -dy / RADIUS; // screen up = push the view away (north-ish)
  };

  const endPointer = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerId !== activeId.current) return;
    activeId.current = null;
    touchInput.moveX = 0;
    touchInput.moveY = 0;
    setThumb(0, 0);
  };

  return (
    <div className="pointer-events-none absolute right-6 bottom-6 flex flex-col items-center gap-1.5">
      <div
        ref={baseRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onContextMenu={(e) => e.preventDefault()}
        className="pointer-events-auto relative h-28 w-28 touch-none rounded-full border border-primary/40 bg-black/25 backdrop-blur-sm"
      >
        <Move className="pointer-events-none absolute top-1/2 left-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 text-primary/25" />
        <div
          ref={thumbRef}
          className="pointer-events-none absolute top-1/2 left-1/2 flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-primary/60 bg-primary/25"
        />
      </div>
      <span className="pointer-events-none font-mono text-[10px] tracking-[0.2em] text-foreground/40 uppercase">
        pan
      </span>
    </div>
  );
}
