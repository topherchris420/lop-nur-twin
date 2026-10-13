import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Eye, MoveLeft, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ScenarioCard } from "./types";
import { TRAITS, emblemPath, fmt } from "./format";

/** A seeded scatter of stars, so the sky is the same on every visit. */
function stars(n: number): { x: number; y: number; r: number; o: number }[] {
  let s = 0x9e3779b9;
  const rnd = () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
  return Array.from({ length: n }, () => ({
    x: rnd() * 100,
    y: rnd() * 100,
    r: 0.04 + rnd() * 0.12,
    o: 0.25 + rnd() * 0.7,
  }));
}

/** A dot-matrix rendering of a world: a dot wherever a province is near. */
function DotGlobe({ card, size = 520 }: { card: ScenarioCard; size?: number }) {
  const dots = useMemo(() => {
    const pts = card.points;
    const lons = pts.map((p) => p[0]),
      lats = pts.map((p) => p[1]);
    const [x0, x1] = [Math.min(...lons) - 3, Math.max(...lons) + 3];
    const [y0, y1] = [Math.min(...lats) - 3, Math.max(...lats) + 3];
    const span = Math.max(x1 - x0, y1 - y0);
    const step = span / 46;
    const out: { x: number; y: number; c: number | null }[] = [];
    for (let lat = y1; lat >= y0; lat -= step)
      for (let lon = x0; lon <= x1; lon += step) {
        let best = Infinity,
          owner: number | null = null;
        for (const [px, py, o] of pts) {
          const d = Math.hypot(px - lon, py - lat);
          if (d < best) [best, owner] = [d, o];
        }
        if (best < span / 13)
          out.push({ x: (lon - x0) / span, y: (y1 - lat) / span, c: owner });
      }
    return out;
  }, [card]);
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      aria-hidden="true"
      className="nt-globe"
    >
      <defs>
        <radialGradient id="nt-globe-fill" cx="50%" cy="38%" r="60%">
          <stop offset="0%" stopColor="#3a3d44" />
          <stop offset="100%" stopColor="#141518" />
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="47" fill="url(#nt-globe-fill)" />
      <circle
        cx="50"
        cy="50"
        r="47"
        fill="none"
        stroke="#ffffff"
        strokeOpacity="0.55"
        strokeWidth="0.6"
        className="nt-halo"
      />
      {dots.map((d, i) => (
        <circle
          key={i}
          cx={8 + d.x * 84}
          cy={14 + d.y * 84}
          r="0.62"
          fill={d.c === null ? "#e8e8e8" : (card.civs[d.c]?.color ?? "#e8e8e8")}
          opacity={d.c === null ? 0.55 : 0.95}
        />
      ))}
    </svg>
  );
}

function CardArt({ card }: { card: ScenarioCard }) {
  return (
    <div className="relative h-40 overflow-hidden rounded-2xl bg-gradient-to-br from-[#1b2430] via-[#11161d] to-[#0a0c10]">
      <div className="absolute -right-10 -bottom-24 opacity-90">
        <DotGlobe card={card} size={300} />
      </div>
      <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/70 to-transparent" />
      <span className="absolute bottom-3 left-4 font-mono text-[11px] tracking-[0.18em] text-white/80 uppercase">
        {card.date}
      </span>
    </div>
  );
}

export interface LobbyProps {
  cards: ScenarioCard[];
  engineVersion: string;
  initialScenario?: string;
  /** From `?seed=`, already bounded by the route. */
  initialSeed?: number;
  onBegin: (scenario: string, play: string | null, seed: number) => void;
}

