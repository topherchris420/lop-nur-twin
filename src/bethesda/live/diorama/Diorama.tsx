import { useEffect, useRef, useState } from "react";
import {
  AdaptiveResolution,
  defaultQuality,
  QUALITY,
  type QualityName,
} from "../../../garden/core/quality.js";
import type { LifeObservation, Witness } from "../../life/observation.js";
import type { Sample } from "../witnessFeed.js";
import { DioramaScene } from "./scene.js";
import { clampZoom } from "./stage.js";

type Status = Witness["status"] | "connecting" | "lost";

const deviceQuality = (): QualityName => {
  const nav = navigator as Navigator & {
    deviceMemory?: number;
    connection?: { saveData?: boolean };
  };
  return defaultQuality({
    mobile:
      window.matchMedia("(pointer: coarse)").matches &&
      Math.min(screen.width, screen.height) < 820,
    cores: nav.hardwareConcurrency || null,
    memoryGb: typeof nav.deviceMemory === "number" ? nav.deviceMemory : null,
    saveData: nav.connection?.saveData === true,
  });
};

const STEP_DOWN: Record<QualityName, QualityName | null> = {
  high: "balanced",
  balanced: "performance",
  performance: null,
};

/** Below this length on screen (CSS px) the puppet is marked with a ring, as the garden's wide shot marks its fly. */
const MARK_BELOW_PX = 34;

/**
 * The fly's city as a clay model on a workbench, photographed in stop motion
 * (`scene.ts`). The picture is drawn only from what the witness served; the
 * marks laid over it (where the fly is, north, the wind, a scale) are placed
 * from the same frame. Calls `onUnavailable` if the browser cannot draw it,
 * and the page then shows the flat map instead.
 */
