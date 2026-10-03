import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { CityScene, type ViewControl } from "./Scene";
import { CitySimulation, FOCUS_RADII, PROFILES, type Trace } from "./simulation";
import { CityDecisionBroker } from "./jev";
import { compileScenario, LABELS, type Compiled } from "./scenarios";
import {
  buildings,
  arrival,
  bounds,
  distance,
  geographic,
  landmarks,
  roadWays,
  SOURCE,
  type Point,
} from "./model";
import { roads } from "./network";
import snapshot from "./data/osm.json" with { type: "json" };
import terrainSnapshot from "./data/terrain.json" with { type: "json" };
import streetscapeSnapshot from "./data/streetscape.json" with { type: "json" };
import { TERRAIN_SOURCE } from "./terrain";
import {
  STREETSCAPE_SOURCE,
  busRoutes,
  monuments,
  storefronts,
  busStops,
  construction,
} from "./streetscape";
import {
  dossier,
  evidenceTally,
  EVIDENCE_CLASSIFICATION_META,
  EVIDENCE_TINT,
  type EvidenceClassification,
} from "./evidence";
import { safeExternalHref, EXTERNAL_LINK_PROPS } from "../lib/safeUrl";
import { LAB_DOOR, nearDoor, resolvesLab } from "./rain/site";
import type { LabStore } from "./rain/store";

/** The R.A.I.N. Lab loads only when its door is opened. */
const LabApp = lazy(() => import("./rain/LabApp"));
class LabBoundary extends Component<
  { children: ReactNode; onExit: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div
        role="status"
        className="absolute inset-0 grid place-items-center text-teal-100"
      >
        <div>
          <p>The door does not open. The city is unaffected.</p>
          <button className="mt-4 underline" onClick={this.props.onExit}>
            Return to Bethesda
          </button>
        </div>
      </div>
    ) : (
      this.props.children
    );
  }
}

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
/**
 * Population is chosen once, from reported hardware, and recorded in the
 * trace's config; the full-rate focus radius scales with it. Neither changes
 * mid-experiment except through recorded commands.
 */
function profileIndex() {
  const cores = navigator.hardwareConcurrency || 2;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
  return cores <= 4 ? 0 : cores >= 12 && memory >= 8 ? 2 : 1;
}
function world(sim?: CitySimulation) {
  const index = profileIndex();
  const city = sim ?? new CitySimulation(PROFILES[index]);
  if (!sim) city.setFocus(arrival, FOCUS_RADII[index]);
  const view: ViewControl = {
    mode: "walk",
    target: { ...arrival },
    relocate: true,
    yaw: -Math.PI / 2,
    pitch: 0,
    keys: new Set(),
    tier: index === 0 ? 0 : 1,
    quality: "auto",
    fps: 0,
    ready: false,
    failed: false,
    evidence: false,
    selected: null,
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
        for (const ring of [b.ring, ...b.holes]) {
          ring.forEach((v, i) => (i === 0 ? c.moveTo(...p(v)) : c.lineTo(...p(v))));
          c.closePath();
        }
        c.fill("evenodd");
      }
      c.strokeStyle = "#9fa89d";
      c.lineWidth = 0.8;
      for (const r of roadWays) {
        c.beginPath();
        r.points.forEach((v, i) => (i === 0 ? c.moveTo(...p(v)) : c.lineTo(...p(v))));
        c.stroke();
      }
      c.strokeStyle = "#e0694a";
      c.lineWidth = 2;
      for (const id of sim.closedRoads) {
        const e = roads.edges[id]!;
        c.beginPath();
        c.moveTo(...p(roads.nodes.get(e.from)!));
        c.lineTo(...p(roads.nodes.get(e.to)!));
        c.stroke();
      }
      for (const a of sim.agents) {
        if (a.inside) continue;
        c.fillStyle =
          a.kind === "emergency"
            ? "#f1b86d"
            : a.kind === "bus"
              ? "#8fc0e8"
              : a.kind === "pedestrian"
                ? "#9ab69b"
                : "#d4c8a4";
        const s = a.kind === "pedestrian" ? 1.5 : 2.4;
        c.fillRect(...p(a.point), s, s);
      }
      for (const e of sim.events) {
        c.strokeStyle = e.kind === "fire" ? "#e7a56c" : "#9bcacc";
        c.lineWidth = 1;
        c.beginPath();
        c.arc(...p(e.at), Math.min(90, e.radius * scale), 0, Math.PI * 2);
        c.stroke();
      }
      c.strokeStyle = "rgba(232,241,223,.25)";
      c.setLineDash([2, 3]);
      c.beginPath();
      c.arc(...p(sim.focus), sim.focusRadius * scale, 0, Math.PI * 2);
      c.stroke();
      c.setLineDash([]);
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
      aria-label="Bethesda map with real footprints, closures and simulated agents"
    />
  );
}
const panel =
  "rounded border border-teal-100/20 bg-[#10272e]/95 p-3 text-slate-100 shadow-xl";
