import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { game } from "../core/gameState";
import { useGameStore, type BrainKind } from "../core/gameStore";
import { AXES, type Axis } from "../pilot/contract";
import { pilot, type ControlLabel, type PilotStatus } from "../pilot/pilot";
import { probeJevService, type JevServiceStatus } from "../pilot/providers";
import { storeTraceLocally } from "../pilot/traceStorage";
import { parseTrace } from "../pilot/recorder";

/**
 * The pilot's status panel and the controls that go with it.
 *
 * `JevHud` sits above the ammo readout while a brain has the player, and says
 * three things plainly: who is in control (LIVE JEV, FALLBACK, RANDOM or
 * REPLAY — only a TypeSafe answer is ever labelled LIVE JEV), what it is doing,
 * and how to take the controls back. It repaints from the pilot's telemetry
 * singleton on its own ~8 Hz timer; nothing on the frame loop touches React.
 *
 * `PlayerControlSelector` is the HUMAN / JEV / RANDOM / REPLAY choice on the
 * main and pause menus.
 */

const LABEL_COLOR: Record<ControlLabel, string> = {
  "LIVE JEV": "#4da3ff",
  FALLBACK: "#ffb648",
  RANDOM: "#cbd5e1",
  REPLAY: "#c4a1ff",
  HUMAN: "#e2e8f0",
};

const STATUS_ALERT: ReadonlySet<PilotStatus> = new Set([
  "TIMEOUT",
  "UNAVAILABLE",
  "ERROR",
  "DEAD",
]);

const AXIS_NAMES: Record<Axis, string> = {
  move: "MOVE",
  turn: "TURN",
  tilt: "TILT",
  weapon: "WEAPON",
  target: "TARGET",
  aim: "AIM",
};

const GATE_NAMES: Record<string, string> = {
  idle: "—",
  tracking: "TRACKING",
  settling: "ADS SETTLING",
  open: "TRIGGER OPEN",
  held: "TRIGGER HELD",
};

function fmtP(value: number): string {
  return value >= 0.995 ? "1.00" : value.toFixed(2).replace(/^0/, "");
}

