import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import { CityScene, type ViewControl } from "./Scene";
import { CitySimulation, PROFILES, type Trace } from "./simulation";
import { CityDecisionBroker } from "./jev";
import { parseScenario } from "./scenarios";
import {
  buildings,
  bounds,
  geographic,
  landmarks,
  roadWays,
  row,
  SOURCE,
  type Point,
} from "./model";
import snapshot from "./data/osm.json" with { type: "json" };
import { safeExternalHref, EXTERNAL_LINK_PROPS } from "../lib/safeUrl";
function save(name: string, value: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function world(sim?: CitySimulation) {
  const low = (navigator.hardwareConcurrency || 2) <= 4;
  const city = sim ?? new CitySimulation(PROFILES[low ? 0 : 1]);
  const view: ViewControl = {
    mode: "orbit",
    target: { ...row.point },
    relocate: true,
    yaw: 0,
    pitch: 0,
    keys: new Set(),
    tier: low ? 0 : 1,
    fps: 0,
    ready: false,
    failed: false,
  };
  return { sim: city, broker: new CityDecisionBroker(city), view };
}
class RenderBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <p role="status" className="absolute top-44 left-5 max-w-sm text-sm text-teal-100">
        3D rendering is unavailable. The map, rules, scenarios, field notes and replay
        remain available.
      </p>
    ) : (
      this.props.children
    );
  }
}
function MiniMap({ sim, view }: { sim: CitySimulation; view: ViewControl }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current,
      c = canvas?.getContext("2d");
    if (!c) return;
    const scale =
      178 / Math.max(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z);
    const p = (q: Point): [number, number] => [
      8 + (q.x - bounds.min.x) * scale,
      8 + (q.z - bounds.min.z) * scale,
    ];
    const draw = () => {
      c.fillStyle = "#13282c";
      c.fillRect(0, 0, 196, 196);
      c.fillStyle = "#486267";
      for (const b of buildings) {
        c.beginPath();
        b.ring.forEach((v, i) => (i === 0 ? c.moveTo(...p(v)) : c.lineTo(...p(v))));
        c.fill();
      }
      c.strokeStyle = "#9fa89d";
      c.lineWidth = 0.8;
      for (const r of roadWays) {
        c.beginPath();
        r.points.forEach((v, i) => (i === 0 ? c.moveTo(...p(v)) : c.lineTo(...p(v))));
        c.stroke();
      }
      for (const a of sim.agents) {
        if (a.inside) continue;
        c.fillStyle =
          a.kind === "emergency"
            ? "#f1b86d"
            : a.kind === "pedestrian"
              ? "#9ab69b"
              : "#d4c8a4";
        c.fillRect(...p(a.point), 1.5, 1.5);
      }
      for (const e of sim.events) {
        c.strokeStyle = e.kind === "fire" ? "#e7a56c" : "#9bcacc";
        c.beginPath();
        c.arc(...p(e.point), e.radius * scale, 0, Math.PI * 2);
        c.stroke();
      }
      c.fillStyle = "#e8f1df";
      c.beginPath();
      c.arc(...p(view.target), 3, 0, Math.PI * 2);
      c.fill();
      c.font = "10px monospace";
      c.fillText("N ↑", 8, 12);
    };
    draw();
    const timer = setInterval(draw, 800);
    return () => clearInterval(timer);
  }, [sim, view]);
  return (
    <canvas
      ref={ref}
      width={196}
      height={196}
      className="h-28 w-28 sm:h-44 sm:w-44"
      aria-label="Bethesda map with real footprints and simulated agents"
    />
  );
}
const panel =
  "rounded border border-teal-100/20 bg-[#10272e]/95 p-3 text-slate-100 shadow-xl";
const button =
  "rounded border border-teal-100/25 px-3 py-2 text-xs hover:bg-teal-100/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-200";