const button =
  "rounded border border-teal-100/25 px-3 py-2 text-xs hover:bg-teal-100/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-200";
const CLASSES: EvidenceClassification[] = [
  "observed",
  "reported",
  "interpreted",
  "illustrative",
];
function Glyph({ c }: { c: EvidenceClassification }) {
  return (
    <span aria-hidden="true" style={{ color: EVIDENCE_TINT[c] }}>
      {EVIDENCE_CLASSIFICATION_META[c].glyph}
    </span>
  );
}
function Notes() {
  const tally = evidenceTally();
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
              fragments (lane tags set widths where mapped), {SOURCE.counts.path}{" "}
              walking/cycling ways, {SOURCE.counts.park} green spaces, 2 Metro entrances,
              signals and crossing points. A separate streetscape layer adds{" "}
              {storefronts.length} named storefronts, {monuments.length} monuments,
              artworks and fountains (including the Madonna of the Trail),{" "}
              {busStops.length} bus stops, {busRoutes.length} bus routes (Bethesda
              Circulator, Ride On, WMATA) and {construction.length} Purple Line
              construction ways. Montgomery Planning bare-earth LiDAR DTM: 4,225 samples
              over the same crop, roughly 20 × 22 metres apart.
            </td>
          </tr>
          <tr>
            <th className="p-2 align-top">Approximate</th>
            <td className="p-2">
              Most building heights inferred. Community height tags exist for{" "}
              {buildings.filter((b) => b.heightEvidence === "height tag").length}{" "}
              footprints; level tags use an assumed 3.3 metres per floor. Terrain is a
              coarse crop of real bare earth; it does not resolve curbs, steps or
              underpasses. Bus routes follow mapped route ways; gaps outside the box are
              bridged by shortest road paths. Sign placement on façades, blade-sign
              corners and the Metro canopy shape are inferred.
            </td>
          </tr>
          <tr>
            <th className="p-2 align-top">Procedural</th>
            <td className="p-2">
              Façades, roofs, trees, sign typography, sculpture forms, furniture, cars,
              buses and people. Storefront names are OSM name tags drawn as plain text; no
              logos or liveries are reproduced. Signals, routes, crowds, events and
              emergency response are illustrative behaviour, not measured Bethesda.
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
              Retrieved {SOURCE.acquiredAt.slice(0, 10)} (roads and buildings) and{" "}
              {STREETSCAPE_SOURCE.acquiredAt.slice(0, 10)} (streetscape) from
              OpenStreetMap. These are retrieval dates, not survey dates. © OpenStreetMap
              contributors · ODbL 1.0. Terrain retrieved{" "}
              {TERRAIN_SOURCE.acquiredAt.slice(0, 10)}: © Montgomery County Planning
              Department, MNCPPC. Redistribution permitted with attribution; provided
              without warranties.
            </td>
          </tr>
        </tbody>
      </table>
      <h2 className="mt-5 font-mono text-xs tracking-widest text-teal-100">
        THE SAME INSTRUMENT
      </h2>
      <p className="mt-2">
        The building massing here is classified with the desert&apos;s own four evidence
        classes. In Bethesda:{" "}
        {CLASSES.map(
          (c) => `${tally[c]} ${EVIDENCE_CLASSIFICATION_META[c].label.toLowerCase()}`,
        ).join(" · ")}
        . Every footprint is <em>reported</em> (someone mapped it), so the suburb&apos;s
        uncertainty lives in the third dimension: only{" "}
        {buildings.filter((b) => b.heightEvidence === "height tag").length} heights are
        published. The desert&apos;s uncertainty is identity: most of its structures are{" "}
        <em>interpreted</em>. Same instrument, different blind spot. Agents here pass the
        same kind of gate as Blacksite&apos;s player seat: an observation, the legal
        actions, a proposal from a human, Jev or the rules, deterministic validation, then
        the simulation. Seeded generators, canonical hashes and the TypeSafe endpoint are
        shared code.
      </p>
      <p className="mt-4">
        Recognizable street relationships, storefront names, the Bethesda Lane courtyard,
        the Metro entrance and the Madonna of the Trail are the strongest features.
        Façades, foliage, civilian models and vehicles still look procedural. Reference
        photos are not shipped textures or achieved renders.
      </p>
      <div className="mt-4 flex flex-wrap gap-4">
        <button
          type="button"
          className="underline"
          onClick={() => save("bethesda-osm-derivative.geojson", snapshot)}
        >
          Download geographic database
        </button>
        <button
          type="button"
          className="underline"
          onClick={() =>
            save("bethesda-streetscape-derivative.json", streetscapeSnapshot)
          }
        >
          Download streetscape database
        </button>
        <button
          type="button"
          className="underline"
          onClick={() => save("bethesda-terrain.json", terrainSnapshot)}
        >
          Download elevation crop
        </button>
        <a
          href={safeExternalHref(TERRAIN_SOURCE.item)}
          {...EXTERNAL_LINK_PROPS}
          className="underline"
        >
          Terrain source / permission
        </a>
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
function Dossier({ id, onClose }: { id: string; onClose: () => void }) {
  const b = buildings.find((x) => x.id === id);
  if (!b) return null;
  const d = dossier(b);
  return (
    <section
      aria-label="Building dossier"
      className={"absolute top-32 right-4 z-20 w-[min(380px,calc(100vw-32px))] " + panel}
    >
      <p className="font-mono text-[9px] tracking-[.24em] text-teal-200">DOSSIER</p>
      <h2 className="mt-1 text-base">{d.title}</h2>
      <dl className="mt-2 space-y-1 text-[11px]">
        {d.rows.map((r) => (
          <div key={r.label} className="grid grid-cols-[96px_1fr] gap-2">
            <dt className="text-slate-300">{r.label}</dt>
            <dd>
              {r.class ? (
                <>
                  <Glyph c={r.class} />{" "}
                  <span className="sr-only">
                    {EVIDENCE_CLASSIFICATION_META[r.class].label}:{" "}
                  </span>
                </>
              ) : null}
              {r.value}
            </dd>
          </div>
        ))}
      </dl>
      <div className="mt-3 flex gap-3 text-[11px]">
        <a
          href={safeExternalHref(d.osmUrl)}
          {...EXTERNAL_LINK_PROPS}
          className="underline"
        >
          View on OpenStreetMap
        </a>
        <button type="button" className="underline" onClick={onClose}>
          Close dossier
        </button>
      </div>
    </section>
  );
}
function Pulse({ sim }: { sim: CitySimulation }) {
  const count = (f: (a: CitySimulation["agents"][number]) => boolean) =>
    sim.agents.filter(f).length;
  const people = (action: string) =>
    count((a) => a.kind === "pedestrian" && !a.inside && a.action === action);
  const cohorts = sim.districts.reduce(
    (s, d) => ({
      sheltering: s.sheltering + d.sheltering,
      watching: s.watching + d.watching,
      evacuated: s.evacuated + d.evacuated,
    }),
    { sheltering: 0, watching: 0, evacuated: 0 },
  );
  return (
    <div className="mt-2 font-mono text-[10px] text-slate-300" aria-label="City pulse">
      {sim.events.length ? (
        <ul className="mb-1 text-teal-100">
          {sim.events.map((e) => (
            <li key={e.id}>
              ● {e.label} ·{" "}
              {Math.max(0, Math.ceil((e.startTick + e.durationTicks - sim.tick) / 600))}{" "}
              min left
            </li>
          ))}
        </ul>
      ) : null}
      watching {people("watch")} · recording {people("record")} · leaving{" "}
      {people("leave")} · sheltering {people("shelter")} · indoors/riding{" "}
      {count((a) => a.inside)} · staged responders{" "}
      {count((a) => a.kind === "emergency" && !!a.assignment && a.action === "park")} ·
      detouring {count((a) => a.action === "detour" || a.action === "stop")} · closed
      edges {sim.closedRoads.size}
      <br />
      statistical cohorts: sheltering {cohorts.sheltering} · watching {cohorts.watching} ·
      evacuated {cohorts.evacuated} · full-rate radius {sim.focusRadius} m
    </div>
  );
}
const EXAMPLES = [
  "Fire near Bethesda Row.",
  "A thunderstorm suddenly rolls through downtown Bethesda.",
  "The Metro station closes unexpectedly.",
  "A parade starts on Wisconsin Avenue.",
  "A strange unidentified object appears above Bethesda.",
  "Car crash at Woodmont and Bethesda Ave",
  "Power outage downtown for 5 minutes",
  "Close Elm Street",
  "Flash flood near the Farm Women's Market",
];
export default function Bethesda({ onReturn }: { onReturn: () => void }) {
  const [w, setWorld] = useState(() => world()),
    [version, refresh] = useState(0),
    [notes, setNotes] = useState(false),
    [command, setCommand] = useState(false),
    [text, setText] = useState(""),
    [compiled, setCompiled] = useState<Compiled | null>(null),
    [selected, setSelected] = useState<string | null>(null),
    [message, setMessage] = useState(
      "The telemetry has resolved into somewhere ordinary.",
    ),
    [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const { sim, broker, view } = w;
  // The lab: whether you are inside, and the store that outlives each visit.
  const [inside, setInside] = useState(false),
    [nearLab, setNearLab] = useState(false);
  const insideRef = useRef(false),
    nearRef = useRef(false),
    labHolder = useRef<unknown>(null);
  const entered = useRef<{ by: "door" | "coordinates"; mode: ViewControl["mode"] }>({
    by: "door",
    mode: "walk",
  });
  const enterLab = (by: "door" | "coordinates" = "door") => {
    entered.current = { by, mode: view.mode };
    view.keys.clear();
    insideRef.current = true;
    nearRef.current = false;
    setNearLab(false);
    setCommand(false);
    setInside(true);
  };
  const openLab = useRef(enterLab);
  openLab.current = enterLab;
  const exitLab = () => {
    insideRef.current = false;
    view.keys.clear();
    if (entered.current.by === "door") {
      // Step out facing away from the door.
      view.mode = "walk";
      if (LAB_DOOR) view.yaw = LAB_DOOR.facing + Math.PI;
      view.pitch = 0;
    } else {
      // Entered by its coordinates: the city view is where you left it.
      view.mode = entered.current.mode;
      view.relocate = view.mode === "orbit";
    }
    setInside(false);
    setMessage("Back in Bethesda. The city kept its own time while you were inside.");
  };
  view.onSelect = setSelected;
  // Dev-only handle for look-development captures, like `window.__twinStore`.
  // Stripped from production builds; nothing in the app reads it.
  if (import.meta.env.DEV) Object.assign(window, { __bethesda: { sim, view } });
  useEffect(() => {
    const previous = document.title;
    document.title = "Bethesda anomaly — Lop Nur Twin";
    broker.start();
    const heartbeat = setInterval(() => refresh((n) => n + 1), 1000);
    const timer = setInterval(() => {
      // The door is only ever found on foot, and only shown up close.
      const near = view.mode === "walk" && !insideRef.current && nearDoor(sim.player);
      if (near !== nearRef.current) {
        nearRef.current = near;
        setNearLab(near);
      }
      if (sim.paused) return;
      if (view.mode === "walk" && !insideRef.current) {
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
      // The full-rate focus follows the viewer, but only as a recorded command.
      if (sim.tick % 10 === 0) {
        const focus =
          view.mode === "walk"
            ? sim.player
            : view.mode === "seat"
              ? sim.agents[0]!.point
              : view.target;
        if (distance(focus, sim.focus) > 40) sim.setFocus(focus);
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
      // Inside the lab its own controls apply; the city takes no keys.
      if (insideRef.current) return;
      if (e.code === "Backquote") {
        e.preventDefault();
        setCommand((v) => !v);
      }
      if (e.code === "KeyE" && nearRef.current) {
        e.preventDefault();
        openLab.current("door");
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
  // Leaving Bethesda ends the lab's work; an unfinished run is recorded as such.
  useEffect(() => () => (labHolder.current as LabStore | null)?.dispose(), []);
  const render = () => refresh((n) => n + 1),
    geo = geographic(view.target);
  const replay = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 32 * 1024 * 1024) {
      setMessage("Replay exceeds 32 MB.");
      return;
    }
    setBusy(true);
    const previouslyPaused = sim.paused;
    sim.paused = true;
    try {
      const restored = await CitySimulation.replayAsync(
        JSON.parse(await file.text()) as Trace,
      );
      restored.paused = true;
      setWorld(world(restored));
      setMessage("Replay verified: checkpoints, decisions and final state match.");
    } catch (e) {
      sim.paused = previouslyPaused;
      setMessage(e instanceof Error ? e.message : "Invalid replay");
    } finally {
      setBusy(false);
    }
  };
  const tally = evidenceTally();
  return (
    <main
      data-bethesda="active"
      data-indoors={inside ? "rain-lab" : undefined}
      data-status-refresh={version}
      className="relative h-full w-full overflow-hidden bg-[#111f22] text-slate-100"
    >
      {inside ? (
        <LabBoundary onExit={exitLab}>
          <Suspense
            fallback={
              <p
                role="status"
                className="absolute top-1/3 w-full text-center text-teal-100"
              >
                The door opens…
              </p>
            }
          >
            <LabApp sim={sim} holder={labHolder} onExit={exitLab} />
          </Suspense>
        </LabBoundary>
      ) : (
        <>
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
              Real map / terrain · inferred buildings · simulated behavior
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
          {view.evidence ? (
            <aside
              aria-label="Evidence legend"
              className={"absolute top-36 left-4 w-60 text-[11px] " + panel}
            >
              <p className="font-mono text-[9px] tracking-[.24em] text-teal-200">
                EVIDENCE VIEW · BUILDING MASSING
              </p>
              <ul className="mt-2 space-y-1">
                {CLASSES.map((c) => (
                  <li key={c}>
                    <Glyph c={c} /> {EVIDENCE_CLASSIFICATION_META[c].label} · {tally[c]}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-slate-300">
                Footprints are reported by OSM; the class shown is the weaker of footprint
                and height. Click a building for its dossier.
              </p>
            </aside>
          ) : null}
          {selected ? (
            <Dossier
              id={selected}
              onClose={() => {
                view.selected = null;
                setSelected(null);
              }}
            />
          ) : null}
          <section
            aria-label="City controls"
            className={
              "absolute right-4 bottom-4 max-h-[47vh] w-[min(640px,calc(100vw-32px))] overflow-auto sm:w-[min(640px,calc(100vw-250px))] " +
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
              <button
                className={button}
                aria-pressed={view.evidence}
                onClick={() => {
                  view.evidence = !view.evidence;
                  render();
                }}
              >
                Evidence view
              </button>
            </div>
            {view.mode === "walk" ? (
              <p className="mt-2 text-xs text-slate-300">
                WASD · Shift to move faster · drag to look · double-click for mouse lock ·
                Escape releases · click a building for its dossier
              </p>
            ) : null}
            {view.mode === "seat" ? (
              <div
                className="mt-2 flex flex-wrap gap-1"
                aria-label="Permitted human actions"
              >
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
              <button
                className="text-[11px] text-slate-300 underline"
                title="Auto reduces visual cost on slow hardware. Detail keeps reflections and block-scale shadows. Economy disables shadows."
                onClick={() => {
                  view.quality =
                    view.quality === "auto"
                      ? "detail"
                      : view.quality === "detail"
                        ? "economy"
                        : "auto";
                  render();
                }}
              >
                Visuals: {view.quality}
              </button>
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
            <Pulse sim={sim} />
            <p className="mt-2 font-mono text-[10px] text-slate-300">
              {sim.config.pedestrians} individual pedestrians · {sim.config.vehicles} cars
              · {sim.config.buses} buses · {sim.config.statisticalPopulation} statistical
              occupants
              <br />
              tick {sim.tick} · {view.fps} fps · render tier {view.tier} · {broker.status}{" "}
              · accepted {broker.accepted} / fallback {broker.fallbacks} · decisions{" "}
              {sim.decisions.length} (+{sim.reaffirmed} folded)
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
                  setSelected(null);
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
                "absolute top-1/4 left-1/2 z-30 w-[min(560px,calc(100vw-32px))] -translate-x-1/2 " +
                panel
              }
            >
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (resolvesLab(text)) {
                    setText("");
                    enterLab("coordinates");
                    return;
                  }
                  const result = compileScenario(text);
                  setCompiled(result);
                  if (result.error) {
                    setMessage("Unresolved event. " + result.error);
                    return;
                  }
                  const injected = result.events.filter((s) => sim.inject(s));
                  if (!injected.length) setMessage("Event limit reached (8).");
                  else {
                    setMessage(
                      "Event injected: " +
                        injected.map((s) => s.label).join(" + ") +
                        (injected.length < result.events.length
                          ? " (limit reached for the rest)"
                          : ""),
                    );
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
                  Describe an event and a real place in the extract: a street, an
                  intersection (“Woodmont and Bethesda Ave”), a named building, park,
                  storefront or monument. Families:{" "}
                  {Object.values(LABELS).join(" · ").toLowerCase()}.
                </p>
                <div className="mb-3 flex flex-wrap gap-2 text-[11px]">
                  {EXAMPLES.map((x) => (
                    <button
                      key={x}
                      type="button"
                      className="underline"
                      onClick={() => setText(x)}
                    >
                      {x}
                    </button>
                  ))}
                </div>
                {compiled ? (
                  <details className="mb-3 text-[11px]" open={!!compiled.error}>
                    <summary className="cursor-pointer text-teal-100">
                      {compiled.error
                        ? "Not compiled"
                        : `Compiled ${compiled.events.length} structured event(s)`}
                    </summary>
                    {compiled.error ? (
                      <p className="mt-1">{compiled.error}</p>
                    ) : (
                      <>
                        <ul className="mt-1 list-disc pl-5">
                          {compiled.notes.map((n) => (
                            <li key={n}>{n}</li>
                          ))}
                        </ul>
                        <pre className="mt-2 max-h-40 overflow-auto rounded bg-black/30 p-2 font-mono text-[10px]">
                          {JSON.stringify(
                            compiled.events.map((e) => ({
                              ...e,
                              point: {
                                x: Math.round(e.point.x),
                                z: Math.round(e.point.z),
                              },
                              route: e.route ? `${e.route.length} road nodes` : undefined,
                            })),
                            null,
                            1,
                          )}
                        </pre>
                      </>
                    )}
                  </details>
                ) : null}
                <div className="flex gap-2">
                  <button className={button} type="submit">
                    Inject event
                  </button>
                  <button
                    className={button}
                    type="button"
                    onClick={() => setCommand(false)}
                  >
                    Close
                  </button>
                </div>
              </form>
            </section>
          ) : null}
          {nearLab ? (
            <div
              role="status"
              className={
                "absolute bottom-[50vh] left-1/2 z-20 -translate-x-1/2 text-center text-xs " +
                panel
              }
            >
              <p>An unmarked door, a little unlike the others.</p>
              <button className={button + " mt-2"} onClick={() => enterLab("door")}>
                Open it (E)
              </button>
            </div>
          ) : null}
        </>
      )}
    </main>
  );
}