export default function Diorama({
  samples,
  observation,
  status,
  zoom,
  onZoom,
  turn,
  onUnavailable,
}: {
  samples: React.RefObject<Sample[]>;
  observation: LifeObservation | null;
  status: Status;
  zoom: number;
  onZoom: (zoom: number) => void;
  /** Counts quarter-turn requests from the page's buttons: its change turns the lens. */
  turn: number;
  onUnavailable: (reason: string) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const mark = useRef<HTMLDivElement>(null);
  const north = useRef<HTMLDivElement>(null);
  const windArrow = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const barLabel = useRef<HTMLSpanElement>(null);
  const edge = useRef<HTMLDivElement>(null);
  const scene = useRef<DioramaScene | null>(null);
  const state = useRef({ observation, status, zoom, onZoom, onUnavailable });
  state.current = { observation, status, zoom, onZoom, onUnavailable };
  const [ready, setReady] = useState(false);

  useEffect(() => {
    scene.current?.setZoom(zoom);
  }, [zoom]);

  const turned = useRef(turn);
  useEffect(() => {
    const quarter = Math.PI / 4;
    scene.current?.orbit((turn - turned.current) * quarter, 0, true);
    turned.current = turn;
  }, [turn]);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    let made: DioramaScene;
    let quality = deviceQuality();
    try {
      made = new DioramaScene(el, QUALITY[quality]);
    } catch (e) {
      state.current.onUnavailable(e instanceof Error ? e.message : String(e));
      return;
    }
    const s = made;
    scene.current = s;
    s.setZoom(state.current.zoom);
    let adaptive = new AdaptiveResolution(s.quality, window.devicePixelRatio || 1);
    const resize = () => s.resize(el.clientWidth, el.clientHeight, adaptive.dpr);
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    resize();

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0,
      stopped = false,
      prepared = false,
      shown = false,
      drewLast = false,
      lastRaf = performance.now(),
      slow = 0,
      lastStepDown = -Infinity,
      seenTick: number | null | undefined;
    // A shader the browser will not compile ahead of time is compiled with the first picture instead.
    const begin = () => {
      prepared = true;
    };
    const preparing = s.prepare().catch(() => undefined);
    void preparing.then(begin);
    const impatient = setTimeout(begin, 8000);

    const draw = (now: number) => {
      if (stopped) return;
      frame = requestAnimationFrame(draw);
      if (!prepared) return;
      const { observation: o, status } = state.current;
      const tick = o ? o.tick : null;
      if (tick !== seenTick) {
        seenTick = tick;
        s.observe(o, now);
      }
      const elapsed = now - lastRaf;
      lastRaf = now;
      const view = s.render(samples.current ?? [], now, reduced.matches);
      // A frame's cost shows as the time to the next display frame after a drawn one.
      if (drewLast) {
        if (adaptive.sample(elapsed)) resize();
        const q = s.quality;
        slow =
          adaptive.dpr <= q.minDpr + 0.01 && elapsed > q.budgetMs * 1.8 && elapsed < 250
            ? slow + 1
            : Math.max(0, slow - 1);
        const next = STEP_DOWN[quality];
        if (slow >= 45 && next && now - lastStepDown > 20_000) {
          slow = 0;
          lastStepDown = now;
          quality = next;
          s.setQuality(QUALITY[next]);
          adaptive = new AdaptiveResolution(s.quality, window.devicePixelRatio || 1);
          resize();
        }
      }
      drewLast = view.drawn;
      if (!view.drawn) return;
      if (!shown) {
        shown = true;
        setReady(true);
      }

      const live = status === "live";
      if (mark.current) {
        const f = view.fly;
        const show =
          f !== null &&
          f.inFrame &&
          (f.length < MARK_BELOW_PX || !live || !view.flyReady || view.flyHidden);
        mark.current.hidden = !show;
        if (show && f) {
          const size = Math.max(30, f.length * 1.5);
          mark.current.style.transform = `translate(${f.x}px, ${f.y}px)`;
          mark.current.style.setProperty("--ring", `${size}px`);
          mark.current.dataset.live = live ? "1" : "0";
        }
      }
      if (north.current) north.current.style.transform = `rotate(${view.northDeg}deg)`;
      const wind = o?.weather;
      if (windArrow.current && wind)
        // The way it blows: from its bearing, turned with the picture.
        windArrow.current.style.transform = `rotate(${view.northDeg + wind.fromDeg + 180}deg)`;
      if (bar.current && barLabel.current) {
        const metres = [1, 2, 5, 10, 20, 50, 100, 200, 500].find(
          (m) => m * view.pxPerM >= 44,
        );
        bar.current.hidden = metres === undefined;
        if (metres !== undefined) {
          bar.current.style.width = `${metres * view.pxPerM}px`;
          barLabel.current.textContent = `${metres} m at the fly`;
        }
      }
      if (edge.current) {
        // Not over the page's own readouts, and not over the fly's mark.
        const e = view.edge,
          f = view.fly;
        const clear =
          e !== null &&
          e.y > 96 &&
          e.y < el.clientHeight - 48 &&
          !(f && Math.hypot(e.x - f.x, e.y - f.y) < 130);
        edge.current.hidden = !clear;
        if (clear && view.edge)
          edge.current.style.transform = `translate(${view.edge.x}px, ${view.edge.y}px)`;
      }
    };
    frame = requestAnimationFrame(draw);

    // Turning the model by hand: a mouse or pen drag. Touch is left to the page's scrolling and the buttons.
    let drag: { id: number; x: number; y: number } | null = null;
    const down = (e: PointerEvent) => {
      if (e.pointerType === "touch" || e.button !== 0) return;
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
      el.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      s.orbit(-(e.clientX - drag.x) * 0.006, (e.clientY - drag.y) * 0.004);
      drag = { id: drag.id, x: e.clientX, y: e.clientY };
    };
    const up = (e: PointerEvent) => {
      if (drag?.id === e.pointerId) drag = null;
    };
    // The wheel zooms only where the page itself does not scroll (the wide layout).
    const wide = window.matchMedia("(min-width: 1024px)");
    const wheel = (e: WheelEvent) => {
      if (!wide.matches || e.ctrlKey) return;
      e.preventDefault();
      state.current.onZoom(
        clampZoom(state.current.zoom * Math.exp(-Math.sign(e.deltaY) * 0.18)),
      );
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("wheel", wheel, { passive: false });

    return () => {
      stopped = true;
      clearTimeout(impatient);
      cancelAnimationFrame(frame);
      observer.disconnect();
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      el.removeEventListener("wheel", wheel);
      scene.current = null;
      // Three checks on the shaders it is compiling: the model is put away once it has finished.
      void preparing.then(() => s.dispose());
    };
  }, [samples]);

  const wind = observation?.weather;
  return (
    <div className="diorama absolute inset-0 overflow-hidden bg-[#1b1a17]">
      <canvas
        ref={canvas}
        className={`h-full w-full cursor-grab transition-opacity duration-700 active:cursor-grabbing ${ready ? "opacity-100" : "opacity-0"}`}
        role="img"
        aria-label="A clay model of Bethesda on a workbench, photographed in stop motion: the city's buildings, streets, parks and trees, the slab's edge where the model of the city ends, the fly as an enlarged clay puppet, its recent path as a line of beads, and the people and vehicles near it as plain figures"
      />
      {!ready ? (
        <p className="text-muted-foreground absolute inset-0 grid place-items-center font-mono text-[10px] tracking-[0.3em] uppercase">
          Setting up the model
        </p>
      ) : null}
      <div ref={mark} hidden className="diorama-mark" aria-hidden="true">
        <span className="diorama-ring" />
        <span className="diorama-tag">the fly</span>
      </div>
      <div ref={edge} hidden className="diorama-edge" aria-hidden="true">
        the model of the city ends here
      </div>
      <div className="pointer-events-none absolute top-12 right-3 flex flex-col items-end gap-1 font-mono text-[10px] text-[rgba(240,234,220,0.92)] [text-shadow:0_1px_2px_rgba(0,0,0,0.7)]">
        <div className="flex items-center gap-1.5">
          <span>N</span>
          <div ref={north} className="diorama-needle" aria-hidden="true" />
        </div>
        {wind ? (
          <div className="flex items-center gap-1.5">
            <span>
              wind {wind.speedMS.toFixed(1)} m/s{wind.gusting ? ", gust" : ""}
            </span>
            <div
              ref={windArrow}
              className="diorama-needle diorama-wind"
              aria-hidden="true"
            />
          </div>
        ) : null}
      </div>
      <div className="pointer-events-none absolute bottom-3 left-3 font-mono text-[10px] text-[rgba(240,234,220,0.92)] [text-shadow:0_1px_2px_rgba(0,0,0,0.7)]">
        <span ref={barLabel} />
        <div ref={bar} hidden className="mt-1 h-0.5 bg-[rgba(240,234,220,0.9)] shadow" />
      </div>
    </div>
  );
}
