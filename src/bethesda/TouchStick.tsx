import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import type { Stick } from "./walkInput";

/** Thumb travel for a full deflection, as a share of the base's width (the twin's 46 of 112). */
const REACH = 0.41;

/**
 * A thumb-stick for walking on a touch screen. It writes its deflection into
 * the `Stick` it is given and nothing else; the walker reads that on its own
 * clock (the city's fixed-rate timer, the lab's frame loop), so dragging the
 * thumb never re-renders anything. Letting go, a cancelled touch, a lost
 * capture, a blur and an unmount all return it to rest — a stick left
 * deflected would keep walking with nobody touching it.
 *
 * It is a pointer-only control, hidden from assistive technology: the keys it
 * stands in for (WASD, Shift) remain the keyboard's way to walk.
 */
export function TouchStick({ stick, label = "walk" }: { stick: Stick; label?: string }) {
  const active = useRef<number | null>(null);
  const center = useRef({ x: 0, y: 0 });
  const radius = useRef(46);
  const base = useRef<HTMLDivElement>(null);
  const thumb = useRef<HTMLDivElement>(null);

  // The thumb's classes centre it through CSS `translate`, which composes with
  // `transform`; the deflection alone goes in the transform.
  const place = (dx: number, dy: number) => {
    if (thumb.current) thumb.current.style.transform = `translate(${dx}px, ${dy}px)`;
  };
  const rest = () => {
    active.current = null;
    stick.x = 0;
    stick.y = 0;
    place(0, 0);
  };
  const restRef = useRef(rest);
  restRef.current = rest;
  useEffect(() => {
    const blur = () => restRef.current();
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("blur", blur);
      blur();
    };
  }, []);

  const follow = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerId !== active.current) return;
    let dx = e.clientX - center.current.x,
      dy = e.clientY - center.current.y;
    const len = Math.hypot(dx, dy),
      reach = radius.current;
    if (len > reach) {
      dx = (dx / len) * reach;
      dy = (dy / len) * reach;
    }
    place(dx, dy);
    stick.x = dx / reach;
    stick.y = -dy / reach; // up the screen is forward
  };
  const end = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerId === active.current) rest();
  };

  return (
    <div
      aria-hidden="true"
      data-touch-stick=""
      className="pointer-events-none flex flex-col items-center gap-1.5"
    >
      <div
        ref={base}
        onPointerDown={(e) => {
          if (active.current !== null || !base.current) return;
          e.preventDefault();
          active.current = e.pointerId;
          const r = base.current.getBoundingClientRect();
          center.current = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
          // The stick is smaller on a short screen; its travel scales with it.
          radius.current = r.width * REACH;
          e.currentTarget.setPointerCapture(e.pointerId);
          follow(e);
        }}
        onPointerMove={follow}
        onPointerUp={end}
        onPointerCancel={end}
        onLostPointerCapture={end}
        onContextMenu={(e) => e.preventDefault()}
        className="pointer-events-auto relative h-28 w-28 touch-none rounded-full [@media(max-height:500px)]:h-20 [@media(max-height:500px)]:w-20 border border-teal-100/40 bg-[#071012]/45 backdrop-blur-sm select-none"
      >
        <div
          ref={thumb}
          className="pointer-events-none absolute top-1/2 left-1/2 h-14 w-14 -translate-x-1/2 [@media(max-height:500px)]:h-10 [@media(max-height:500px)]:w-10 -translate-y-1/2 rounded-full border border-teal-100/70 bg-teal-200/25"
        />
      </div>
      <span className="font-mono text-[10px] tracking-[0.2em] text-teal-100/70 uppercase">
        {label}
      </span>
    </div>
  );
}
