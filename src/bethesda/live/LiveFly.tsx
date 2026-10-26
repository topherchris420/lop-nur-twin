import { useEffect, useMemo, useRef, useState } from "react";
import { Minus, Plus } from "lucide-react";
import type { LifeObservation, Witness } from "../life/observation";
import { NEARBY_M } from "../life/observation";
import {
  buildings,
  geographic,
  landmarks,
  parks,
  pathWays,
  places,
  roadWays,
  type Point,
} from "../model";
import {
  addSample,
  followWitness,
  presentPose,
  SILENT_AFTER_MS,
  span,
  type Feed,
  type Sample,
} from "./witnessFeed";

/**
 * `/live`: the one Bethesda fly that lives continuously on a server, as its
 * read-only observer serves it (docs/BETHESDA_CONTINUOUS_LIFE.md, "Witnessing
 * it"). Everything here is drawn from the witness: the map is the city's
 * imported geometry, and the fly, the people near it and every number come
 * from the last observation. When the witness is not live the page says so;
 * it never draws a fly of its own.
 */
export default function LiveFly() {
  const [feed, setFeed] = useState<Feed>({ kind: "connecting" });
  const [now, setNow] = useState(() => performance.now());
  const samples = useRef<Sample[]>([]);
  const [zoom, setZoom] = useState(3);

  useEffect(() => {
    document.title = "The Bethesda fly, live";
    // In development only, `?witness=http://127.0.0.1:8790` follows a local observer.
    const local = import.meta.env.DEV
      ? new URLSearchParams(window.location.search).get("witness")
      : null;
    const stop = followWitness(
      (f) => {
        if (f.kind === "witness" && f.witness.observation)
          samples.current = addSample(samples.current, f.witness.observation, f.at);
        if (f.kind === "witness" && f.witness.status === "unavailable")
          samples.current = [];
        setFeed(f);
      },
      local ? { origin: local } : {},
    );
    const clock = setInterval(() => setNow(performance.now()), 1000);
    return () => {
      stop();
      clearInterval(clock);
    };
  }, []);

  const view = present(feed, now);
  const o = view.observation;

  return (
    <div className="bg-background text-foreground flex h-full w-full flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
      <section className="relative h-[58vh] min-h-[320px] shrink-0 lg:h-full lg:flex-1">
        <WitnessMap samples={samples} observation={o} status={view.status} zoom={zoom} />
        <div className="absolute top-3 left-3 flex items-center gap-2">
          <StatusPill status={view.status} />
          {o?.checkpointing ? (
            <span className="hud-panel px-2 py-1 font-mono text-[10px] tracking-widest uppercase">
              committing a checkpoint, clock paused
            </span>
          ) : null}
        </div>
        <div className="absolute right-3 bottom-3 flex flex-col gap-1">
          <button
            type="button"
            aria-label="Zoom in"
            className="hud-panel grid h-8 w-8 place-items-center"
            onClick={() => setZoom((z) => Math.min(16, z * 1.5))}
          >
            <Plus className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="Zoom out"
            className="hud-panel grid h-8 w-8 place-items-center"
            onClick={() => setZoom((z) => Math.max(1, z / 1.5))}
          >
            <Minus className="h-4 w-4" />
          </button>
        </div>
        {!o ? (
          <div className="absolute inset-0 grid place-items-center p-6">
            <div className="hud-panel max-w-sm p-5 text-center text-sm">
              <p className="font-mono text-[10px] tracking-[0.3em] uppercase">
                {view.status === "connecting" ? "Connecting" : "No fly shown"}
              </p>
              <p className="text-muted-foreground mt-2">
                {view.status === "connecting"
                  ? "Reaching the observer of the one living fly."
                  : `${view.reason}. This page draws no fly of its own in its place.`}
              </p>
            </div>
          </div>
        ) : null}
      </section>
      <aside className="border-border w-full space-y-5 border-t p-5 lg:h-full lg:w-[400px] lg:shrink-0 lg:overflow-y-auto lg:border-t-0 lg:border-l">
        <header>
          <p className="text-muted-foreground font-mono text-[10px] tracking-[0.35em] uppercase">
            One fly · one continuous life
          </p>
          <h1 className="mt-1 text-xl font-semibold">The Bethesda fly, live</h1>
          <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
            A simulated fly living in a model of Bethesda, Maryland, computed tick by tick
            on one server whether or not anyone watches. Everyone who opens this page sees
            the same individual.
          </p>
          {view.reason && o ? (
            <p className="mt-2 text-sm text-amber-300">{view.reason}.</p>
          ) : null}
        </header>
        {o ? <Now o={o} /> : null}
        {o ? <Recent o={o} /> : null}
        {o ? <Life o={o} /> : null}
        {o ? <SelfModel o={o} /> : null}
        <footer className="text-muted-foreground border-border space-y-2 border-t pt-4 text-xs leading-relaxed">
          <p>
            This page only reads: it cannot step, steer or restart the fly, and watching
            it changes nothing. The fly between two observations is interpolated for
            drawing; every number is the server&apos;s.
          </p>
          <p>
            It shows a program&apos;s state as it runs. A continuous history and a
            functional self-model are not evidence that the fly feels or is aware of
            anything.{" "}
            <a
              className="underline"
              href="https://github.com/topherchris420/lop-nur-twin/blob/main/docs/BETHESDA_CONTINUOUS_LIFE.md"
            >
              How it lives
            </a>
          </p>
        </footer>
      </aside>
    </div>
  );
}

