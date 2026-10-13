import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  BookOpen,
  ChevronsRight,
  Download,
  FastForward,
  Handshake,
  Landmark,
  ListChecks,
  Menu,
  MoveLeft,
  PanelRight,
  ScrollText,
  ShieldCheck,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { BrowserEngine } from "./engine";
import { describeTerms } from "./engine";
import type { Action, Civ, GameEvent, GameState, Geometry, Mind, Offer } from "./types";
import { WorldMap, shortName } from "./WorldMap";
import {
  CATEGORY_STYLE,
  TRAITS,
  emblemPath,
  eventHeading,
  fmt,
  seasonOf,
} from "./format";

const glass =
  "rounded-xl border border-white/10 bg-[#0d1316]/85 text-slate-100 shadow-2xl backdrop-blur-md";
const MAX_ORDERS = 6;

function Emblem({ civ, size = 36 }: { civ: Civ; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 25"
      width={size}
      height={size}
      aria-hidden="true"
      className="shrink-0"
    >
      <path
        d={emblemPath()}
        fill={civ.color}
        stroke="#fff"
        strokeOpacity="0.55"
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
        {shortName(civ.name).charAt(0)}
      </text>
    </svg>
  );
}

function Bar({
  label,
  value,
  max = 100,
  tone,
}: {
  label: string;
  value: number;
  max?: number;
  tone?: string;
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const color =
    tone ?? (pct < 30 ? "bg-red-500" : pct < 60 ? "bg-amber-400" : "bg-emerald-400");
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
      <div className="flex justify-between text-[11px] font-semibold tracking-[0.12em] text-white/70 uppercase">
        <span>{label}</span>
        <span className="text-white">
          {fmt(value)}/{max}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 rounded-full bg-white/10">
        <div className={cn("h-1.5 rounded-full", color)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Tile({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: string;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
      <div className="text-[10px] font-semibold tracking-[0.12em] text-white/60 uppercase">
        {label}
      </div>
      <div className={cn("text-lg font-bold", tone ?? "text-white")}>{value}</div>
      {sub && <div className="text-[11px] text-white/55">{sub}</div>}
    </div>
  );
}

const LABEL_TEXT: Record<string, string> = {
  rules: "RULES",
  amnesic: "RULES · NO MEMORY",
  random: "RANDOM",
  live: "LIVE MODEL",
  fallback: "FALLBACK",
  human: "YOU",
  replay: "REPLAY",
};

function targets(a: Action): number[] {
  switch (a.type) {
    case "move":
      return [a.to];
    case "recruit":
    case "fortify":
    case "develop":
    case "suppress":
      return [a.province];
    default:
      return [];
  }
}

function group(a: Action): "Armies" | "Realm" | "Diplomacy" {
  if (a.type === "move") return "Armies";
  if (
    a.type === "propose" ||
    a.type === "declare_war" ||
    a.type === "gift" ||
    a.type === "cancel_treaty"
  )
    return "Diplomacy";
  return "Realm";
}

export interface GameProps {
  engine: BrowserEngine;
  session: number;
  you: number | null;
  onExit: () => void;
  onReplace: (session: number, you: number | null, notice?: string) => void;
  /** Shown once when the game opens, e.g. after a history is loaded. */
  notice?: string;
}

/** Below Tailwind's `sm` breakpoint, where the two side panels would overlap. */
const narrowScreen = () => window.matchMedia?.("(max-width: 639px)").matches === true;

export function Game({ engine, session, you, onExit, onReplace, notice }: GameProps) {
  const [state, setState] = useState<GameState | null>(null);
  const [geometry, setGeometry] = useState<Geometry | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [tab, setTab] = useState<"realm" | "orders" | "diplomacy" | "advisor">(
    you !== null ? "orders" : "realm",
  );
  // A phone has room for one side panel: the nation panel first, the events
  // after each jump, and opening either closes the other.
  const [leftOpen, setLeftOpenRaw] = useState(() => !narrowScreen());
  const [rightOpen, setRightOpenRaw] = useState(true);
  const setLeftOpen = (open: boolean) => {
    setLeftOpenRaw(open);
    if (open && narrowScreen()) setRightOpenRaw(false);
  };
  const setRightOpen = (open: boolean) => {
    setRightOpenRaw(open);
    if (open && narrowScreen()) setLeftOpenRaw(false);
  };
  const [playback, setPlayback] = useState<{
    events: GameEvent[];
    shown: number;
    from: string;
    to: string;
  } | null>(null);
  const [picked, setPicked] = useState<number[]>([]);
  const [answers, setAnswers] = useState<Record<number, boolean>>({});
  const [letters, setLetters] = useState<{ to: number; text: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(notice ?? null);
  const [focusCiv, setFocusCiv] = useState<number | null>(you);
  const [reveal, setRevealRaw] = useState(you === null);
  // A player looks at other nations through the research view; leaving it
  // brings the panel back to their own.
  const setReveal = (on: boolean) => {
    setRevealRaw(on);
    if (!on) setFocusCiv(you);
  };
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(() => {
    const st = engine.state(session, 0, geometry === null);
    if (st.geometry) setGeometry(st.geometry);
    setState(st);
    return st;
  }, [engine, session, geometry]);

  useEffect(() => {
    refresh();
    // Only on a new session; later refreshes are explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  const human = state?.humans.find((h) => h.civ === you) ?? null;
  // A fallen player watches on: the notice says so once, and the jump buttons
  // stay live.
  const fallen = you !== null && state?.civs[you]?.alive === false;
  const [watching, setWatching] = useState(false);
  const watchOnRef = useRef<HTMLButtonElement>(null);
  const jumpRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (fallen && !watching) watchOnRef.current?.focus();
  }, [fallen, watching]);
  const watchOn = () => {
    setWatching(true);
    jumpRef.current?.focus();
  };
  // Choosing a province, on the map or in the list, shows its nation to an
  // observer or in the research view.
  const selectProvince = (p: number | null) => {
    setSelected(p);
    const owner = p === null ? null : (state?.provinces[p]?.owner ?? null);
    if ((you === null || reveal) && owner !== null) setFocusCiv(owner);
  };
  const viewCiv: number | null =
    focusCiv ??
    (selected !== null ? (state?.provinces[selected]?.owner ?? null) : null) ??
    (state ? (state.civs.find((c) => c.alive)?.id ?? null) : null);

  const mind: Mind | null = useMemo(() => {
    if (!state || viewCiv === null) return null;
    if (viewCiv !== you && !reveal) return null;
    try {
      return engine.mind(session, viewCiv);
    } catch {
      return null;
    }
  }, [engine, session, state, viewCiv, you, reveal]);

  const yourMind: Mind | null = useMemo(() => {
    if (!state || you === null) return null;
    try {
      return engine.mind(session, you);
    } catch {
      return null;
    }
  }, [engine, session, state, you]);

  const jump = useCallback(
    (turns: number) => {
      if (!state || busy) return;
      setBusy(true);
      // Let the button show its state before the engine takes the thread.
      setTimeout(() => {
        try {
          if (you !== null && human) {
            const responses = human.proposals.map((p) => ({
              proposal: p.id,
              accept: answers[p.id] === true,
            }));
            engine.orders(session, you, picked, responses, letters);
          }
          const before = state.event_count;
          const from = state.date;
          engine.advance(session, turns);
          const st = refresh();
          const fresh = st.events.slice(before);
          setPlayback({
            events: fresh,
            shown: Math.min(1, fresh.length),
            from,
            to: seasonOf(st.start_year, st.turn - 1),
          });
          setLeftOpen(true);
          setPicked([]);
          setAnswers({});
          setLetters([]);
          const refused = st.last_turn?.rejected.filter((r) => r.civ === you) ?? [];
          if (refused.length)
            setToast(
              `${refused.length} order(s) were refused when the season resolved: ${refused.map((r) => r.reason).join("; ")}`,
            );
        } catch (e) {
          setToast(e instanceof Error ? e.message : "The engine refused.");
        } finally {
          setBusy(false);
        }
      }, 30);
    },
    [state, busy, you, human, answers, picked, letters, engine, session, refresh],
  );

  const shownEvents = playback ? playback.events.slice(0, playback.shown) : [];
  const focus =
    playback && playback.shown > 0
      ? (playback.events[playback.shown - 1]?.provinces ?? [])
      : [];

  if (!state || !geometry) {
    return (
      <div className="grid h-full place-items-center bg-[#081a20] text-slate-200">
        Preparing the world…
      </div>
    );
  }

  const youCiv = you !== null ? state.civs[you] : undefined;
  const view = viewCiv !== null ? state.civs[viewCiv] : undefined;
  const offers = human?.offered ?? [];
  const pickedArmies = new Set(
    picked
      .map((i) => offers[i]?.action)
      .flatMap((a) => (a && a.type === "move" ? [a.army] : [])),
  );
  const toggleOffer = (o: Offer) =>
    setPicked((p) => {
      if (p.includes(o.index)) return p.filter((x) => x !== o.index);
      if (p.length >= MAX_ORDERS) return p;
      if (o.action.type === "move" && pickedArmies.has(o.action.army)) {
        const army = o.action.army;
        return [
          ...p.filter((i) => {
            const a = offers[i]?.action;
            return !(a && a.type === "move" && a.army === army);
          }),
          o.index,
        ];
      }
      return [...p, o.index];
    });
  const province = selected !== null ? state.provinces[selected] : undefined;
  const ownerOf = (id: number | null) => (id === null ? undefined : state.civs[id]);
  const realmStats = (c: Civ) => {
    const provs = state.provinces.filter((p) => p.owner === c.id);
    return {
      provinces: provs.length,
      population: provs.reduce((s, p) => s + p.population, 0),
      strength: state.armies
        .filter((a) => a.owner === c.id)
        .reduce((s, a) => s + a.strength, 0),
    };
  };

  return (
    <div className="noeterra-game relative h-full w-full overflow-hidden bg-[#081a20]">
      <h1 className="sr-only">
        Noeterra — {state.scenario.name}, {state.date}
      </h1>
      <WorldMap
        state={state}
        geometry={geometry}
        selected={selected}
        focus={focus}
        you={you}
        onSelect={selectProvince}
      />

      {/* Session chip */}
      <div className="absolute top-3 left-3 z-20 flex items-center gap-2">
        <button
          type="button"
          onClick={onExit}
          aria-label="Back to the worlds"
          className={cn(glass, "grid size-10 place-items-center hover:bg-white/10")}
        >
          <Menu className="size-5" aria-hidden="true" />
        </button>
        <div className={cn(glass, "flex items-center gap-2.5 px-3 py-1.5")}>
          {youCiv ? (
            <Emblem civ={youCiv} size={24} />
          ) : (
            <Sparkles className="size-5 text-amber-200" aria-hidden="true" />
          )}
          <div className="min-w-0 leading-tight">
            <p className="text-sm font-semibold">Noeterra</p>
            <p className="max-w-[calc(100vw-8rem)] truncate text-[11px] text-white/60 sm:max-w-none">
              {state.scenario.name} / {youCiv ? youCiv.name : "Observer"} / {state.date}
            </p>
          </div>
        </div>
        <Link
          to="/"
          className={cn(
            glass,
            "hidden items-center gap-1.5 px-3 py-2 text-xs hover:bg-white/10 sm:inline-flex",
          )}
        >
          <MoveLeft className="size-3.5" aria-hidden="true" /> Lop Nur twin
        </Link>
      </div>

      {/* Date and jump forward */}
      <div
        className={cn(
          glass,
          "absolute top-[4.25rem] right-3 z-20 flex items-center gap-1 p-1 sm:top-3",
        )}
      >
        <span className="px-3 text-sm font-semibold" aria-live="polite">
          {state.date}
        </span>
        {(
          [
            [1, "1 season", ChevronsRight],
            [4, "1 year", FastForward],
            [20, "5 years", FastForward],
          ] as const
        ).map(([n, label, Icon]) => (
          <button
            key={n}
            ref={n === 1 ? jumpRef : undefined}
            type="button"
            aria-label={n === 1 ? undefined : label}
            disabled={busy}
            onClick={() => jump(n)}
            className={cn(
              "inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold disabled:opacity-40",
              n === 1 ? "nt-jump text-white" : "text-white/80 hover:bg-white/10",
            )}
          >
            <Icon className="size-3.5" aria-hidden="true" />
            {n === 1 ? (
              busy ? (
                "Resolving…"
              ) : you !== null && !fallen ? (
                "Jump forward"
              ) : (
                "Next season"
              )
            ) : (
              <span className="hidden sm:inline">{label}</span>
            )}
          </button>
        ))}
      </div>

      {/* Events */}
      {leftOpen && (
        <section
          aria-labelledby="nt-events"
          className={cn(
            glass,
            "absolute top-32 left-3 z-10 flex max-h-[calc(100%-13rem)] w-[340px] max-w-[calc(100vw-1.5rem)] flex-col sm:top-20 sm:max-h-[calc(100%-10rem)]",
          )}
        >
          <header className="flex items-start justify-between border-b border-white/10 px-4 py-3">
            <div>
              <h2 id="nt-events" className="text-base font-bold">
                Events
              </h2>
              <p className="text-[11px] text-white/55">
                {playback
                  ? `${playback.from} → ${playback.to}`
                  : "Jump forward to see what happens."}
              </p>
            </div>
            <button
              type="button"
              aria-label="Close events"
              onClick={() => setLeftOpen(false)}
              className="rounded p-1 hover:bg-white/10"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </header>
          <ol className="flex-1 space-y-3 overflow-y-auto p-3" aria-live="polite">
            {(playback ? shownEvents : state.events.slice(-12)).map((e, i) => {
              const h = eventHeading(e.kind, e.text);
              return (
                <li key={`${e.turn}-${i}`}>
                  <button
                    type="button"
                    onClick={() => setSelected(e.provinces[0] ?? null)}
                    className="w-full rounded-lg border border-white/10 bg-white/[0.03] p-3 text-left hover:border-white/25"
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] text-white/75">
                        {seasonOf(state.start_year, e.turn)}
                      </span>
                      <span
                        className={cn(
                          "rounded-md px-1.5 py-0.5 text-[10px] ring-1",
                          CATEGORY_STYLE[h.category],
                        )}
                      >
                        {h.category}
                      </span>
                    </div>
                    <h3 className="mt-2 text-xs font-bold tracking-wide uppercase">
                      {h.title}
                    </h3>
                    <p className="mt-1 text-[13px] leading-snug text-white/80">
                      {e.text}
                    </p>
                  </button>
                </li>
              );
            })}
            {playback && playback.events.length === 0 && (
              <li className="text-sm text-white/60">
                A quiet season: nothing of note happened.
              </li>
            )}
          </ol>
          {playback && playback.shown < playback.events.length && (
            <div className="space-y-2 border-t border-white/10 p-3">
              <button
                type="button"
                onClick={() => setPlayback({ ...playback, shown: playback.shown + 1 })}
                className="w-full rounded-lg border border-white/15 py-2 text-xs font-semibold hover:bg-white/10"
              >
                Next event
              </button>
              <button
                type="button"
                onClick={() =>
                  setPlayback({ ...playback, shown: playback.events.length })
                }
                className="w-full rounded-lg py-1.5 text-xs text-white/70 hover:bg-white/5"
              >
                Skip to end ({playback.events.length - playback.shown} more)
              </button>
            </div>
          )}
        </section>
      )}

      {/* Nation panel */}
      {rightOpen && view && (
        <aside
          aria-label="Nation"
          className={cn(
            glass,
            "absolute top-32 right-3 bottom-20 z-10 flex w-[380px] max-w-[calc(100vw-1.5rem)] flex-col sm:top-16",
          )}
        >
          <div
            role="tablist"
            aria-label="Panels"
            className="flex gap-1 border-b border-white/10 p-1.5"
          >
            {(
              [
                ["realm", "Realm", Landmark],
                ...(you !== null ? ([["orders", "Orders", ListChecks]] as const) : []),
                ["diplomacy", "Diplomacy", Handshake],
                ["advisor", you !== null ? "Advisor" : "Mind", BookOpen],
              ] as const
            ).map(([id, label, Icon]) => (
              <button
                key={id}
                role="tab"
                type="button"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={cn(
                  "inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold",
                  tab === id
                    ? "bg-white/10 text-white"
                    : "text-white/60 hover:text-white",
                )}
              >
                <Icon className="size-3.5" aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto p-3" role="tabpanel">
            {tab === "realm" && (
              <>
                <div className="flex items-start gap-3">
                  <Emblem civ={view} size={44} />
                  <div className="min-w-0">
                    <h2 className="text-lg font-bold">{view.name}</h2>
                    <span
                      className={cn(
                        "inline-block rounded-md px-1.5 py-0.5 text-[10px] font-bold",
                        view.id === you
                          ? "bg-amber-400 text-black"
                          : "bg-white/10 text-white/80",
                      )}
                    >
                      {view.id === you
                        ? "Your nation"
                        : `Autonomous agent · ${state.seats[view.id]?.brain ?? ""}`}
                    </span>
                    <p className="mt-1 text-xs text-white/65">
                      {state.provinces[view.capital]?.name} · {view.government}
                    </p>
                    <p className="text-xs text-amber-200">Ruler: {view.ruler}</p>
                    {!view.alive && (
                      <p className="text-xs font-bold text-red-300">
                        This power has fallen.
                      </p>
                    )}
                  </div>
                </div>
                {(you === null || reveal) && (
                  <label className="flex items-center gap-2 text-xs text-white/70">
                    Nation
                    <select
                      value={view.id}
                      onChange={(e) => setFocusCiv(Number(e.target.value))}
                      className="flex-1 rounded-md border border-white/15 bg-black/40 px-2 py-1"
                    >
                      {state.civs.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                          {c.alive ? "" : " (fallen)"}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {/* The map selects a province by pointer; this is the same choice
                    for a keyboard or a screen reader. */}
                <label className="flex items-center gap-2 text-xs text-white/70">
                  Province
                  <select
                    value={selected ?? ""}
                    onChange={(e) =>
                      selectProvince(
                        e.target.value === "" ? null : Number(e.target.value),
                      )
                    }
                    className="flex-1 rounded-md border border-white/15 bg-black/40 px-2 py-1"
                  >
                    <option value="">Choose a province…</option>
                    {[...state.provinces]
                      .sort((a, b) => a.name.localeCompare(b.name))
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                          {p.owner !== null
                            ? ` — ${state.civs[p.owner]?.name ?? ""}`
                            : " — unclaimed"}
                        </option>
                      ))}
                  </select>
                </label>
                <Bar label="Stability" value={view.stability} />
                <Bar label="War weariness" value={view.war_weariness} tone="bg-red-400" />
                {(() => {
                  const s = realmStats(view);
                  const m = view.id === you ? yourMind : mind;
                  return (
                    <div className="grid grid-cols-2 gap-2">
                      <Tile
                        label="Treasury"
                        value={`${fmt(view.treasury)} gold`}
                        sub={
                          m
                            ? `+${fmt(m.income, 1)} / −${fmt(m.upkeep, 1)} a season`
                            : undefined
                        }
                        tone={view.treasury < 0 ? "text-red-300" : "text-emerald-300"}
                      />
                      <Tile label="Manpower" value={`${fmt(view.manpower, 1)}k`} />
                      <Tile label="Field armies" value={`${fmt(s.strength, 1)}k`} />
                      <Tile label="Provinces" value={String(s.provinces)} />
                      <Tile
                        label="Population"
                        value={`${fmt(s.population / 1000, 2)}M`}
                      />
                      <Tile
                        label="Learning"
                        value={fmt(view.tech, 2)}
                        sub={`Prestige ${fmt(view.prestige)}`}
                      />
                    </div>
                  );
                })()}
                <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                  <h3 className="text-[11px] font-semibold tracking-[0.12em] text-white/70 uppercase">
                    Temperament
                  </h3>
                  <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
                    {TRAITS.map((t) => (
                      <div key={t} className="text-[11px]">
                        <div className="flex justify-between text-white/70">
                          <span className="capitalize">{t}</span>
                          <span>{fmt(view.personality[t], 2)}</span>
                        </div>
                        <div className="h-1 rounded bg-white/10">
                          <div
                            className="h-1 rounded bg-fuchsia-400"
                            style={{ width: `${view.personality[t] * 100}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <Spark state={state} civ={view.id} />
              </>
            )}

            {tab === "orders" && you !== null && (
              <OrdersPanel
                offers={offers}
                picked={picked}
                pickedArmies={pickedArmies}
                toggle={toggleOffer}
                rejected={state.last_turn?.rejected.filter((r) => r.civ === you) ?? []}
                goals={human?.goals ?? []}
                fallen={fallen}
              />
            )}

            {tab === "diplomacy" && (
              <>
                {you !== null && human && human.proposals.length > 0 && (
                  <div className="rounded-lg border border-amber-300/30 bg-amber-300/5 p-3">
                    <h3 className="text-sm font-bold">Awaiting your answer</h3>
                    <ul className="mt-2 space-y-2">
                      {human.proposals.map((p) => (
                        <li key={p.id} className="text-[13px]">
                          <p>{p.text}</p>
                          <div className="mt-1 flex gap-2">
                            {[true, false].map((v) => (
                              <button
                                key={String(v)}
                                type="button"
                                aria-pressed={(answers[p.id] ?? false) === v}
                                onClick={() => setAnswers((a) => ({ ...a, [p.id]: v }))}
                                className={cn(
                                  "rounded-md px-2.5 py-1 text-xs font-semibold",
                                  (answers[p.id] ?? false) === v
                                    ? v
                                      ? "bg-emerald-500 text-black"
                                      : "bg-red-500/80"
                                    : "bg-white/10",
                                )}
                              >
                                {v ? "Accept" : "Refuse"}
                              </button>
                            ))}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {you !== null && (
                  <LetterBox
                    state={state}
                    you={you}
                    letters={letters}
                    onAdd={(l) => setLetters((ls) => (ls.length >= 3 ? ls : [...ls, l]))}
                    onRemove={(i) => setLetters((ls) => ls.filter((_, j) => j !== i))}
                  />
                )}
                <Relations
                  state={state}
                  civ={view.id}
                  mind={view.id === you ? yourMind : null}
                />
                {state.wars.length > 0 && (
                  <div>
                    <h3 className="text-[11px] font-semibold tracking-[0.12em] text-white/70 uppercase">
                      Wars
                    </h3>
                    <ul className="mt-1 space-y-1 text-[13px]">
                      {state.wars.map((w) => (
                        <li key={w.id}>
                          {w.attackers
                            .map((a) => shortName(ownerOf(a)?.name ?? ""))
                            .join(", ")}{" "}
                          against{" "}
                          {w.defenders
                            .map((d) => shortName(ownerOf(d)?.name ?? ""))
                            .join(", ")}
                          <span className="text-white/50"> · {w.battles} battles</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}

            {tab === "advisor" && (
              <MindPanel
                state={state}
                mind={mind}
                civ={view}
                you={you}
                reveal={reveal}
                setReveal={setReveal}
              />
            )}
          </div>

          {you !== null && (
            <footer className="border-t border-white/10 p-3">
              <p className="mb-2 text-[11px] text-white/60">
                {picked.length}/{MAX_ORDERS} orders · {letters.length} letters ·{" "}
                {human ? `${human.proposals.length} proposals` : "no seat"}
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() => jump(1)}
                className="nt-jump w-full rounded-lg py-2.5 text-sm font-bold disabled:opacity-40"
              >
                {busy
                  ? "Resolving the season…"
                  : fallen
                    ? "Watch the next season"
                    : "Issue orders and jump forward"}
              </button>
            </footer>
          )}
        </aside>
      )}

      {/* Province card */}
      {province && geometry && (
        <section
          aria-label={`Province ${province.name}`}
          className={cn(
            glass,
            "absolute bottom-20 left-1/2 z-20 w-[420px] max-w-[calc(100vw-1.5rem)] -translate-x-1/2 p-3",
          )}
        >
          <div className="flex items-start justify-between">
            <div>
              <h2 className="font-bold">{province.name}</h2>
              <p className="text-xs text-white/65">
                {ownerOf(province.owner)?.name ?? "Independent"}
                {province.controller !== province.owner && province.controller !== null
                  ? ` · occupied by ${ownerOf(province.controller)?.name ?? ""}`
                  : ""}{" "}
                · {province.terrain}
              </p>
            </div>
            <button
              type="button"
              aria-label="Close province"
              onClick={() => setSelected(null)}
              className="rounded p-1 hover:bg-white/10"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
          <dl className="mt-2 grid grid-cols-4 gap-2 text-center text-[11px]">
            {(
              [
                ["People", `${fmt(province.population)}k`],
                ["Development", fmt(province.development, 1)],
                ["Fort", String(province.fort)],
                ["Unrest", fmt(province.unrest)],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="rounded-md bg-white/5 py-1">
                <dt className="text-white/55">{k}</dt>
                <dd className="font-bold">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-[12px] text-white/70">
            Armies:{" "}
            {state.armies
              .filter((a) => a.location === province.id)
              .map(
                (a) =>
                  `${shortName(ownerOf(a.owner)?.name ?? "")} ${fmt(a.strength, 1)}k`,
              )
              .join(", ") || "none"}
            {province.owner === null &&
              ` · local resistance ${fmt(province.natives, 1)}k`}
            {province.claims.length > 0 &&
              ` · claimed by ${province.claims.map((c) => shortName(ownerOf(c)?.name ?? "")).join(", ")}`}
          </p>
          {you !== null && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {offers
                .filter((o) => targets(o.action).includes(province.id))
                .map((o) => (
                  <button
                    key={o.index}
                    type="button"
                    aria-pressed={picked.includes(o.index)}
                    onClick={() => toggleOffer(o)}
                    className={cn(
                      "rounded-md px-2 py-1 text-[11px]",
                      picked.includes(o.index)
                        ? "bg-amber-400 text-black"
                        : "bg-white/10 hover:bg-white/20",
                    )}
                  >
                    {o.text.replace(/ \(.*\)$/, "")}
                  </button>
                ))}
            </div>
          )}
        </section>
      )}

      {/* Toolbar */}
      <nav aria-label="Tools" className="absolute bottom-3 left-3 z-20 flex gap-1.5">
        {(
          [
            ["Events", ScrollText, () => setLeftOpen(!leftOpen)],
            ["Nation panel", PanelRight, () => setRightOpen(!rightOpen)],
            [
              "Verify replay",
              ShieldCheck,
              () => {
                const r = engine.verify(session);
                setToast(
                  r.ok
                    ? `Replay verified: ${r.turns_checked} seasons reproduce every recorded state hash.`
                    : `Replay diverged at season ${r.first_divergence ?? "?"}: ${r.reason ?? ""}`,
                );
              },
            ],
            [
              "Save history",
              Download,
              () => {
                const blob = new Blob([JSON.stringify(engine.save(session))], {
                  type: "application/json",
                });
                const a = document.createElement("a");
                a.href = URL.createObjectURL(blob);
                a.download = `noeterra-${state.scenario.id}-season${state.turn}.json`;
                a.click();
                URL.revokeObjectURL(a.href);
              },
            ],
            ["Load history", Upload, () => fileRef.current?.click()],
          ] as const
        ).map(([label, Icon, run]) => (
          <button
            key={label}
            type="button"
            aria-label={label}
            title={label}
            onClick={run}
            className={cn(glass, "grid size-10 place-items-center hover:bg-white/10")}
          >
            <Icon className="size-4" aria-hidden="true" />
          </button>
        ))}
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          aria-label="History file to load"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            void f.text().then((text) => {
              try {
                const loaded = engine.load(JSON.parse(text));
                // The save keeps the visitor's seat; hand it back to them rather
                // than leave their nation idle under an observer.
                const human = engine
                  .state(loaded.session, 0, false)
                  .seats.find((s) => s.seat.kind === "human");
                setGeometry(null);
                onReplace(
                  loaded.session,
                  human?.civ ?? null,
                  `Loaded and verified by replay: ${loaded.replay.turns_checked} seasons.`,
                );
              } catch (err) {
                setToast(
                  err instanceof Error
                    ? err.message
                    : "That file is not a Noeterra history.",
                );
              }
            });
          }}
        />
      </nav>

      <p
        role="note"
        className="pointer-events-none absolute right-3 bottom-[3.25rem] z-10 rounded-md bg-black/50 sm:bottom-3 px-2 py-1 text-[10px] tracking-wide text-amber-100/80"
      >
        Illustrative simulation of rule-based agents — not historical evidence
      </p>

      {toast && (
        <div
          role="status"
          className={cn(
            glass,
            "absolute top-20 left-1/2 z-30 max-w-lg -translate-x-1/2 px-4 py-2 text-sm",
          )}
        >
          {toast}
        </div>
      )}

      {fallen && !watching && (
        <div
          role="alertdialog"
          aria-labelledby="nt-fallen"
          aria-describedby="nt-fallen-text"
          className={cn(
            glass,
            "absolute top-1/3 left-1/2 z-30 w-[380px] max-w-[calc(100vw-1.5rem)] -translate-x-1/2 p-5 text-center",
          )}
        >
          <h2 id="nt-fallen" className="text-xl font-bold">
            Your realm has fallen
          </h2>
          <p id="nt-fallen-text" className="mt-2 text-sm text-white/75">
            The other nations go on. You can watch them, or choose another world.
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <button
              ref={watchOnRef}
              type="button"
              onClick={watchOn}
              className="nt-jump rounded-lg px-4 py-2 font-semibold"
            >
              Watch on
            </button>
            <button
              type="button"
              onClick={onExit}
              className="rounded-lg border border-white/15 px-4 py-2 font-semibold hover:bg-white/10"
            >
              Back to the worlds
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Spark({ state, civ }: { state: GameState; civ: number }) {
  const W = 340,
    H = 70;
  const max = Math.max(1, ...state.stats.flat().map((s) => s.provinces));
  const T = state.stats.length;
  const line = (c: number) =>
    state.stats
      .map(
        (row, t) =>
          `${((t / Math.max(1, T - 1)) * W).toFixed(1)},${(H - 4 - ((row[c]?.provinces ?? 0) / max) * (H - 8)).toFixed(1)}`,
      )
      .join(" ");
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
      <h3 className="text-[11px] font-semibold tracking-[0.12em] text-white/70 uppercase">
        Provinces held, all nations
      </h3>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="mt-2 w-full"
        role="img"
        aria-label="Provinces held by each nation over time"
      >
        {state.civs.map((c) => (
          <polyline
            key={c.id}
            points={line(c.id)}
            fill="none"
            stroke={c.color}
            strokeWidth={c.id === civ ? 2.4 : 1}
            opacity={c.id === civ ? 1 : 0.45}
          />
        ))}
      </svg>
    </div>
  );
}

function OrdersPanel({
  offers,
  picked,
  pickedArmies,
  toggle,
  rejected,
  goals,
  fallen,
}: {
  offers: Offer[];
  picked: number[];
  pickedArmies: Set<number>;
  toggle: (o: Offer) => void;
  rejected: { what: string; reason: string }[];
  goals: { text: string; weight: number }[];
  fallen: boolean;
}) {
  const [query, setQuery] = useState("");
  if (fallen)
    return <p className="text-sm text-white/70">You have no realm left to command.</p>;
  const q = query.trim().toLowerCase();
  const shown = offers.filter((o) => !q || o.text.toLowerCase().includes(q));
  const groups = (["Armies", "Realm", "Diplomacy"] as const).map(
    (g) => [g, shown.filter((o) => group(o.action) === g)] as const,
  );
  return (
    <>
      {goals.length > 0 && (
        <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
          <h3 className="text-[11px] font-semibold tracking-[0.12em] text-white/70 uppercase">
            Your court advises
          </h3>
          <ul className="mt-1 space-y-0.5 text-[13px]">
            {goals.slice(0, 4).map((g) => (
              <li key={g.text}>• {g.text}</li>
            ))}
          </ul>
        </div>
      )}
      {picked.length > 0 && (
        <div>
          <h3 className="text-[11px] font-semibold tracking-[0.12em] text-white/70 uppercase">
            This season&apos;s orders
          </h3>
          <ul className="mt-1 space-y-1">
            {picked.map((i) => {
              const o = offers[i];
              return o ? (
                <li
                  key={i}
                  className="flex items-center justify-between gap-2 rounded-md bg-amber-400/15 px-2 py-1 text-[12px]"
                >
                  <span>{o.text}</span>
                  <button
                    type="button"
                    aria-label={`Remove: ${o.text}`}
                    onClick={() => toggle(o)}
                    className="rounded p-0.5 hover:bg-white/10"
                  >
                    <X className="size-3.5" aria-hidden="true" />
                  </button>
                </li>
              ) : null;
            })}
          </ul>
        </div>
      )}
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search orders: a place, a power, an army…"
        aria-label="Search orders"
        className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm placeholder:text-white/40"
      />
      {groups.map(([g, list]) =>
        list.length ? (
          <fieldset key={g}>
            <legend className="text-[11px] font-semibold tracking-[0.12em] text-white/70 uppercase">
              {g}
            </legend>
            <ul className="mt-1 space-y-0.5">
              {list.map((o) => {
                const on = picked.includes(o.index);
                const blocked = !on && picked.length >= MAX_ORDERS;
                const swap =
                  !on && o.action.type === "move" && pickedArmies.has(o.action.army);
                return (
                  <li key={o.index}>
                    <label
                      className={cn(
                        "flex cursor-pointer items-start gap-2 rounded px-1.5 py-1 text-[12.5px] hover:bg-white/5",
                        blocked && "opacity-40",
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={blocked}
                        onChange={() => toggle(o)}
                        className="mt-0.5"
                      />
                      <span>
                        {o.text}
                        {swap && (
                          <span className="text-white/45">
                            {" "}
                            (replaces this army&apos;s move)
                          </span>
                        )}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </fieldset>
        ) : null,
      )}
      {rejected.length > 0 && (
        <div className="rounded-lg border border-red-400/30 bg-red-400/5 p-2 text-[12px]">
          <p className="font-semibold">Refused last season</p>
          <ul>
            {rejected.map((r, i) => (
              <li key={i}>
                {r.what} — {r.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-[11px] text-white/50">
        Orders are checked again when the season resolves; anything no longer possible is
        refused and reported.
      </p>
    </>
  );
}

function LetterBox({
  state,
  you,
  letters,
  onAdd,
  onRemove,
}: {
  state: GameState;
  you: number;
  letters: { to: number; text: string }[];
  onAdd: (l: { to: number; text: string }) => void;
  onRemove: (i: number) => void;
}) {
  const others = state.civs.filter((c) => c.alive && c.id !== you);
  const [to, setTo] = useState(others[0]?.id ?? 0);
  // The chosen nation may have fallen since; the select would then show another,
  // so the letter goes to what is shown, never to a power that cannot read it.
  const recipient = others.some((c) => c.id === to) ? to : (others[0]?.id ?? null);
  const [text, setText] = useState("");
  const inbox = state.messages
    .filter((m) => m.to === you)
    .slice(-6)
    .reverse();
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
      <h3 className="text-sm font-bold">Letters</h3>
      <ul className="mt-1 space-y-1.5 text-[12.5px]">
        {inbox.map((m, i) => (
          <li key={i}>
            <span className="font-semibold">
              {shortName(state.civs[m.from]?.name ?? "")}
            </span>{" "}
            <span className="rounded bg-white/10 px-1 text-[10px] text-white/60">
              {m.generation === "model"
                ? "model-written"
                : m.generation === "human"
                  ? "a person"
                  : "scripted"}
            </span>
            <q className="mt-0.5 block text-white/80 italic">{m.text}</q>
          </li>
        ))}
        {inbox.length === 0 && <li className="text-white/55">No letters yet.</li>}
      </ul>
      <div className="mt-2 flex gap-1.5">
        <select
          aria-label="Recipient"
          value={recipient ?? ""}
          onChange={(e) => setTo(Number(e.target.value))}
          className="rounded-md border border-white/15 bg-black/40 px-1.5 text-xs"
        >
          {others.map((c) => (
            <option key={c.id} value={c.id}>
              {shortName(c.name)}
            </option>
          ))}
        </select>
        <input
          aria-label="Letter"
          value={text}
          maxLength={400}
          onChange={(e) => setText(e.target.value)}
          placeholder="Your words to their ruler"
          className="min-w-0 flex-1 rounded-md border border-white/15 bg-black/30 px-2 py-1 text-xs"
        />
        <button
          type="button"
          disabled={!text.trim() || letters.length >= 3 || recipient === null}
          onClick={() => {
            if (recipient === null) return;
            onAdd({ to: recipient, text: text.trim() });
            setText("");
          }}
          className="rounded-md bg-white/10 px-2 text-xs font-semibold disabled:opacity-40"
        >
          Send
        </button>
      </div>
      {letters.length > 0 && (
        <ul className="mt-2 space-y-1 text-[12px]">
          {letters.map((l, i) => (
            <li
              key={i}
              className="flex justify-between gap-2 rounded bg-sky-400/10 px-2 py-1"
            >
              <span>
                To {shortName(state.civs[l.to]?.name ?? "")}: “{l.text}”
              </span>
              <button
                type="button"
                aria-label="Unsend letter"
                onClick={() => onRemove(i)}
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[11px] text-white/50">
        Letters arrive when the season resolves. Rulers here are rule-based agents: they
        weigh deeds, not words. Model rulers that read and answer letters run in the local
        workbench.
      </p>
    </div>
  );
}

function Relations({
  state,
  civ,
  mind,
}: {
  state: GameState;
  civ: number;
  mind: Mind | null;
}) {
  const rows = state.civs.filter((c) => c.alive && c.id !== civ);
  return (
    <div>
      <h3 className="text-[11px] font-semibold tracking-[0.12em] text-white/70 uppercase">
        Relations of {shortName(state.civs[civ]?.name ?? "")}
        {mind ? "" : " (true opinions — observer view)"}
      </h3>
      <ul className="mt-1 space-y-1.5">
        {rows.map((c) => {
          const belief = mind?.beliefs.find((b) => b.id === c.id);
          if (mind && belief && !belief.in_contact) return null;
          const opinion = state.opinion[civ]?.[c.id] ?? 0;
          const treaties = state.treaties.filter(
            (t) => (t.a === civ && t.b === c.id) || (t.b === civ && t.a === c.id),
          );
          const war = state.wars.some(
            (w) =>
              (w.attackers.includes(civ) && w.defenders.includes(c.id)) ||
              (w.defenders.includes(civ) && w.attackers.includes(c.id)),
          );
          return (
            <li
              key={c.id}
              className="rounded-md bg-white/[0.03] px-2 py-1.5 text-[12.5px]"
            >
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 font-semibold">
                  <span
                    className="inline-block size-2.5 rounded-sm"
                    style={{ background: c.color }}
                  />
                  {shortName(c.name)}
                </span>
                <span className="text-white/70">
                  {opinion > 0 ? "+" : ""}
                  {fmt(opinion)}
                </span>
              </div>
              <div className="relative mt-1 h-1 rounded bg-white/10">
                <div
                  className={cn(
                    "absolute top-0 h-1 rounded",
                    opinion >= 0 ? "left-1/2 bg-emerald-400" : "right-1/2 bg-red-400",
                  )}
                  style={{ width: `${Math.min(50, Math.abs(opinion) / 2)}%` }}
                />
              </div>
              <div className="mt-1 flex flex-wrap gap-1 text-[10px]">
                {war && <span className="rounded bg-red-500/30 px-1.5">at war</span>}
                {treaties.map((t) => (
                  <span key={t.kind} className="rounded bg-white/10 px-1.5">
                    {t.kind.replace("_", "-")}
                    {t.expires !== null ? " (truce)" : ""}
                  </span>
                ))}
                {belief && (
                  <span className="text-white/50">
                    trust {fmt(belief.trust, 2)} · strength ≈ {fmt(belief.strength_est)}k
                    · grievances {belief.grievances}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {state.proposals.length > 0 && (
        <p className="mt-2 text-[11px] text-white/50">
          Pending:{" "}
          {state.proposals
            .map(
              (p) =>
                `${shortName(state.civs[p.from]?.name ?? "")} → ${shortName(state.civs[p.to]?.name ?? "")}: ${describeTerms(p.terms)}`,
            )
            .join("; ")}
        </p>
      )}
    </div>
  );
}

function MindPanel({
  state,
  mind,
  civ,
  you,
  reveal,
  setReveal,
}: {
  state: GameState;
  mind: Mind | null;
  civ: Civ;
  you: number | null;
  reveal: boolean;
  setReveal: (v: boolean) => void;
}) {
  return (
    <>
      {you !== null && (
        <label className="flex items-center gap-2 text-[12px] text-white/70">
          <input
            type="checkbox"
            checked={reveal}
            onChange={(e) => setReveal(e.target.checked)}
          />
          Research view: read other nations&apos; minds (breaks the fog of war)
        </label>
      )}
      {you !== null && reveal && (
        <p className="text-[11px] text-white/50">
          Choose a nation on the map or in the Realm tab.
        </p>
      )}
      {!mind ? (
        <p className="text-sm text-white/65">
          {civ.name}&apos;s counsels are its own. Turn on the research view, or select one
          of your provinces.
        </p>
      ) : (
        <>
          <p className="text-[12px] text-white/60">
            {civ.id === you
              ? "What your court sees"
              : `What ${shortName(civ.name)}'s agent sees`}{" "}
            — goals derived by the host, beliefs built from what the realm witnessed.
          </p>
          <div>
            <h3 className="text-[11px] font-semibold tracking-[0.12em] text-white/70 uppercase">
              Goals
            </h3>
            <ul className="mt-1 space-y-0.5 text-[13px]">
              {mind.goals.map((g) => (
                <li key={g.text}>
                  • {g.text} <span className="text-white/45">({fmt(g.weight, 2)})</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="text-[11px] font-semibold tracking-[0.12em] text-white/70 uppercase">
              Memories
            </h3>
            <ol className="mt-1 space-y-1 text-[12.5px]">
              {mind.memory.entries
                .slice(-14)
                .reverse()
                .map((m, i) => (
                  <li key={i} className="flex gap-2">
                    <span
                      className={cn(
                        "mt-1.5 inline-block size-1.5 shrink-0 rounded-full",
                        m.valence < 0
                          ? "bg-red-400"
                          : m.valence > 0
                            ? "bg-emerald-400"
                            : "bg-white/40",
                      )}
                    />
                    <span>
                      <span className="text-white/50">
                        {seasonOf(state.start_year, m.turn)} ·{" "}
                      </span>
                      {m.text}
                    </span>
                  </li>
                ))}
              {mind.memory.entries.length === 0 && (
                <li className="text-white/55">Nothing memorable yet.</li>
              )}
            </ol>
          </div>
          {mind.chronicle.length > 0 && (
            <div>
              <h3 className="text-[11px] font-semibold tracking-[0.12em] text-white/70 uppercase">
                Older memory
              </h3>
              <ul className="mt-1 text-[12px] text-white/70">
                {mind.chronicle.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <h3 className="text-[11px] font-semibold tracking-[0.12em] text-white/70 uppercase">
              Recent decisions
            </h3>
            <ul className="mt-1 space-y-1.5 text-[12.5px]">
              {mind.recent_decisions
                .filter((r) => r.decision)
                .map((r) => (
                  <li key={r.turn}>
                    <span className="mr-1 rounded bg-white/10 px-1 text-[10px] font-bold">
                      {LABEL_TEXT[r.decision?.label ?? ""] ?? r.decision?.label}
                    </span>
                    <span className="text-white/50">{r.date}: </span>
                    {r.decision?.chosen.length ? r.decision.chosen.join("; ") : "waited"}
                    {r.rejected.length > 0 && (
                      <span className="text-red-300">
                        {" "}
                        · refused: {r.rejected.map((x) => x.reason).join("; ")}
                      </span>
                    )}
                  </li>
                ))}
            </ul>
          </div>
        </>
      )}
    </>
  );
}