function downloadTrace(): void {
  const text = pilot.exportTrace();
  if (!text) return;
  storeTraceLocally(text);
  const blob = new Blob([text], { type: "application/x-ndjson" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `blacksite-jev-trace-${Date.now().toString(36)}.jsonl`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function JevHud() {
  const brain = useGameStore((s) => s.brain);
  const rootRef = useRef<HTMLElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  const statusRef = useRef<HTMLSpanElement>(null);
  const axisRefs = useRef<Record<Axis, HTMLDivElement | null>>({
    move: null,
    turn: null,
    tilt: null,
    weapon: null,
    target: null,
    aim: null,
  });
  const motorRef = useRef<HTMLDivElement>(null);
  const statsRef = useRef<HTMLDivElement>(null);
  const metaRef = useRef<HTMLDivElement>(null);
  const targetRef = useRef<HTMLDivElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (brain === "human") return undefined;
    let handle = 0;
    let last = 0;
    const paint = (now: number): void => {
      handle = requestAnimationFrame(paint);
      if (now - last < 120) return;
      last = now;
      const t = pilot.telemetry;
      const root = rootRef.current;
      if (!root) return;
      root.dataset["jevLabel"] = t.label;
      root.dataset["jevStatus"] = t.status;
      if (labelRef.current) {
        // Nothing is live while the service cannot answer; say so plainly.
        labelRef.current.textContent =
          t.label === "LIVE JEV" && t.status === "UNAVAILABLE"
            ? "JEV UNAVAILABLE"
            : t.label;
        labelRef.current.style.color =
          t.status === "UNAVAILABLE" ? "#ff8a80" : LABEL_COLOR[t.label];
      }
      if (statusRef.current) {
        statusRef.current.textContent = t.status.replace("_", " ");
        statusRef.current.style.color = STATUS_ALERT.has(t.status)
          ? "#ff5a4d"
          : "#e2e8f0";
      }
      for (const axis of AXES) {
        const row = axisRefs.current[axis];
        if (!row) continue;
        // Target and aim exist only under precision control.
        row.hidden = (axis === "target" || axis === "aim") && t.control !== "precision";
        const choice = t.frame ? t.frame[axis] : "—";
        const answer = t.axes?.[axis];
        const engagement = axis === "target" || axis === "aim";
        const top = engagement
          ? []
          : answer
            ? answer.probabilities
                .slice(0, 3)
                .map(([option, p]) => `${option} ${fmtP(p)}`)
            : t.frame
              ? [
                  t.brain === "random" || t.label === "FALLBACK"
                    ? "uniform over legal options"
                    : "no probabilities recorded",
                ]
              : [];
        const unasked = engagement && t.frame !== null && t.axes !== null && !answer;
        const [head, detail] = row.children as unknown as [HTMLElement, HTMLElement];
        head.textContent = `${AXIS_NAMES[axis].padEnd(7)}${choice.padEnd(17)}${answer ? `P ${fmtP(answer.probabilities[0]?.[1] ?? 0)} CONF ${fmtP(answer.confidence)}` : unasked ? "NOT ASKED" : ""}`;
        // One element per candidate, so a long top three wraps between
        // candidates instead of cutting the third one off.
        const key = top.join("\n");
        if (detail.dataset["shown"] !== key) {
          detail.dataset["shown"] = key;
          detail.replaceChildren(
            ...top.map((text) => {
              const item = document.createElement("span");
              item.textContent = text;
              return item;
            }),
          );
        }
      }
      if (motorRef.current) {
        const m = t.motor;
        motorRef.current.textContent =
          t.control !== "precision"
            ? "CONTROL DIRECT · STEPPED TURNS BY THE BRAIN"
            : m.bound
              ? `PRECISION · ${m.heldAim ?? m.aim ?? ""}${m.heldAim && m.heldAim !== m.aim ? "*" : ""} · ERR ${m.errorDeg === null ? "—" : `${m.errorDeg.toFixed(2)}°`} · ${GATE_NAMES[m.gate] ?? m.gate}${m.distanceM === null ? "" : ` · ${Math.round(m.distanceM)} M`}`
              : "PRECISION · NO TARGET TRACKED";
      }
      if (statsRef.current) {
        const accuracy = t.shots > 0 ? `${Math.round((t.hits / t.shots) * 100)}%` : "—";
        statsRef.current.textContent = `ACC ${accuracy} · HITS ${t.hits}/${t.shots} · K/D ${t.kills}/${t.deaths}`;
      }
      if (metaRef.current) {
        const latency = t.latencyMs === null ? "—" : `${Math.round(t.latencyMs)} ms`;
        const source = t.model ?? (t.brain === "random" ? `seed ${t.seed}` : "—");
        metaRef.current.textContent = `LATENCY ${latency} · TICK ${t.executingSequence ?? t.sequence} · ${source}`;
      }
      if (targetRef.current) {
        const target = t.target;
        const hud = game.hud;
        const targetText = target
          ? `${Math.round(target.distanceM)} m ${target.bearingDeg >= 0 ? "+" : ""}${Math.round(target.bearingDeg)}°${target.onCrosshair ? " ON CROSSHAIR" : ""}`
          : "none in view";
        targetRef.current.textContent = `TARGET ${targetText} · HP ${Math.round(hud.health)} · AMMO ${hud.ammo}/${hud.reserve}`;
      }
      if (errorRef.current) {
        errorRef.current.textContent =
          STATUS_ALERT.has(t.status) && t.lastError ? t.lastError : "";
      }
    };
    handle = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(handle);
  }, [brain]);

  if (brain === "human") return null;

  const title = brain === "jev" ? "JEV" : brain.toUpperCase();
  return (
    <section
      ref={rootRef}
      aria-label={`${title} player control status`}
      data-jev-hud=""
      className="pointer-events-none absolute right-9 bottom-[7.5rem] z-30 w-[312px] max-w-[calc(100vw-24px)] cursor-auto border border-white/10 bg-[#07090d]/75 px-3 py-2 font-mono text-[10px] leading-[1.4] tracking-[0.06em] text-slate-300 uppercase backdrop-blur-sm [clip-path:polygon(10px_0,100%_0,100%_calc(100%-10px),calc(100%-10px)_100%,0_100%,0_10px)]"
    >
      <div className="flex items-baseline justify-between border-b border-white/10 pb-1.5">
        <span className="font-semibold tracking-[0.22em] text-slate-400">
          {title} // Blacksite
        </span>
        <span className="flex gap-2">
          <span ref={labelRef} className="font-bold tracking-[0.18em]" />
          <span ref={statusRef} className="tracking-[0.14em]" />
        </span>
      </div>
      <div className="mt-1 space-y-0.5">
        {AXES.map((axis) => (
          <div
            key={axis}
            ref={(element) => {
              axisRefs.current[axis] = element;
            }}
          >
            <div className="whitespace-pre text-slate-100" />
            <div className="flex flex-wrap gap-x-[1.5ch] pl-[7ch] text-[9px] text-slate-400 normal-case *:whitespace-nowrap" />
          </div>
        ))}
      </div>
      <div ref={motorRef} className="mt-1.5 truncate text-[#9fd0ff]" />
      <div ref={statsRef} className="truncate text-slate-300" />
      <div ref={metaRef} className="truncate text-slate-400" />
      <div ref={targetRef} className="truncate text-slate-400" />
      <div ref={errorRef} className="truncate text-[#ff8a80] normal-case" />
      <p className="mt-0.5 truncate text-[9px] tracking-[0.1em] text-slate-400 normal-case">
        {brain === "jev"
          ? "Jev chooses · local controller executes · Blacksite decides"
          : brain === "random"
            ? "Seeded random policy · same controls, same timing"
            : "Recorded controls played back · not live"}
      </p>
      <div className="pointer-events-auto mt-1.5 flex gap-2">
        <button
          type="button"
          aria-keyshortcuts="H"
          onClick={() => pilot.takeover()}
          className="flex-1 bg-[#4da3ff] px-3 py-1 text-[10px] font-bold tracking-[0.2em] text-[#05070a] hover:bg-[#6fb6ff] focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:outline-none"
        >
          Take control · H
        </button>
        {brain !== "replay" && (
          <button
            type="button"
            onClick={downloadTrace}
            className="bg-white/[0.08] px-3 py-1 text-[10px] font-semibold tracking-[0.18em] text-slate-200 hover:bg-white/[0.15] focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:outline-none"
          >
            Save trace
          </button>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Menu selector                                                       */
/* ------------------------------------------------------------------ */

const CHOICES: { id: BrainKind; name: string }[] = [
  { id: "human", name: "Human" },
  { id: "jev", name: "Jev" },
  { id: "random", name: "Random" },
  { id: "replay", name: "Replay" },
];

export function PlayerControlSelector() {
  const brain = useGameStore((s) => s.brain);
  const setBrain = useGameStore((s) => s.setBrain);
  const seed = useGameStore((s) => s.brainSeed);
  const trace = useGameStore((s) => s.replayTrace);
  const setReplayTrace = useGameStore((s) => s.setReplayTrace);
  const control = useGameStore((s) => s.jevControl);
  const setControl = useGameStore((s) => s.setJevControl);
  const profile = useGameStore((s) => s.playerProfile);
  const setProfile = useGameStore((s) => s.setPlayerProfile);
  const [service, setService] = useState<JevServiceStatus | null>(null);
  const [traceError, setTraceError] = useState<string | null>(null);

  useEffect(() => {
    if (brain !== "jev") return undefined;
    const controller = new AbortController();
    void probeJevService(undefined, controller.signal).then((status) => {
      if (!controller.signal.aborted) setService(status);
    });
    return () => controller.abort();
  }, [brain]);

  const loadTrace = (file: File): void => {
    void file.text().then((text) => {
      const parsed = parseTrace(text);
      if (parsed.ok) {
        setTraceError(null);
        setReplayTrace(parsed.trace);
      } else {
        setTraceError(parsed.error);
      }
    });
  };

  return (
    <div className="mt-6 border-t border-white/10 pt-5">
      <div
        id="player-control-label"
        className="text-[10px] font-semibold tracking-[0.4em] text-slate-400 uppercase"
      >
        Player control
      </div>
      <div
        role="group"
        aria-labelledby="player-control-label"
        className="mt-3 grid grid-cols-4 gap-2"
      >
        {CHOICES.map((choice) => (
          <button
            key={choice.id}
            type="button"
            aria-pressed={brain === choice.id}
            onClick={() => setBrain(choice.id)}
            className={cn(
              "border-l-2 px-3 py-2 text-left text-[12px] font-semibold tracking-[0.16em] uppercase transition-colors focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none",
              brain === choice.id
                ? "border-[#4da3ff] bg-white/[0.1] text-slate-100"
                : "border-transparent bg-white/[0.04] text-slate-300 hover:bg-white/[0.08]",
            )}
          >
            {choice.name}
          </button>
        ))}
      </div>
      {brain === "human" ? (
        <div
          role="group"
          aria-label="Aim profile"
          className="mt-2 grid grid-cols-2 gap-2 font-mono text-[10px] tracking-[0.14em] uppercase"
        >
          {(
            [
              ["standard", "Standard aim"],
              ["elite", "Elite Operator"],
            ] as const
          ).map(([id, name]) => (
            <button
              key={id}
              type="button"
              aria-pressed={profile === id}
              onClick={() => setProfile(id)}
              className={cn(
                "px-3 py-1.5 text-left focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none",
                profile === id
                  ? "bg-white/[0.12] text-slate-100"
                  : "bg-white/[0.04] text-slate-400 hover:bg-white/[0.08]",
              )}
            >
              {name}
            </button>
          ))}
        </div>
      ) : (
        <div
          role="group"
          aria-label="Aim control"
          className="mt-2 grid grid-cols-2 gap-2 font-mono text-[10px] tracking-[0.14em] uppercase"
        >
          {(
            [
              ["precision", "Precision control"],
              ["direct", "Direct control"],
            ] as const
          ).map(([id, name]) => (
            <button
              key={id}
              type="button"
              aria-pressed={control === id}
              onClick={() => setControl(id)}
              className={cn(
                "px-3 py-1.5 text-left focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none",
                control === id
                  ? "bg-white/[0.12] text-slate-100"
                  : "bg-white/[0.04] text-slate-400 hover:bg-white/[0.08]",
              )}
            >
              {name}
            </button>
          ))}
        </div>
      )}
      <p className="mt-3 text-[11px] leading-relaxed text-slate-400">
        {brain === "human" &&
          (profile === "elite"
            ? "Keyboard and mouse with Elite Operator: target friction, gentle aimed tracking help and learned recoil help. It never fires for you and the mouse always overrides it."
            : "Keyboard and mouse. The default.")}
        {brain === "jev" &&
          (control === "precision"
            ? "Jev chooses where to move, which visible enemy to engage and where on it; a deterministic local controller executes that aim and trigger discipline at frame rate. Blacksite still decides every hit. Press H to take control."
            : "Jev turns the view itself in fixed steps, the original interface. Blacksite still controls the world: physics, hits, damage and scoring. Press H in the match to take control.")}
        {brain === "random" &&
          `A seeded random policy (seed ${seed}) picks from the same controls on the same timing. A baseline, not Jev.`}
        {brain === "replay" &&
          "Plays back a recorded trace through the same controls. Not a live model."}
      </p>
      {brain === "jev" && (
        <p
          className={cn(
            "mt-2 font-mono text-[10px] tracking-[0.14em] uppercase",
            service === null
              ? "text-slate-400"
              : service.available
                ? "text-[#4da3ff]"
                : "text-[#ff8a80]",
          )}
        >
          {service === null
            ? "Checking the decision service…"
            : service.available
              ? `Jev ready · ${service.model ?? "model unknown"}`
              : `Jev unavailable — ${service.detail}`}
        </p>
      )}
      {brain === "replay" && (
        <div className="mt-2 flex items-center gap-3 font-mono text-[10px] tracking-[0.14em] uppercase">
          <label className="cursor-pointer bg-white/[0.08] px-3 py-1.5 text-slate-200 hover:bg-white/[0.15] focus-within:ring-2 focus-within:ring-white/70">
            Load trace
            <input
              type="file"
              accept=".jsonl,.ndjson,application/x-ndjson,text/plain"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) loadTrace(file);
              }}
            />
          </label>
          <span className={traceError ? "text-[#ff8a80] normal-case" : "text-slate-400"}>
            {traceError ??
              (trace
                ? `${trace.records.length} decisions · ${trace.header.brain} · seed ${trace.header.seed}`
                : "No trace loaded")}
          </span>
        </div>
      )}
    </div>
  );
}