type Status = Witness["status"] | "connecting" | "lost";

/** What to show: the witness, unless the stream has gone quiet or been lost. */
function present(
  feed: Feed,
  now: number,
): { status: Status; reason: string | null; observation: LifeObservation | null } {
  if (feed.kind === "connecting")
    return { status: "connecting", reason: null, observation: null };
  if (feed.kind === "lost")
    return {
      status: "lost",
      reason: feed.reason,
      observation: feed.last?.observation ?? null,
    };
  const { witness: w, at } = feed;
  if (now - at > SILENT_AFTER_MS)
    return {
      status: "lost",
      reason: `no word from the observer for ${span((now - at) / 1000)}`,
      observation: w.observation,
    };
  return { status: w.status, reason: w.reason, observation: w.observation };
}

function StatusPill({ status }: { status: Status }) {
  const live = status === "live";
  const label = {
    live: "Live",
    stale: "Stale",
    unavailable: "Unavailable",
    connecting: "Connecting",
    lost: "Observer lost",
  }[status];
  return (
    <span
      role="status"
      className="hud-panel inline-flex items-center gap-2 px-2.5 py-1 font-mono text-[11px] tracking-widest uppercase"
    >
      <span className="relative flex h-2 w-2">
        {live ? (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
        ) : null}
        <span
          className={`relative inline-flex h-2 w-2 rounded-full ${live ? "bg-emerald-400" : status === "connecting" ? "bg-slate-400" : "bg-amber-400"}`}
        />
      </span>
      {label}
    </span>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-muted-foreground mb-2 font-mono text-[10px] tracking-[0.3em] uppercase">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-muted-foreground text-[11px]">{label}</dt>
      <dd className="font-mono text-sm">{children}</dd>
    </div>
  );
}

const MODE_WORDS: Record<string, string> = {
  flight: "Flying",
  walk: "Walking",
  rest: "Resting",
  feed: "Feeding",
  takeoff: "Taking off",
  landing: "Landing",
  escape: "Escaping",
};

/** "groom/eyes" → "Grooming (eyes)"; an unknown mode is shown as it is. */
function modeWords(mode: string): string {
  const [head, ...rest] = mode.split("/");
  const word = head === "groom" ? "Grooming" : (MODE_WORDS[head!] ?? head!);
  return rest.length ? `${word} (${rest.join(", ")})` : word;
}

const named = [
  ...landmarks,
  ...places.filter((p) => p.name && p.kind !== "signal" && p.kind !== "crossing"),
];

