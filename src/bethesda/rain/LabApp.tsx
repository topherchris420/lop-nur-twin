/**
 * The R.A.I.N. Lab, loaded only when its door is opened.
 *
 * One store lives as long as the Bethesda visit (the city holds it in a ref),
 * so records, a meeting and an experiment in progress survive stepping back
 * outside. Inside, the city's rendering is unmounted — its simulation keeps
 * its own fixed-rate timer — and the lab's interior and panels take over.
 */
import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import type { CitySimulation } from "../simulation";
import { LabScene, type LabNav } from "./LabScene";
import { RoomPanel, button, panel } from "./LabPanels";
import { LabStore } from "./store";
import { ROOMS, ROOM_IDS, SPAWN, type RoomId } from "./labLayout";

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
    teleport: null,
    atExit: false,
    failed: false,
  }).current;
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
      <header className={"absolute top-4 left-4 max-w-[60vw] " + panel}>
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
      <nav aria-label="Leave the lab" className="absolute top-4 right-4">
        <button className={panel + " text-xs"} onClick={onExit}>
          Return to Bethesda
        </button>
      </nav>
      <section
        aria-label="Rooms"
        className={
          "absolute bottom-4 left-4 w-[min(340px,calc(100vw-32px))] max-sm:bottom-[calc(55vh+12px)] " +
          panel
        }
      >
        <p role="status" aria-live="polite" className="text-xs text-teal-100">
          {store.hint}
        </p>
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
          WASD or arrows to walk · Shift to hurry · drag to look · double-click for mouse
          lock · Escape releases
        </p>
      </section>
      {atExit ? (
        <p
          role="status"
          className={"absolute bottom-40 left-1/2 -translate-x-1/2 text-xs " + panel}
        >
          The door back to Bethesda. Press E to open it.
        </p>
      ) : null}
      <aside
        aria-label={`${ROOMS[store.room].label} panel`}
        className={
          "absolute top-24 right-4 bottom-4 w-[min(520px,calc(100vw-32px))] overflow-auto max-sm:top-auto max-sm:h-[55vh] " +
          panel
        }
      >
        <RoomPanel store={store} room={store.room} go={go} onExit={onExit} />
      </aside>
    </div>
  );
}