function Notes() {
  return (
    <div className="max-h-[65vh] max-w-2xl overflow-auto text-sm leading-relaxed">
      <p className="mb-4">
        An ordinary counterpoint to the desert. This is a geographically anchored,
        illustrative city experiment. It is not a surveyed, photorealistic twin.
      </p>
      <table className="w-full text-left">
        <caption className="mb-3 text-left font-mono text-teal-100">
          GEOGRAPHY / EVIDENCE
        </caption>
        <tbody>
          <tr>
            <th className="p-2 align-top">Real data</th>
            <td className="p-2">
              {SOURCE.counts.building} OSM building footprints, {SOURCE.counts.road} road
              fragments, {SOURCE.counts.path} walking/cycling ways, {SOURCE.counts.park}{" "}
              green spaces, 2 Metro entrances, signals and crossing points. Metres, north
              up; WGS84 source coordinates.
            </td>
          </tr>
          <tr>
            <th className="p-2 align-top">Approximate</th>
            <td className="p-2">
              Flat ground; most heights inferred. Community height tags exist for{" "}
              {buildings.filter((b) => b.heightEvidence === "height tag").length}{" "}
              footprints. Level tags use an assumed 3.3 metres per floor. No DEM, LiDAR,
              courtyard reconstruction or interiors.
            </td>
          </tr>
          <tr>
            <th className="p-2 align-top">Procedural</th>
            <td className="p-2">
              Façades, roofs, trees, signs, furniture, cars and people. Signals, routes,
              crowds and emergency response are illustrative behavior, not measured
              Bethesda traffic.
            </td>
          </tr>
          <tr>
            <th className="p-2 align-top">Decisions</th>
            <td className="p-2">
              Humans and Jev choose permitted actions. Deterministic rules validate and
              execute them. The free walking camera is separate from the pedestrian seat.
            </td>
          </tr>
          <tr>
            <th className="p-2 align-top">Source</th>
            <td className="p-2">
              Retrieved {SOURCE.acquiredAt.slice(0, 10)} from OpenStreetMap. This date is
              retrieval, not a survey date. © OpenStreetMap contributors · ODbL 1.0. The
              derivative database is downloadable below.
            </td>
          </tr>
        </tbody>
      </table>
      <p className="mt-4">
        Recognizable street relationships are the strongest feature. Repeated windows,
        simple actors and missing terrain remain visibly artificial. A public reference
        photograph of Woodmont / Bethesda Avenue was inspected qualitatively; it is not a
        shipped texture or an achieved render.
      </p>
      <div className="mt-4 flex flex-wrap gap-4">
        <button
          type="button"
          className="underline"
          onClick={() => save("bethesda-osm-derivative.geojson", snapshot)}
        >
          Download geographic database
        </button>
        <a
          href={safeExternalHref("https://www.openstreetmap.org/copyright")}
          {...EXTERNAL_LINK_PROPS}
          className="underline"
        >
          OSM attribution / ODbL
        </a>
        <a
          href={safeExternalHref(
            "https://commons.wikimedia.org/wiki/File:Bethesda_downtown_intersection_2025-03-30_11-38-17.jpg",
          )}
          {...EXTERNAL_LINK_PROPS}
          className="underline"
        >
          Reference photograph (CC BY 4.0)
        </a>
      </div>
    </div>
  );
}
export default function Bethesda({ onReturn }: { onReturn: () => void }) {
  const [w, setWorld] = useState(() => world()),
    [version, refresh] = useState(0),
    [notes, setNotes] = useState(false),
    [command, setCommand] = useState(false),
    [text, setText] = useState(""),
    [message, setMessage] = useState(
      "The telemetry has resolved into somewhere ordinary.",
    ),
    [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const { sim, broker, view } = w;
  useEffect(() => {
    const previous = document.title;
    document.title = "Bethesda anomaly — Lop Nur Twin";
    broker.start();
    const heartbeat = setInterval(() => refresh((n) => n + 1), 1000);
    const timer = setInterval(() => {
      if (sim.paused) return;
      if (view.mode === "walk") {
        let x = 0,
          z = 0;
        const k = view.keys,
          speed = k.has("ShiftLeft") ? 0.65 : 0.32;
        if (k.has("KeyW")) z--;
        if (k.has("KeyS")) z++;
        if (k.has("KeyA")) x--;
        if (k.has("KeyD")) x++;
        const norm = Math.hypot(x, z);
        if (norm)
          sim.movePlayer(
            ((x * Math.cos(view.yaw) + z * Math.sin(view.yaw)) * speed) / norm,
            ((-x * Math.sin(view.yaw) + z * Math.cos(view.yaw)) * speed) / norm,
          );
      }
      sim.step();
    }, 100);
    const provider = setInterval(() => void broker.poll(), 2500);
    return () => {
      clearInterval(heartbeat);
      clearInterval(timer);
      clearInterval(provider);
      broker.dispose();
      document.title = previous;
    };
  }, [sim, broker, view]);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (
        (e.target as HTMLElement | null)?.matches(
          "input,textarea,select,[contenteditable]",
        )
      )
        return;
      if (e.code === "Backquote") {
        e.preventDefault();
        setCommand((v) => !v);
      }
      if (["KeyW", "KeyA", "KeyS", "KeyD", "ShiftLeft"].includes(e.code)) {
        if (view.mode !== "orbit") e.preventDefault();
        view.keys.add(e.code);
      }
    };
    const up = (e: KeyboardEvent) => view.keys.delete(e.code);
    const blur = () => view.keys.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [view]);
  useEffect(() => {
    if (command) input.current?.focus();
  }, [command]);
  const render = () => refresh((n) => n + 1),
    geo = geographic(view.target);
  const replay = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 32 * 1024 * 1024) {
      setMessage("Replay exceeds 32 MB.");
      return;
    }
    setBusy(true);
    sim.paused = true;
    try {
      const restored = await CitySimulation.replayAsync(
        JSON.parse(await file.text()) as Trace,
      );
      restored.paused = true;
      setWorld(world(restored));
      setMessage("Replay verified: checkpoints, decisions and final state match.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Invalid replay");
    } finally {
      setBusy(false);
    }
  };
  return (
    <main
      data-bethesda="active"
      data-status-refresh={version}
      className="relative h-full w-full overflow-hidden bg-[#111f22] text-slate-100"
    >
      <RenderBoundary>
        <CityScene sim={sim} view={view} />
      </RenderBoundary>
      <header className={"absolute top-4 left-4 max-w-[68vw] " + panel}>
        <p className="font-mono text-[9px] tracking-[.24em] text-teal-200">
          ANOMALOUS LOCATION RESOLUTION
        </p>
        <h1 className="mt-1 text-xl tracking-wide">Bethesda, Maryland</h1>
        <p className="mt-1 font-mono text-[10px]">
          {geo.lat.toFixed(5)}° N · {Math.abs(geo.lon).toFixed(5)}° W
        </p>
        <p className="mt-2 text-[11px] text-slate-300">
          Real map · inferred elevations · illustrative behavior
        </p>
      </header>
      <nav
        aria-label="Environment"
        className="absolute top-4 right-4 flex flex-col gap-2 sm:flex-row"
      >
        <button className={panel + " text-xs"} onClick={() => setNotes(!notes)}>
          {notes ? "Close field notes" : "Field notes"}
        </button>
        <button className={panel + " text-xs"} onClick={onReturn}>
          Return to the desert
        </button>
      </nav>
      <aside className={"absolute bottom-4 left-4 " + panel}>
        <MiniMap sim={sim} view={view} />
        <a
          href={safeExternalHref("https://www.openstreetmap.org/copyright")}
          {...EXTERNAL_LINK_PROPS}
          className="mt-2 block text-[10px] text-teal-100 underline"
        >
          © OpenStreetMap contributors · ODbL
        </a>
      </aside>
      <section
        aria-label="City controls"
        className={
          "absolute right-4 bottom-4 max-h-[47vh] w-[min(610px,calc(100vw-32px))] overflow-auto sm:w-[min(610px,calc(100vw-250px))] " +
          panel
        }
      >
        <p role="status" className="mb-2 text-xs text-teal-100">
          {message}
        </p>
        <div className="flex flex-wrap gap-2">
          {(["orbit", "walk", "seat"] as const).map((mode, i) => (
            <button
              key={mode}
              className={button}
              aria-pressed={view.mode === mode}
              onClick={() => {
                view.mode = mode;
                view.relocate = mode === "orbit";
                view.keys.clear();
                render();
              }}
            >
              {["Survey", "Walk", "Pedestrian seat"][i]}
            </button>
          ))}
          <button
            className={button}
            onClick={() => {
              sim.paused = !sim.paused;
              render();
            }}
          >
            {sim.paused ? "Resume" : "Pause"}
          </button>
          <button
            className={button}
            aria-pressed={broker.enabled}
            onClick={() => {
              broker.enabled = !broker.enabled;
              render();
            }}
          >
            {broker.enabled ? "Jev on" : "Jev off"}
          </button>
        </div>
        {view.mode === "walk" ? (
          <p className="mt-2 text-xs text-slate-300">
            WASD · Shift to move faster · drag to look · double-click for mouse lock ·
            Escape releases
          </p>
        ) : null}
        {view.mode === "seat" ? (
          <div className="mt-2 flex flex-wrap gap-1" aria-label="Permitted human actions">
            {sim.observe(0).candidates.map((a) => (
              <button
                key={a}
                className={button}
                onClick={() => {
                  sim.humanAction(a);
                  setMessage("Human choice validated through the city action gate.");
                }}
              >
                {a.replaceAll("_", " ")}
              </button>
            ))}
          </div>
        ) : null}
        <div className="mt-2 flex flex-wrap gap-3">
          {landmarks.map((p) => (
            <button
              key={p.name}
              className="text-[11px] text-slate-300 underline"
              onClick={() => {
                view.target = { ...p.point };
                view.mode = "orbit";
                view.relocate = true;
                render();
              }}
            >
              {p.name}
            </button>
          ))}
        </div>
        <p className="mt-2 font-mono text-[10px] text-slate-300">
          {sim.config.pedestrians} individual pedestrians · {sim.config.vehicles} cars ·{" "}
          {sim.config.statisticalPopulation} statistical occupants
          <br />
          tick {sim.tick} · {view.fps} fps · render tier {view.tier} · {broker.status} ·
          accepted {broker.accepted} / fallback {broker.fallbacks}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-teal-100">
          <button
            className="underline"
            onClick={() => {
              try {
                save("bethesda-replay.json", sim.export());
                setMessage("Replay exported.");
              } catch (e) {
                setMessage(String(e));
              }
            }}
          >
            Export replay
          </button>
          <label className="cursor-pointer underline">
            {busy ? "Verifying…" : "Verify replay"}
            <input
              aria-label="Verify replay file"
              type="file"
              accept=".json,application/json"
              className="sr-only"
              disabled={busy}
              onChange={(e) => void replay(e.target.files?.[0])}
            />
          </label>
          <button
            className="underline"
            onClick={() => {
              setWorld(world());
              setMessage("New seeded experiment.");
            }}
          >
            Reset city
          </button>
          <button className="underline" onClick={() => setCommand(true)}>
            ~ telemetry
          </button>
        </div>
      </section>
      {notes ? (
        <section
          aria-label="Geographic field notes"
          className={"absolute top-32 left-4 z-20 max-w-[calc(100vw-32px)] " + panel}
        >
          <Notes />
          <button className={button + " mt-4"} onClick={() => setNotes(false)}>
            Close field notes
          </button>
        </section>
      ) : null}
      {command ? (
        <section
          aria-label="Scenario telemetry"
          className={
            "absolute top-1/3 left-1/2 z-30 w-[min(520px,calc(100vw-32px))] -translate-x-1/2 " +
            panel
          }
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const event = parseScenario(text);
              if (!event)
                setMessage(
                  "Unresolved event. Use one of the five supported event families and places.",
                );
              else if (!sim.inject(event)) setMessage("Event limit reached (8).");
              else {
                setMessage("Event injected: " + event.label);
                setText("");
              }
            }}
          >
            <label
              htmlFor="city-event"
              className="font-mono text-xs tracking-widest text-teal-100"
            >
              SCENARIO TELEMETRY
            </label>
            <input
              ref={input}
              id="city-event"
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={240}
              placeholder="Fire near Bethesda Row."
              className="mt-3 w-full rounded border border-teal-100/25 bg-transparent p-3 text-sm"
              onKeyDown={(e) => {
                if (e.key === "Escape") setCommand(false);
              }}
            />
            <p className="my-3 text-xs text-slate-300">
              Fire near Bethesda Row · downtown thunderstorm · Metro closure · Wisconsin
              Avenue parade · unidentified object above Bethesda
            </p>
            <div className="flex gap-2">
              <button className={button} type="submit">
                Inject event
              </button>
              <button className={button} type="button" onClick={() => setCommand(false)}>
                Close
              </button>
            </div>
          </form>
        </section>
      ) : null}
    </main>
  );
}