function nearestPlace(p: Point): { name: string; m: number } | null {
  let best: { name: string; m: number } | null = null;
  for (const l of named) {
    const m = Math.hypot(l.point.x - p.x, l.point.z - p.z);
    if (!best || m < best.m) best = { name: l.name, m };
  }
  return best && best.m < 400 ? best : null;
}

function Now({ o }: { o: LifeObservation }) {
  const [x, , z] = o.fly.position;
  const speed = Math.hypot(...o.fly.velocity);
  const place = useMemo(() => nearestPlace({ x, z }), [x, z]);
  const geo = geographic({ x, z });
  const last = o.fly.recent.at(-1);
  const kinds = o.nearby.reduce<Record<string, number>>((n, a) => {
    n[a.kind] = (n[a.kind] ?? 0) + 1;
    return n;
  }, {});
  const around = Object.entries(kinds)
    .map(([k, n]) => `${n} ${k}${n === 1 ? "" : k === "bus" ? "es" : "s"}`)
    .join(", ");
  return (
    <Section title="Now">
      <p className="text-lg">{modeWords(o.fly.mode)}</p>
      {last ? (
        <p className="text-muted-foreground text-sm">Last decision: {last.reason}.</p>
      ) : null}
      <div className="mt-3">
        <div className="text-muted-foreground flex justify-between text-[11px]">
          <span>Energy reserve</span>
          <span className="font-mono">{(o.fly.energyFraction * 100).toFixed(0)}%</span>
        </div>
        <div className="bg-muted mt-1 h-1.5 overflow-hidden rounded-full">
          <div
            className="bg-primary h-full rounded-full transition-[width] duration-700"
            style={{ width: `${Math.max(0, Math.min(1, o.fly.energyFraction)) * 100}%` }}
          />
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-3">
        <Fact label="Speed">
          {speed < 0.005 ? "still" : `${(speed * 100).toFixed(0)} cm/s`}
        </Fact>
        <Fact label="Meals">{o.fly.meals}</Fact>
        <Fact label="Escapes">{o.fly.escapes}</Fact>
      </dl>
      <p className="text-muted-foreground mt-3 text-sm">
        {place ? `${Math.round(place.m)} m from ${place.name}. ` : ""}
        <span className="font-mono text-xs">
          {geo.lat.toFixed(5)}° N, {Math.abs(geo.lon).toFixed(5)}° W
        </span>
      </p>
      <p className="text-muted-foreground text-sm">
        {around
          ? `Within ${NEARBY_M} m: ${around}.`
          : `Nobody outdoors within ${NEARBY_M} m.`}
      </p>
    </Section>
  );
}

