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
import { ROOMS, ROOM_IDS, SPAWN, type RoomId } from "./labLayout";

/** A small screen, either way up: the room's panel and the stick take turns. */
const SMALL_HIDDEN = "[@media(max-width:639px),(max-height:500px)]:hidden";
const SMALL_SHOWN = "[@media(max-width:639px),(max-height:500px)]:inline-block";

export default function LabApp({
  sim,
  holder,
  onExit,
}: {
  sim: CitySimulation;
  holder: RefObject<unknown>;
  onExit: () => void;
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
    teleport: null,
    atExit: false,
    failed: false,
  }).current;
  // A touch screen walks the interior with a thumb-stick. On a phone the room's
  // panel fills the lower half, so the stick shows once the panel is hidden.
  const coarse = useMemo(isCoarsePointer, []);
  const rendering = useMemo(canRender, []);
  const touchWalk = coarse && rendering && !nav.failed;
  const [panelHidden, setPanelHidden] = useState(false);
  const [atExit, setAtExit] = useState(false);
  const [tick, setTick] = useState(sim.tick);
  const go = (room: RoomId) => {
    nav.teleport = { ...ROOMS[room].spawn };
    nav.yaw = room === "threshold" ? 0 : nav.yaw;
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
      data-rain-lab="active"
      data-lab-room={store.room}
      className="relative h-full w-full overflow-hidden bg-[#071012] text-slate-100"
    >
      <LabScene store={store} nav={nav} />
      <nav aria-label="Leave the lab" className="absolute top-4 right-4">
        <button className={panel + " text-xs"} onClick={onExit}>
          Return to Bethesda
        </button>
      </nav>
      {atExit ? (
        <div
          role="status"
          className={
            "absolute bottom-40 left-1/2 z-10 -translate-x-1/2 text-center text-xs " +
            panel
          }
        >
          <p>The door back to Bethesda.</p>
          <button className={button + " mt-2"} onClick={onExit}>
            {coarse ? "Open it" : "Open it (E)"}
          </button>
        </div>
      ) : null}
      {/*
        A phone is one column: the title, then the stick, the rooms and the
        room's panel, which gives way first when space runs short. On a small
        screen (a phone either way up) the panel and the stick take turns.
        Wider screens keep the rooms bottom-left and the panel on the right.
        The column lets drags through to the room; the panels in it take them.
      */}
      <div className="pointer-events-none max-sm:absolute max-sm:inset-4 max-sm:flex max-sm:flex-col max-sm:gap-2 sm:contents">
        <header
          className={
            "pointer-events-auto max-w-[60vw] shrink-0 max-sm:max-w-[calc(100vw-11rem)] sm:absolute sm:top-4 sm:left-4 " +
            panel
          }
        >
          <p className="font-mono text-[9px] tracking-[.24em] text-teal-200">
            R.A.I.N. LAB
          </p>
          <h1 className="mt-1 text-lg tracking-wide">{ROOMS[store.room].label}</h1>
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
        <div className="flex shrink-0 flex-col items-start gap-2 max-sm:mt-auto sm:absolute sm:bottom-4 sm:left-4 [@media(max-height:500px)]:flex-row [@media(max-height:500px)]:items-end">
          {touchWalk ? (
            <div className={panelHidden ? undefined : SMALL_HIDDEN}>
              <TouchStick stick={nav.stick} />
            </div>
          ) : null}
          <section
            aria-label="Rooms"
            className={
              // A phone held sideways is shorter than the rooms: they scroll
              // under the title rather than slide beneath it.
              "pointer-events-auto w-[min(340px,calc(100vw-32px))] [@media(max-height:500px)]:max-h-[calc(100dvh-10rem)] [@media(max-height:500px)]:overflow-y-auto " +
              panel
            }
          >
            <p role="status" aria-live="polite" className="text-xs text-teal-100">
              {store.hint}
            </p>
            {rendering ? (
              <button
                className={
                  "mt-1 hidden text-[11px] text-teal-100 underline " + SMALL_SHOWN
                }
                aria-expanded={!panelHidden}
                aria-controls="lab-room-panel"
                onClick={() => setPanelHidden(!panelHidden)}
              >
                {panelHidden ? "Show the room's panel" : "Hide the panel to walk"}
              </button>
            ) : null}
            <div className="mt-2 flex flex-wrap gap-1">
              {ROOM_IDS.map((id) => (
                <button
                  key={id}
                  className={button}
                  aria-pressed={store.room === id}
                  onClick={() => go(id)}
                >
                  {ROOMS[id].label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-[10px] text-slate-300">
              {touchWalk
                ? "The stick walks · push it to the edge to hurry · drag the room to look"
                : "WASD or arrows to walk · Shift to hurry · drag to look · double-click for mouse lock · Escape releases"}
            </p>
          </section>
        </div>
        <aside
          id="lab-room-panel"
          aria-label={`${ROOMS[store.room].label} panel`}
          className={
            "pointer-events-auto min-h-0 overflow-auto max-sm:shrink sm:absolute sm:top-24 sm:right-4 sm:bottom-4 sm:w-[min(520px,calc(100vw-340px-3rem))] " +
            (panelHidden ? SMALL_HIDDEN + " " : "") +
            panel
          }
        >
          <RoomPanel store={store} room={store.room} go={go} onExit={onExit} />
        </aside>
      </div>
    </div>
  );
}
