import { useEffect } from "react";
import { cn } from "@/lib/utils";
import { useGameStore, type GameScreen } from "../core/gameStore";
import { game } from "../core/gameState";
import { WEAPON_LIST, getWeapon } from "../weapons/arsenal";
import { CombatHud } from "./CombatHud";

/**
 * Screen shell: menus, killfeed and the in-game overlay.
 *
 * The menus render over the live scene, so they lean on a heavy scrim and
 * blur rather than an opaque background — you can always see the airfield
 * moving behind them, which is what a shipped shooter's frontend does.
 */

const TEAM_COLOR = { blue: "text-[#4da3ff]", red: "text-[#ff5a4d]" } as const;

/* ------------------------------------------------------------------ */
/* Chrome                                                              */
/* ------------------------------------------------------------------ */

function Scrim({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-[radial-gradient(ellipse_at_center,rgba(6,7,9,0.72),rgba(4,5,7,0.94))] backdrop-blur-[6px]">
      {children}
    </div>
  );
}

function TacticalButton({
  children,
  onClick,
  primary = false,
  className,
}: {
  children: React.ReactNode;
  onClick: () => void;
  primary?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative w-full px-6 py-3 text-left text-[13px] font-semibold uppercase tracking-[0.22em] transition-all duration-150",
        "[clip-path:polygon(14px_0,100%_0,100%_calc(100%-14px),calc(100%-14px)_100%,0_100%,0_14px)]",
        primary
          ? "bg-[#4da3ff] text-[#05070a] hover:bg-[#6fb6ff]"
          : "bg-white/[0.06] text-slate-200 hover:bg-white/[0.13] hover:text-white",
        className,
      )}
    >
      <span className="relative z-10">{children}</span>
    </button>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
}) {
  return (
    <label className="flex items-center gap-4 text-[11px] uppercase tracking-[0.18em] text-slate-400">
      <span className="w-40 shrink-0">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-white/15 accent-[#4da3ff]"
      />
      <span className="w-14 shrink-0 text-right font-mono text-slate-200">
        {format ? format(value) : value.toFixed(2)}
      </span>
    </label>
  );
}

function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onChange}
      className="flex items-center gap-4 text-[11px] uppercase tracking-[0.18em] text-slate-400 hover:text-slate-200"
    >
      <span className="w-40 shrink-0 text-left">{label}</span>
      <span
        className={cn(
          "flex h-4 w-9 items-center rounded-full p-0.5 transition-colors",
          value ? "bg-[#4da3ff]" : "bg-white/15",
        )}
      >
        <span
          className={cn(
            "h-3 w-3 rounded-full bg-white transition-transform",
            value && "translate-x-5",
          )}
        />
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Screens                                                             */
/* ------------------------------------------------------------------ */

function MainMenu() {
  const setScreen = useGameStore((s) => s.setScreen);
  const mode = useGameStore((s) => s.mode);
  const setMode = useGameStore((s) => s.setMode);
  const botCount = useGameStore((s) => s.botCount);
  const setBotCount = useGameStore((s) => s.setBotCount);
  const botSkill = useGameStore((s) => s.botSkill);
  const setBotSkill = useGameStore((s) => s.setBotSkill);

  const modes: { id: typeof mode; name: string; blurb: string }[] = [
    { id: "tdm", name: "Team Deathmatch", blurb: "Two squads. 75 eliminations." },
    { id: "domination", name: "Domination", blurb: "Hold the apron, the shelters, the fuel farm." },
    { id: "ffa", name: "Free-for-All", blurb: "Everyone on the flight line is hostile." },
    { id: "hardpoint", name: "Hardpoint", blurb: "A rotating objective across the compound." },
  ];

  return (
    <Scrim>
      <div className="w-full max-w-3xl px-8">
        <p className="text-[10px] font-semibold uppercase tracking-[0.5em] text-slate-500">
          Vers3Dynamics · R.A.I.N. Lab
        </p>
        <h1 className="mt-3 text-6xl font-black uppercase leading-[0.86] tracking-[-0.03em] text-white">
          Lop Nur
          <span className="block text-[#4da3ff]">Blacksite</span>
        </h1>
        <p className="mt-4 max-w-lg text-sm leading-relaxed text-slate-400">
          A first-person engagement simulator built on the measured 6.8 km
          reconstruction of the airfield. The map is the twin: same runway
          bearing, same compound layout, same structures.
        </p>

        <div className="mt-8 grid grid-cols-2 gap-2">
          {modes.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMode(m.id)}
              className={cn(
                "border-l-2 bg-white/[0.04] px-4 py-3 text-left transition-colors",
                mode === m.id
                  ? "border-[#4da3ff] bg-white/[0.1]"
                  : "border-transparent hover:bg-white/[0.08]",
              )}
            >
              <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-slate-100">
                {m.name}
              </div>
              <div className="mt-1 text-[11px] text-slate-500">{m.blurb}</div>
            </button>
          ))}
        </div>

        <div className="mt-6 space-y-3 border-t border-white/10 pt-5">
          <Slider
            label="Opposition"
            value={botCount}
            min={0}
            max={23}
            step={1}
            onChange={setBotCount}
            format={(v) => `${v}`}
          />
          <Slider
            label="Difficulty"
            value={botSkill}
            min={0.2}
            max={1}
            step={0.02}
            onChange={setBotSkill}
            format={(v) => (v < 0.4 ? "Recruit" : v < 0.6 ? "Regular" : v < 0.8 ? "Hardened" : "Veteran")}
          />
        </div>

        <div className="mt-8 flex gap-3">
          <TacticalButton primary onClick={() => setScreen("playing")} className="max-w-[220px]">
            Deploy
          </TacticalButton>
          <TacticalButton onClick={() => setScreen("loadout")} className="max-w-[220px]">
            Loadout
          </TacticalButton>
        </div>
        <p className="mt-6 text-[10px] uppercase tracking-[0.24em] text-slate-600">
          WASD move · Shift sprint · Ctrl crouch · Space jump/mantle · R reload · Q swap · Esc menu
        </p>
      </div>
    </Scrim>
  );
}

function StatBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-20 text-[9px] uppercase tracking-[0.16em] text-slate-500">{label}</span>
      <span className="h-1 flex-1 overflow-hidden rounded-full bg-white/10">
        <span
          className="block h-full rounded-full bg-[#4da3ff] transition-[width] duration-300"
          style={{ width: `${Math.round(value * 100)}%` }}
        />
      </span>
    </div>
  );
}

function LoadoutScreen() {
  const setScreen = useGameStore((s) => s.setScreen);
  const loadout = useGameStore((s) => s.loadout);
  const setPrimary = useGameStore((s) => s.setPrimary);
  const setSecondary = useGameStore((s) => s.setSecondary);
  const primary = getWeapon(loadout.primaryId);

  const primaries = WEAPON_LIST.filter(
    (w) => !["pistol", "launcher", "melee"].includes(w.weaponClass),
  );
  const secondaries = WEAPON_LIST.filter((w) =>
    ["pistol", "launcher", "melee"].includes(w.weaponClass),
  );

  const bars = {
    damage: Math.min(1, (primary.ballistics.damage[0]?.damage ?? 0) / 60),
    range: Math.min(1, (primary.ballistics.damage[2]?.rangeM ?? 20) / 90),
    accuracy: Math.max(0.05, 1 - primary.spread.adsDeg / 0.6),
    fireRate: Math.min(1, primary.rpm / 1050),
    mobility: Math.max(0.05, (primary.handling.moveScale - 0.75) / 0.5),
    control: Math.max(0.05, 1 - (primary.recoil.verticalDeg * primary.recoil.sustainScale) / 4),
  };

  return (
    <Scrim>
      <div className="grid w-full max-w-5xl grid-cols-[1.1fr_1fr] gap-10 px-8">
        <div>
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.4em] text-slate-500">
            Primary
          </h2>
          <div className="mt-3 max-h-[46vh] space-y-1 overflow-y-auto pr-2">
            {primaries.map((w) => (
              <button
                key={w.id}
                type="button"
                onClick={() => setPrimary(w.id)}
                className={cn(
                  "flex w-full items-baseline justify-between border-l-2 px-4 py-2 text-left transition-colors",
                  loadout.primaryId === w.id
                    ? "border-[#4da3ff] bg-white/[0.1]"
                    : "border-transparent bg-white/[0.03] hover:bg-white/[0.07]",
                )}
              >
                <span className="text-[12px] font-semibold uppercase tracking-[0.14em] text-slate-100">
                  {w.name}
                </span>
                <span className="text-[9px] uppercase tracking-[0.2em] text-slate-500">
                  {w.weaponClass}
                </span>
              </button>
            ))}
          </div>
          <h2 className="mt-6 text-[11px] font-semibold uppercase tracking-[0.4em] text-slate-500">
            Secondary
          </h2>
          <div className="mt-3 flex flex-wrap gap-1">
            {secondaries.map((w) => (
              <button
                key={w.id}
                type="button"
                onClick={() => setSecondary(w.id)}
                className={cn(
                  "px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] transition-colors",
                  loadout.secondaryId === w.id
                    ? "bg-[#4da3ff] text-[#05070a]"
                    : "bg-white/[0.05] text-slate-300 hover:bg-white/[0.1]",
                )}
              >
                {w.shortName}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col justify-between">
          <div>
            <h3 className="text-4xl font-black uppercase tracking-[-0.02em] text-white">
              {primary.name}
            </h3>
            <p className="mt-3 text-sm leading-relaxed text-slate-400">{primary.blurb}</p>
            <div className="mt-6 space-y-2">
              <StatBar label="Damage" value={bars.damage} />
              <StatBar label="Range" value={bars.range} />
              <StatBar label="Accuracy" value={bars.accuracy} />
              <StatBar label="Fire rate" value={bars.fireRate} />
              <StatBar label="Mobility" value={bars.mobility} />
              <StatBar label="Control" value={bars.control} />
            </div>
            <dl className="mt-6 grid grid-cols-3 gap-4 border-t border-white/10 pt-4 text-[10px] uppercase tracking-[0.16em] text-slate-500">
              <div>
                <dt>Rounds</dt>
                <dd className="mt-1 font-mono text-base text-slate-100">{primary.magSize}</dd>
              </div>
              <div>
                <dt>RPM</dt>
                <dd className="mt-1 font-mono text-base text-slate-100">{primary.rpm}</dd>
              </div>
              <div>
                <dt>ADS</dt>
                <dd className="mt-1 font-mono text-base text-slate-100">
                  {Math.round(primary.handling.adsTime * 1000)}ms
                </dd>
              </div>
            </dl>
          </div>
          <div className="mt-8 flex gap-3">
            <TacticalButton primary onClick={() => setScreen("playing")}>
              Deploy
            </TacticalButton>
            <TacticalButton onClick={() => setScreen("boot")}>Back</TacticalButton>
          </div>
        </div>
      </div>
    </Scrim>
  );
}

function PauseMenu() {
  const setScreen = useGameStore((s) => s.setScreen);
  const store = useGameStore();

  return (
    <Scrim>
      <div className="w-full max-w-md px-8">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.4em] text-slate-500">
          Paused
        </h2>
        <div className="mt-5 space-y-2">
          <TacticalButton primary onClick={() => setScreen("playing")}>
            Resume
          </TacticalButton>
          <TacticalButton onClick={() => setScreen("loadout")}>Loadout</TacticalButton>
          <TacticalButton onClick={() => setScreen("boot")}>Leave match</TacticalButton>
        </div>
        <div className="mt-8 space-y-3 border-t border-white/10 pt-6">
          <Slider
            label="Sensitivity"
            value={store.sensitivity}
            min={0.1}
            max={3}
            step={0.05}
            onChange={store.setSensitivity}
          />
          <Slider
            label="ADS sensitivity"
            value={store.adsSensitivity}
            min={0.2}
            max={1.5}
            step={0.05}
            onChange={store.setAdsSensitivity}
          />
          <Slider
            label="Field of view"
            value={store.fov}
            min={70}
            max={120}
            step={1}
            onChange={store.setFov}
            format={(v) => `${v.toFixed(0)}°`}
          />
          <Slider
            label="Master volume"
            value={store.masterVolume}
            min={0}
            max={1}
            step={0.05}
            onChange={store.setMasterVolume}
          />
          <Toggle label="Invert look" value={store.invertY} onChange={store.toggleInvertY} />
          <Toggle label="Film grain" value={store.filmGrain} onChange={store.toggleFilmGrain} />
          <Toggle label="Show statistics" value={store.showFps} onChange={store.toggleShowFps} />
        </div>
      </div>
    </Scrim>
  );
}

/* ------------------------------------------------------------------ */
/* Killfeed                                                            */
/* ------------------------------------------------------------------ */

function Killfeed() {
  const killfeed = useGameStore((s) => s.killfeed);
  if (killfeed.length === 0) return null;
  return (
    <div className="pointer-events-none absolute right-6 top-24 z-20 flex flex-col items-end gap-1">
      {killfeed.map((entry) => (
        <div
          key={entry.id}
          className="flex items-center gap-2 bg-black/45 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.1em] backdrop-blur-sm"
        >
          <span className={TEAM_COLOR[entry.attackerTeam]}>{entry.attacker}</span>
          {entry.penetrated && <span className="text-slate-500">▚</span>}
          <span className="text-slate-400">›</span>
          {entry.headshot && <span className="text-[#ffb648]">◉</span>}
          <span className={TEAM_COLOR[entry.victimTeam]}>{entry.victim}</span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Root                                                               */
/* ------------------------------------------------------------------ */

const IN_MATCH: GameScreen[] = ["playing", "paused", "killcam"];

export function GameHud() {
  const screen = useGameStore((s) => s.screen);

  // Reset the transient HUD state whenever we leave a match.
  useEffect(() => {
    if (screen === "boot") {
      game.hud.damageDirs.length = 0;
      game.hud.hitmarker = 0;
    }
  }, [screen]);

  return (
    <>
      {IN_MATCH.includes(screen) && <CombatHud />}
      {IN_MATCH.includes(screen) && <Killfeed />}
      {screen === "boot" && <MainMenu />}
      {screen === "loadout" && <LoadoutScreen />}
      {screen === "paused" && <PauseMenu />}
    </>
  );
}