function Recent({ o }: { o: LifeObservation }) {
  const recent = [...o.fly.recent].reverse();
  return (
    <Section title="What it decided">
      {recent.length ? (
        <ol className="space-y-2">
          {recent.map((d, i) => (
            <li key={`${d.t}-${i}`} className="text-sm">
              <span className="text-muted-foreground font-mono text-[11px]">
                {span(o.simulatedSeconds - d.t)} ago · {d.from} → {d.to}
                {d.kind === "refused"
                  ? " · refused"
                  : d.kind === "event"
                    ? " · event"
                    : ""}
              </span>
              <br />
              {d.reason}
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-muted-foreground text-sm">No decision recorded yet.</p>
      )}
    </Section>
  );
}

function Life({ o }: { o: LifeObservation }) {
  const committed = Date.parse(o.checkpoint.committedUtc);
  return (
    <Section title="Its life">
      <p className="text-sm leading-relaxed">
        Has lived {span(o.simulatedSeconds)} of its own time, every tenth of a second
        computed. When the server stops, the fly pauses; the time is never filled in.
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-3">
        <Fact label="Individual">{o.individual.slice(0, 12)}</Fact>
        <Fact label="Writer epoch">{o.epoch}</Fact>
        <Fact label="Tick">{o.tick.toLocaleString("en-US")}</Fact>
        <Fact label="Last checkpoint">
          #{o.checkpoint.sequence}, {span((Date.now() - committed) / 1000)} ago
        </Fact>
      </dl>
      <p className="text-muted-foreground mt-2 font-mono text-[10px]">
        {o.versions.city} · {o.versions.fly} · {o.flyController}
      </p>
    </Section>
  );
}

function SelfModel({ o }: { o: LifeObservation }) {
  const m = o.selfModel;
  return (
    <Section title="Its model of itself">
      {m ? (
        <>
          <p className="text-muted-foreground text-xs">
            The fly&apos;s own estimates ({m.echoVersion}).
          </p>
          <dl className="mt-2 grid grid-cols-2 gap-3">
            <Fact label="Trusts its sense of motion">
              {m.trustInSense.toFixed(2)} × innate
            </Fact>
            <Fact label="Leg speed gain">{m.legGain.toFixed(3)}</Fact>
            <Fact label="Inquiries into its errors">{m.inquiries}</Fact>
            <Fact label="Episodes kept">{m.episodes}</Fact>
          </dl>
        </>
      ) : (
        <p className="text-muted-foreground text-sm leading-relaxed">
          This individual runs the reduced-order controller, which keeps no model of
          itself. A Project ECHO fly would show here what its functional self-model holds:
          how far it trusts its senses, what it believes about its own body, and the
          inquiries it opens when its predictions fail.
        </p>
      )}
    </Section>
  );
}

const AGENT_COLOR: Record<string, string> = {
  pedestrian: "#9ab69b",
  bus: "#8fc0e8",
  emergency: "#f1b86d",
};

/** A shape's bounding box, for drawing only what is in view. */
function box(points: readonly Point[]): readonly [number, number, number, number] {
  const xs = points.map((p) => p.x),
    zs = points.map((p) => p.z);
  return [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)];
}
const footprints = buildings.map((b) => ({ b, box: box(b.ring) }));
const roads = roadWays.map((r) => ({ r, box: box(r.points) }));
const paths = pathWays.map((r) => ({ r, box: box(r.points) }));

function WitnessMap({
  samples,
  observation,
  status,
  zoom,
}: {
  samples: React.RefObject<Sample[]>;
  observation: LifeObservation | null;
  status: Status;
  zoom: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const state = useRef({ observation, status, zoom });
  state.current = { observation, status, zoom };

  useEffect(() => {
    const canvas = ref.current,
      c = canvas?.getContext("2d");
    if (!canvas || !c) return;
    const trail: { x: number; z: number }[] = [];
    let lastTrail = 0,
      frame = 0;
    const draw = () => {
      frame = requestAnimationFrame(draw);
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth,
        h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      const { observation: o, status, zoom: scale } = state.current;
      const t = performance.now();
      const pose = o ? presentPose(samples.current ?? [], t) : null;
      const live = status === "live";
      c.fillStyle = "#0f1719";
      c.fillRect(0, 0, w, h);
      const cx = pose?.x ?? 0,
        cz = pose?.z ?? 0;
      const p = (q: Point): [number, number] => [
        w / 2 + (q.x - cx) * scale,
        h / 2 + (q.z - cz) * scale,
      ];
      const half = { x: w / 2 / scale + 10, z: h / 2 / scale + 10 };
      const visible = (x0: number, z0: number, x1: number, z1: number) =>
        x1 > cx - half.x && x0 < cx + half.x && z1 > cz - half.z && z0 < cz + half.z;
      const ring = (points: Point[]) =>
        points.forEach((v, i) => (i === 0 ? c.moveTo(...p(v)) : c.lineTo(...p(v))));

      c.fillStyle = "#1b3326";
      for (const park of parks) {
        c.beginPath();
        ring(park.ring);
        c.closePath();
        c.fill();
      }
      c.fillStyle = "#2e3f42";
      c.strokeStyle = "#4a6264";
      c.lineWidth = 1;
      for (const { b, box } of footprints) {
        if (!visible(...box)) continue;
        c.beginPath();
        for (const r of [b.ring, ...b.holes]) {
          ring(r);
          c.closePath();
        }
        c.fill("evenodd");
        c.stroke();
      }
      c.lineCap = "round";
      c.strokeStyle = "#2a3432";
      for (const { r, box } of roads) {
        if (!visible(...box)) continue;
        c.lineWidth = Math.max(1, r.width * scale * 0.9);
        c.beginPath();
        ring(r.points);
        c.stroke();
      }
      c.strokeStyle = "#35403c";
      c.lineWidth = Math.max(0.6, 1.6 * scale * 0.5);
      for (const { r, box } of paths) {
        if (!visible(...box)) continue;
        c.beginPath();
        ring(r.points);
        c.stroke();
      }

      if (o && pose) {
        for (const a of o.nearby) {
          c.fillStyle = AGENT_COLOR[a.kind] ?? "#d4c8a4";
          const [ax, az] = p(a);
          const r =
            a.kind === "pedestrian" ? Math.max(2, 0.3 * scale) : Math.max(3, 1 * scale);
          c.beginPath();
          c.arc(ax, az, r, 0, Math.PI * 2);
          c.fill();
        }
        if (t - lastTrail > 250) {
          lastTrail = t;
          const prev = trail.at(-1);
          if (prev && Math.hypot(prev.x - pose.x, prev.z - pose.z) > 20) trail.length = 0;
          if (!prev || Math.hypot(prev.x - pose.x, prev.z - pose.z) > 0.03)
            trail.push({ x: pose.x, z: pose.z });
          if (trail.length > 240) trail.shift();
        }
        for (let i = 1; i < trail.length; i++) {
          c.strokeStyle = `rgba(232, 184, 96, ${(i / trail.length) * 0.85})`;
          c.lineWidth = 2;
          c.beginPath();
          c.moveTo(...p(trail[i - 1]!));
          c.lineTo(...p(trail[i]!));
          c.stroke();
        }
        const [fx, fz] = p(pose);
        if (live) {
          const pulse = (t % 2000) / 2000;
          c.strokeStyle = `rgba(232, 184, 96, ${0.5 * (1 - pulse)})`;
          c.lineWidth = 1.5;
          c.beginPath();
          c.arc(fx, fz, 12 + pulse * 26, 0, Math.PI * 2);
          c.stroke();
        }
        // Forward is (cos yaw, −sin yaw) on a map with south down (units.ts).
        c.save();
        c.translate(fx, fz);
        c.rotate(-pose.yaw);
        // An icon, not to scale: the fly is about 3 mm long.
        c.scale(2.2, 2.2);
        c.shadowColor = "rgba(0, 0, 0, 0.8)";
        c.shadowBlur = 4;
        const body = live ? "#e8b860" : "#8b8f8c";
        c.fillStyle = "rgba(220, 230, 235, 0.55)";
        for (const s of [-1, 1]) {
          c.beginPath();
          c.ellipse(-1, s * 3.2, 4.2, 2, s * 0.5, 0, Math.PI * 2);
          c.fill();
        }
        c.fillStyle = body;
        c.beginPath();
        c.ellipse(0, 0, 5, 2.4, 0, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = "#7a2a1e";
        c.beginPath();
        c.arc(4.2, 0, 1.9, 0, Math.PI * 2);
        c.fill();
        c.restore();
      }

      // Scale bar and north.
      const bar = scale >= 6 ? 5 : scale >= 2.5 ? 10 : 50;
      c.fillStyle = "rgba(230, 225, 210, 0.8)";
      c.fillRect(14, h - 20, bar * scale, 2);
      c.font = "10px ui-monospace, monospace";
      c.fillText(`${bar} m`, 14, h - 26);
      c.fillText("N ↑", w - 34, 52);
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, [samples]);

  return (
    <canvas
      ref={ref}
      className="h-full w-full"
      role="img"
      aria-label="Map of the fly in Bethesda: the city's buildings and streets, the fly, its recent path and the people near it"
    />
  );
}
