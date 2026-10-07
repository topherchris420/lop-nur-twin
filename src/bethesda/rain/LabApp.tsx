/**
 * The R.A.I.N. Lab, loaded only when its door is opened.
 *
 * One store lives as long as the Bethesda visit (the city holds it in a ref),
 * so records, a meeting and an experiment in progress survive stepping back
 * outside. Inside, the city's rendering is unmounted — its simulation keeps
 * its own fixed-rate timer — and the lab's interior and panels take over.
 */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from "react";
import type { CitySimulation } from "../simulation";
import { isCoarsePointer } from "../../lib/touchInput";
import { TouchStick } from "../TouchStick";
import { canRender } from "../webgl";
import { LabScene, type LabNav } from "./LabScene";
import { RoomPanel, button, panel } from "./LabPanels";
import { LabStore } from "./store";
import { RESONANCE, ROOMS, ROOM_IDS, SPAWN, type RoomId } from "./labLayout";
import type { ResonanceQuality } from "./ResonanceFace";
import { resonanceView, snapshotOf } from "./resonance";

/**
 * A small screen, either way up. The class names below spell the same query
 * out for Tailwind, which only sees whole literals; keep the two in step.
 */
const SMALL_SCREEN = "(max-width: 639px), (max-height: 500px)";

export default function LabApp({
  sim,
  holder,
  onExit,
  visuals = "auto",
}: {
  sim: CitySimulation;
  holder: RefObject<unknown>;
  onExit: () => void;
  /** The city's Visuals setting, which R.A.I.N.'s instrument follows. */
  visuals?: "auto" | "detail" | "economy";
}) {
  const [store] = useState(() => {
    const existing = holder.current;
    if (existing instanceof LabStore) {
      existing.attach(sim);
      return existing;
    }
    const created = new LabStore(sim);
    (holder as { current: unknown }).current = created;
    return created;
  });
  useSyncExternalStore(store.subscribe, store.getVersion);
  const nav = useRef<LabNav>({
    pos: { ...SPAWN },
    yaw: 0,
    pitch: 0,
    keys: new Set(),
    stick: { x: 0, y: 0 },
    viewCenter: null,
    teleport: null,
    atExit: false,
    failed: false,
  }).current;
  // Dev-only handle for look-development captures of the figures, like
  // `window.__bethesda`. Stripped from production builds; nothing reads it.
  if (import.meta.env.DEV) Object.assign(window, { __rainLab: { store, nav } });
  // A touch screen walks the interior with a thumb-stick. On a small screen the
  // rooms shrink to a strip and the room's panel takes the lower part, leaving
  // a band of the room above it for the stick and a look: the panel never has
  // to be put away to walk.
  const coarse = useMemo(isCoarsePointer, []);
  // R.A.I.N.'s instrument follows the city's Visuals: economy draws it flat
  // and plain, detail in full; auto starts lower on a phone and steps down by
  // itself when frames stay slow.
  const quality: ResonanceQuality =
    visuals === "economy" ? "low" : visuals === "detail" || !coarse ? "high" : "medium";
  // A click on the instrument opens the Research Panel at what the plate shows.
  const [inspected, setInspected] = useState(0);
  const inspectHandled = useRef(0);
  const rendering = useMemo(canRender, []);
  const touchWalk = coarse && rendering && !nav.failed;
  const root = useRef<HTMLDivElement>(null),
    header = useRef<HTMLElement>(null),
    aside = useRef<HTMLElement>(null),
    rooms = useRef<HTMLElement>(null),
    strip = useRef<HTMLDivElement>(null);
  // Tell the camera where that band is — on a wide screen, the gap between the
  // rooms and the panel — so the room ahead shows in it rather than behind the
  // panel (`LabNav.viewCenter`).
  useEffect(() => {
    const small = window.matchMedia(SMALL_SCREEN);
    const measure = () => {
      const r = root.current?.getBoundingClientRect(),
        h = header.current?.getBoundingClientRect(),
        a = aside.current?.getBoundingClientRect(),
        g = rooms.current?.getBoundingClientRect();
      if (!r || !h || !a || !g || a.width === 0 || a.height === 0) nav.viewCenter = null;
      else if (!small.matches)
        // A wide screen: the room shows between the rooms at the lower left
        // and the panel down the right, at the canvas's own height.
        nav.viewCenter = { x: (g.right + a.left) / 2 - r.left, y: r.height / 2 };
      else
        nav.viewCenter = {
          // The panel along the bottom (a phone held upright) leaves the full
          // width; down the right (on its side), what is left of it.
          x: a.top - r.top > r.height / 2 ? r.width / 2 : (a.left - r.left) / 2,
          // Either way the room shows between the title and the rooms strip.
          y: (h.bottom + g.top) / 2 - r.top,
        };
    };
    measure();
    const observer = new ResizeObserver(measure);
    for (const el of [root.current, header.current, aside.current, rooms.current])
      if (el) observer.observe(el);
    small.addEventListener("change", measure);
    return () => {
      observer.disconnect();
      small.removeEventListener("change", measure);
      nav.viewCenter = null;
    };
  }, [nav]);
  // Keep the current room's button in view in the strip, wherever walking led.
  useEffect(() => {
    const s = strip.current,
      b = s?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!s || !b || s.scrollWidth <= s.clientWidth) return;
    const sr = s.getBoundingClientRect(),
      br = b.getBoundingClientRect();
    if (br.left < sr.left) s.scrollLeft -= sr.left - br.left + 8;
    else if (br.right > sr.right) s.scrollLeft += br.right - sr.right + 8;
  }, [store.room]);
  const [atExit, setAtExit] = useState(false);
  const [tick, setTick] = useState(sim.tick);
  const go = (room: RoomId) => {
    nav.teleport = { ...ROOMS[room].spawn };
    nav.yaw = room === "threshold" ? 0 : nav.yaw;
    if (room === "panel") nav.pitch = RESONANCE.look;
    store.enterRoom(room);
  };
  useEffect(() => {
    const previous = document.title;
    document.title = "R.A.I.N. Lab — Bethesda anomaly";
    void store.checkRuntime();
    store.enterRoom("threshold");
    const timer = setInterval(() => {
      setAtExit(nav.atExit);
      setTick(sim.tick);
    }, 250);
    return () => {
      clearInterval(timer);
      document.title = previous;
    };
  }, [store, nav, sim]);
  useEffect(() => {
    const typing = (t: EventTarget | null) =>
      (t as HTMLElement | null)?.matches?.("input,textarea,select,[contenteditable]") ??
      false;
    const down = (e: KeyboardEvent) => {
      if (typing(e.target)) return;
      if (
        [
          "KeyW",
          "KeyA",
          "KeyS",
          "KeyD",
          "ShiftLeft",
          "ArrowUp",
          "ArrowDown",
          "ArrowLeft",
          "ArrowRight",
        ].includes(e.code)
      ) {
        e.preventDefault();
        nav.keys.add(e.code);
      }
      if (e.code === "KeyE" && nav.atExit) onExit();
    };
    const up = (e: KeyboardEvent) => nav.keys.delete(e.code);
    const blur = () => nav.keys.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
      nav.keys.clear();
    };
  }, [nav, onExit]);
  const mode = store.mode();
  return (
    <div
      ref={root}
      data-rain-lab="active"
      data-lab-room={store.room}
      data-resonance={resonanceView(snapshotOf(store)).state}
      className="relative h-full w-full overflow-hidden bg-[#071012] text-slate-100"
    >
      <LabScene
        store={store}
        nav={nav}
        quality={quality}
        auto={visuals === "auto"}
        onInspect={() => {
          if (store.room !== "panel") go("panel");
          setInspected((n) => n + 1);
        }}
      />
      <nav aria-label="Leave the lab" className="absolute top-4 right-4">
        <button className={panel + " text-xs"} onClick={onExit}>
          Return to Bethesda
        </button>
      </nav>
      {/*
        A phone held upright (narrow and tall) is one column: the title, a band
        of the room with the stick at its foot, the rooms as a strip, and the
        room's panel, which gives way first when space runs short. Any other
        shape — a phone on its side, however narrow, a tablet, a desktop —
        keeps the panel on the right and the stick and the rooms at the left.
        The column lets drags through to the room; the panels in it take them.
      */}
      <div className="pointer-events-none [@media(max-width:639px)_and_(min-height:501px)]:absolute [@media(max-width:639px)_and_(min-height:501px)]:inset-4 [@media(max-width:639px)_and_(min-height:501px)]:flex [@media(max-width:639px)_and_(min-height:501px)]:flex-col [@media(max-width:639px)_and_(min-height:501px)]:gap-2 [@media(min-width:640px),(max-height:500px)]:contents">
        <header
          ref={header}
          className={
            "pointer-events-auto max-w-[60vw] shrink-0 [@media(max-width:639px)_and_(min-height:501px)]:max-w-[calc(100vw-11rem)] [@media(max-width:639px),(max-height:500px)]:p-2 [@media(min-width:640px),(max-height:500px)]:absolute [@media(min-width:640px),(max-height:500px)]:top-4 [@media(min-width:640px),(max-height:500px)]:left-4 " +
            panel
          }
        >
          <p className="font-mono text-[9px] tracking-[.24em] text-teal-200">
            R.A.I.N. LAB
          </p>
          <h1 className="mt-1 text-lg tracking-wide [@media(max-width:639px),(max-height:500px)]:mt-0.5 [@media(max-width:639px),(max-height:500px)]:text-base">
            {ROOMS[store.room].label}
          </h1>
          <p className="mt-1 flex flex-wrap gap-2 font-mono text-[10px]">
            <span
              className={
                "rounded px-1.5 py-0.5 tracking-widest " +
                (mode === "LIVE"
                  ? "bg-[#0B5D63]"
                  : "border border-amber-200/50 text-amber-100")
              }
            >
              RUNTIME {mode}
            </span>
            {store.meeting?.source === "DEMO" ? (
              <span className="rounded border border-teal-100/40 px-1.5 py-0.5 tracking-widest">
                DEMO · PRERECORDED
              </span>
            ) : null}
            {store.run ? (
              <span className="rounded border border-teal-100/40 px-1.5 py-0.5 tracking-widest">
                EXPERIMENT RUNNING
              </span>
            ) : null}
          </p>
          <p className="mt-1 text-[10px] text-slate-300">
            Bethesda tick {tick}
            {sim.paused ? " (paused)" : ""} · a fictional interior inside the simulation
          </p>
        </header>
        {atExit ? (
          // In the open room, never on the stick or a panel: on a phone in the
          // band above the stick, elsewhere under the title (beside the stick
          // on a phone held sideways).
          <div
            role="status"
            className={
              "pointer-events-auto z-10 text-center text-xs [@media(max-width:639px)_and_(min-height:501px)]:mt-auto [@media(max-width:639px)_and_(min-height:501px)]:self-center [@media(min-width:640px),(max-height:500px)]:absolute [@media(min-width:640px),(max-height:500px)]:top-36 [@media(min-width:640px)_and_(min-height:501px)]:left-4 [@media(max-height:500px)]:left-36 " +
              panel
            }
          >
            <p>The door back to Bethesda.</p>
            <button className={button + " mt-2"} onClick={onExit}>
              {coarse ? "Open it" : "Open it (E)"}
            </button>
          </div>
        ) : null}
        <div className="flex shrink-0 flex-col items-start gap-2 [@media(max-width:639px)_and_(min-height:501px)]:mt-auto [@media(min-width:640px),(max-height:500px)]:absolute [@media(min-width:640px),(max-height:500px)]:bottom-4 [@media(min-width:640px),(max-height:500px)]:left-4">
          {touchWalk ? <TouchStick stick={nav.stick} /> : null}
          <section
            ref={rooms}
            aria-label="Rooms"
            className={
              "pointer-events-auto w-[min(340px,calc(100vw-32px))] [@media(max-width:639px)_and_(min-height:501px)]:w-full [@media(max-width:639px),(max-height:500px)]:p-2 " +
              panel
            }
          >
            <p
              role="status"
              aria-live="polite"
              className="text-xs text-teal-100 [@media(max-width:639px),(max-height:500px)]:sr-only"
            >
              {store.hint}
            </p>
            {/* On a small screen, one line that scrolls sideways. */}
            <div
              ref={strip}
              className="mt-2 flex flex-wrap gap-1 [@media(max-width:639px),(max-height:500px)]:mt-0 [@media(max-width:639px),(max-height:500px)]:flex-nowrap [@media(max-width:639px),(max-height:500px)]:overflow-x-auto"
            >
              {ROOM_IDS.map((id) => (
                <button
                  key={id}
                  className={button + " shrink-0"}
                  aria-pressed={store.room === id}
                  onClick={() => go(id)}
                >
                  {ROOMS[id].label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-[10px] text-slate-300 [@media(max-width:639px),(max-height:500px)]:hidden">
              {touchWalk
                ? "The stick walks · push it to the edge to hurry · drag the room to look"
                : "WASD or arrows to walk · Shift to hurry · drag to look · double-click for mouse lock · Escape releases"}
            </p>
          </section>
        </div>
        <aside
          ref={aside}
          id="lab-room-panel"
          aria-label={`${ROOMS[store.room].label} panel`}
          className={
            // With a view to keep, a phone's panel takes at most 45% of the
            // height, and less on a short phone, so about 200 px of the room
            // always stays open above it.
            "pointer-events-auto min-h-0 overflow-auto [@media(max-width:639px)_and_(min-height:501px)]:shrink [@media(min-width:640px),(max-height:500px)]:absolute [@media(min-width:640px),(max-height:500px)]:top-24 [@media(min-width:640px),(max-height:500px)]:right-4 [@media(min-width:640px),(max-height:500px)]:bottom-4 [@media(min-width:640px),(max-height:500px)]:w-[min(520px,calc(100vw-340px-3rem))] " +
            (rendering
              ? "[@media(max-width:639px)_and_(min-height:501px)]:max-h-[min(45dvh,calc(100dvh-26rem))] "
              : "") +
            panel
          }
        >
          <RoomPanel
            store={store}
            room={store.room}
            go={go}
            onExit={onExit}
            inspect={{ count: inspected, handled: inspectHandled }}
          />
        </aside>
      </div>
    </div>
  );
}