export function Lobby({
  cards,
  engineVersion,
  initialScenario,
  initialSeed,
  onBegin,
}: LobbyProps) {
  const [scenario, setScenario] = useState(initialScenario ?? cards[0]?.id ?? "");
  const [play, setPlay] = useState<string | null>(null);
  const [seed, setSeed] = useState(initialSeed ?? 1);
  const sky = useMemo(() => stars(260), []);
  const card = cards.find((c) => c.id === scenario) ?? cards[0];

  return (
    <div className="noeterra-lobby relative h-full w-full overflow-x-hidden overflow-y-auto bg-black text-white">
      <svg
        className="pointer-events-none fixed inset-0 h-full w-full"
        aria-hidden="true"
        preserveAspectRatio="none"
        viewBox="0 0 100 100"
      >
        {sky.map((s, i) => (
          <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="#fff" opacity={s.o} />
        ))}
      </svg>
      <div className="relative mx-auto flex max-w-6xl flex-col items-center px-6 pt-10 pb-16">
        <div className="flex w-full items-center justify-between text-xs">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-white/80 hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none"
          >
            <MoveLeft className="size-3.5" aria-hidden="true" />
            Lop Nur twin
          </Link>
          <p
            role="note"
            className="rounded-full border border-amber-300/30 bg-amber-300/10 px-3 py-1.5 text-amber-100"
          >
            Illustrative simulation — not historical evidence
          </p>
        </div>

        <header className="mt-10 text-center">
          <h1 className="nt-display relative inline-block text-6xl font-extrabold tracking-tight sm:text-7xl">
            Noeterra
            <span className="nt-tag absolute -top-6 right-0 text-sm font-bold whitespace-nowrap text-amber-300 sm:-top-2 sm:-right-24">
              a R.A.I.N. world
            </span>
          </h1>
          <p className="mt-4 text-lg text-white/80">
            Alternate histories, played by autonomous civilizations.
          </p>
        </header>

        {card && (
          <div className="relative mt-6 h-[300px] w-[520px] max-w-full overflow-hidden">
            <div className="absolute top-0 left-1/2 -translate-x-1/2">
              <DotGlobe card={card} />
            </div>
          </div>
        )}

        <section aria-labelledby="nt-worlds" className="w-full">
          <h2 id="nt-worlds" className="mb-4 text-2xl font-semibold">
            Choose a world
          </h2>
          <div className="grid gap-6 sm:grid-cols-2">
            {cards.map((c, i) => (
              <button
                key={c.id}
                type="button"
                aria-pressed={c.id === scenario}
                onClick={() => {
                  setScenario(c.id);
                  setPlay(null);
                }}
                className={cn(
                  "group rounded-3xl p-1 text-left transition focus-visible:outline-none",
                  c.id === scenario
                    ? "nt-gradient-ring"
                    : "ring-1 ring-white/10 hover:ring-white/30",
                )}
              >
                <div className="h-full rounded-[1.3rem] bg-[#0b0d10] p-3">
                  <CardArt card={c} />
                  <div className="mt-3 flex items-start gap-3 px-1">
                    <span className="text-5xl leading-none font-black text-white/15">
                      {i + 1}
                    </span>
                    <div>
                      <h3 className="text-lg font-semibold">{c.name}</h3>
                      <p className="text-xs text-white/60">
                        {c.civs.length} powers · {c.provinces} provinces · {c.date}
                      </p>
                      <p className="mt-2 text-sm leading-snug text-white/75">
                        {c.description}
                      </p>
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </section>

        {card && (
          <section aria-labelledby="nt-nations" className="mt-12 w-full">
            <h2 id="nt-nations" className="text-2xl font-semibold">
              Choose your nation
            </h2>
            <p className="mt-1 text-sm text-white/65">
              Every other nation is ruled by an autonomous agent with its own memory,
              beliefs and goals. Or watch them alone.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <button
                type="button"
                aria-pressed={play === null}
                onClick={() => setPlay(null)}
                className={cn(
                  "flex items-center gap-3 rounded-2xl border bg-[#0b0d10] p-4 text-left transition focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none",
                  play === null
                    ? "border-fuchsia-400/70 bg-[#1a0f1f]"
                    : "border-white/10 hover:border-white/30",
                )}
              >
                <Eye className="size-8 shrink-0 text-white/80" aria-hidden="true" />
                <span>
                  <span className="block font-semibold">Observe</span>
                  <span className="block text-xs text-white/60">
                    Watch every nation decide for itself.
                  </span>
                </span>
              </button>
              {card.civs.map((c) => {
                const top = [...TRAITS]
                  .sort((a, b) => c.personality[b] - c.personality[a])
                  .slice(0, 2);
                return (
                  <button
                    key={c.key}
                    type="button"
                    aria-pressed={play === c.key}
                    onClick={() => setPlay(c.key)}
                    className={cn(
                      "flex items-start gap-3 rounded-2xl border bg-[#0b0d10] p-4 text-left transition focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none",
                      play === c.key
                        ? "border-fuchsia-400/70 bg-[#1a0f1f]"
                        : "border-white/10 hover:border-white/30",
                    )}
                  >
                    <svg
                      viewBox="0 0 24 25"
                      className="mt-0.5 size-8 shrink-0"
                      aria-hidden="true"
                    >
                      <path
                        d={emblemPath()}
                        fill={c.color}
                        stroke="#fff"
                        strokeOpacity="0.6"
                        strokeWidth="1"
                      />
                      <text
                        x="12"
                        y="15.5"
                        fontSize="10"
                        textAnchor="middle"
                        fill="#fff"
                        fontWeight="700"
                      >
                        {c.name.replace(/^Kingdom of /, "").charAt(0)}
                      </text>
                    </svg>
                    <span className="min-w-0">
                      <span className="block font-semibold">{c.name}</span>
                      <span className="block truncate text-xs text-white/60">
                        {c.ruler}
                      </span>
                      <span className="mt-1 block text-xs text-white/70">
                        {c.government} · {c.provinces}{" "}
                        {c.provinces === 1 ? "province" : "provinces"}
                      </span>
                      <span className="mt-1.5 flex gap-1.5">
                        {top.map((t) => (
                          <span
                            key={t}
                            className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white/80"
                          >
                            {t} {fmt(c.personality[t], 2)}
                          </span>
                        ))}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
          <label className="flex items-center gap-2 text-sm text-white/70">
            World seed
            <input
              type="number"
              min={0}
              max={2147483647}
              value={seed}
              onChange={(e) =>
                setSeed(
                  Math.max(
                    0,
                    Math.min(2147483647, Math.floor(Number(e.target.value) || 0)),
                  ),
                )
              }
              className="w-28 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-white"
            />
          </label>
          <button
            type="button"
            disabled={!card}
            onClick={() => card && onBegin(card.id, play, seed)}
            className="nt-gradient-ring rounded-2xl p-[2px] focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none"
          >
            <span className="flex items-center gap-2 rounded-[0.9rem] bg-black px-10 py-3 font-semibold">
              <Play className="size-4" aria-hidden="true" />
              {play
                ? `Rule ${card?.civs.find((c) => c.key === play)?.name ?? ""}`
                : "Watch history unfold"}
            </span>
          </button>
        </div>

        {card && (
          <p className="mt-10 max-w-3xl text-center text-xs leading-relaxed text-white/50">
            {card.provenance} The engine ({engineVersion}) runs in this browser as
            WebAssembly that can reach nothing outside it; every season ends in a state
            hash a replay must reproduce.
          </p>
        )}
      </div>
    </div>
  );
}
