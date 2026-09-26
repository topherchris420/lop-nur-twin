import { create } from "zustand";
import { readEnumParam, readFlag, readIntParam } from "@/lib/params";
import type { GameModeId, MatchPhase, Team } from "./types";
import type { ParsedTrace } from "../pilot/recorder";
import { CONTROL_MODES, type ControlMode } from "../pilot/contract";

/**
 * Discrete game state for React. Anything that changes every frame belongs in
 * `gameState.ts`; this store only holds things that change on an event —
 * menu screens, loadout choices, match phase, settings.
 */

/**
 * Who controls the player. `human` is the keyboard and mouse; the others are
 * brains that drive the same input through `src/game/pilot/` — the TypeSafe
 * Jev model, a seeded random baseline, or a recorded trace played back.
 */
export type BrainKind = "human" | "jev" | "random" | "replay";

export const BRAIN_KINDS: readonly BrainKind[] = ["human", "jev", "random", "replay"];

/**
 * How a human's aim reaches the view. `standard` is the raw mouse. `elite` is
 * Elite Operator: target friction, a slight slowdown across a visible enemy,
 * very mild rotational help while aiming down the sights and, optionally,
 * learned recoil help. The mouse always wins; it never fires for you.
 */
export type PlayerProfile = "standard" | "elite";
export const PLAYER_PROFILES: readonly PlayerProfile[] = ["standard", "elite"];

export type GameScreen =
  "boot" | "menu" | "loadout" | "briefing" | "playing" | "paused" | "killcam" | "results";

export interface Loadout {
  primaryId: string;
  secondaryId: string;
  lethalId: string;
  tacticalId: string;
  perkIds: readonly string[];
  /** Attachment ids keyed by weapon id. */
  attachments: Readonly<Record<string, readonly string[]>>;
}

export const DEFAULT_LOADOUT: Loadout = {
  primaryId: "kilo-141",
  secondaryId: "m19",
  lethalId: "frag",
  tacticalId: "flash",
  perkIds: ["double-time", "ghost", "amped"],
  attachments: {},
};

export interface KillfeedEntry {
  id: number;
  attacker: string;
  attackerTeam: Team;
  victim: string;
  victimTeam: Team;
  weapon: string;
  headshot: boolean;
  penetrated: boolean;
  time: number;
}

export interface ObituaryToast {
  id: number;
  text: string;
  detail: string;
  kind: "kill" | "streak" | "objective" | "medal";
  time: number;
}

export interface ScoreRow {
  id: number;
  name: string;
  team: Team;
  kills: number;
  deaths: number;
  assists: number;
  score: number;
  streak: number;
  isPlayer: boolean;
  alive: boolean;
  ping: number;
}

interface GameStoreState {
  screen: GameScreen;
  setScreen: (screen: GameScreen) => void;

  mode: GameModeId;
  setMode: (mode: GameModeId) => void;

  phase: MatchPhase;
  setPhase: (phase: MatchPhase) => void;

  loadout: Loadout;
  setLoadout: (loadout: Loadout) => void;
  setPrimary: (id: string) => void;
  setSecondary: (id: string) => void;
  setAttachments: (weaponId: string, attachmentIds: readonly string[]) => void;

  killfeed: readonly KillfeedEntry[];
  pushKillfeed: (entry: Omit<KillfeedEntry, "id">) => void;
  pruneKillfeed: (now: number) => void;

  toasts: readonly ObituaryToast[];
  pushToast: (toast: Omit<ObituaryToast, "id">) => void;
  pruneToasts: (now: number) => void;

  scoreboard: readonly ScoreRow[];
  setScoreboard: (rows: readonly ScoreRow[]) => void;

  /** Earned but unused killstreak rewards. */
  streaks: readonly string[];
  setStreaks: (streaks: readonly string[]) => void;

  /** Settings the player can change from the pause menu. */
  sensitivity: number;
  setSensitivity: (value: number) => void;
  adsSensitivity: number;
  setAdsSensitivity: (value: number) => void;
  fov: number;
  setFov: (value: number) => void;
  invertY: boolean;
  toggleInvertY: () => void;
  masterVolume: number;
  setMasterVolume: (value: number) => void;
  musicVolume: number;
  setMusicVolume: (value: number) => void;
  showFps: boolean;
  toggleShowFps: () => void;
  filmGrain: boolean;
  toggleFilmGrain: () => void;
  motionBlur: boolean;
  toggleMotionBlur: () => void;
  crosshairStyle: "dot" | "cross" | "chevron";
  setCrosshairStyle: (style: "dot" | "cross" | "chevron") => void;
  botCount: number;
  setBotCount: (count: number) => void;
  botSkill: number;
  setBotSkill: (skill: number) => void;
  /** Deterministic match seed, so a given match replays identically. */
  matchSeed: number;
  rerollMatchSeed: () => void;

  /** Who controls the player. Changes on a menu choice or a takeover. */
  brain: BrainKind;
  setBrain: (brain: BrainKind) => void;
  /** Seeds the random brain; `?seed=` also pins the match seed. */
  brainSeed: number;
  /** `?fallback=random`: a labelled stand-in while Jev cannot answer. */
  brainFallback: "random" | null;
  /** The validated trace the replay brain plays back, once one is loaded. */
  replayTrace: ParsedTrace | null;
  setReplayTrace: (trace: ParsedTrace | null) => void;
  /**
   * `?jevControl=direct|precision`: how a brain's aim reaches the view. Direct
   * is the original stepped interface, kept for comparison; precision adds a
   * target choice executed by the local tracking controller.
   */
  jevControl: ControlMode;
  setJevControl: (control: ControlMode) => void;
  /** `?playerProfile=standard|elite` — Elite Operator for the human. */
  playerProfile: PlayerProfile;
  setPlayerProfile: (profile: PlayerProfile) => void;
  /** Elite Operator's learned recoil help. On by default within Elite Operator. */
  eliteRecoilAssist: boolean;
  toggleEliteRecoilAssist: () => void;
}

let killfeedId = 1;
let toastId = 1;

const KILLFEED_TTL = 7;
const TOAST_TTL = 3.4;

/** `?autoplay=1` boots straight into a match; handy for the visual probe. */
function initialScreen(): GameScreen {
  return readFlag("autoplay") ? "playing" : "boot";
}

const GAME_MODE_IDS = ["tdm", "domination", "ffa", "hardpoint", "gunfight"] as const;

function initialMode(): GameModeId {
  return readEnumParam<GameModeId>("mode", GAME_MODE_IDS) ?? "tdm";
}

/**
 * `?brain=human|jev|random|replay` picks who controls the player; anything else
 * — including a missing parameter — is the human, exactly as before. It never
 * changes `?autoplay`, which still only decides whether the menus are skipped.
 */
function initialBrain(): BrainKind {
  return readEnumParam<BrainKind>("brain", BRAIN_KINDS) ?? "human";
}

const DEFAULT_MATCH_SEED = 0x5eed1;

/** `?seed=<int>` pins both the match seed and the random brain's seed. */
const SEED_PARAM = readIntParam("seed", 0, 0x7fffffff);

export const useGameStore = create<GameStoreState>()((set) => ({
  screen: initialScreen(),
  setScreen: (screen) => set({ screen }),

  mode: initialMode(),
  setMode: (mode) => set({ mode }),

  phase: "warmup",
  setPhase: (phase) => set({ phase }),

  loadout: DEFAULT_LOADOUT,
  setLoadout: (loadout) => set({ loadout }),
  setPrimary: (primaryId) => set((s) => ({ loadout: { ...s.loadout, primaryId } })),
  setSecondary: (secondaryId) => set((s) => ({ loadout: { ...s.loadout, secondaryId } })),
  setAttachments: (weaponId, attachmentIds) =>
    set((s) => ({
      loadout: {
        ...s.loadout,
        attachments: { ...s.loadout.attachments, [weaponId]: attachmentIds },
      },
    })),

  killfeed: [],
  pushKillfeed: (entry) =>
    set((s) => ({
      killfeed: [...s.killfeed, { ...entry, id: killfeedId++ }].slice(-6),
    })),
  pruneKillfeed: (now) =>
    set((s) => {
      const next = s.killfeed.filter((e) => now - e.time < KILLFEED_TTL);
      return next.length === s.killfeed.length ? s : { killfeed: next };
    }),

  toasts: [],
  pushToast: (toast) =>
    set((s) => ({ toasts: [...s.toasts, { ...toast, id: toastId++ }].slice(-4) })),
  pruneToasts: (now) =>
    set((s) => {
      const next = s.toasts.filter((t) => now - t.time < TOAST_TTL);
      return next.length === s.toasts.length ? s : { toasts: next };
    }),

  scoreboard: [],
  setScoreboard: (scoreboard) => set({ scoreboard }),

  streaks: [],
  setStreaks: (streaks) => set({ streaks }),

  sensitivity: 1,
  setSensitivity: (sensitivity) => set({ sensitivity }),
  adsSensitivity: 0.8,
  setAdsSensitivity: (adsSensitivity) => set({ adsSensitivity }),
  /** Horizontal degrees, the genre's convention. See `core/types.ts`. */
  fov: 80,
  setFov: (fov) => set({ fov }),
  invertY: false,
  toggleInvertY: () => set((s) => ({ invertY: !s.invertY })),
  masterVolume: 0.8,
  setMasterVolume: (masterVolume) => set({ masterVolume }),
  musicVolume: 0.5,
  setMusicVolume: (musicVolume) => set({ musicVolume }),
  showFps: false,
  toggleShowFps: () => set((s) => ({ showFps: !s.showFps })),
  filmGrain: true,
  toggleFilmGrain: () => set((s) => ({ filmGrain: !s.filmGrain })),
  motionBlur: true,
  toggleMotionBlur: () => set((s) => ({ motionBlur: !s.motionBlur })),
  crosshairStyle: "cross",
  setCrosshairStyle: (crosshairStyle) => set({ crosshairStyle }),
  botCount: 11,
  setBotCount: (botCount) => set({ botCount }),
  botSkill: 0.4,
  setBotSkill: (botSkill) => set({ botSkill }),
  matchSeed: SEED_PARAM ?? DEFAULT_MATCH_SEED,
  rerollMatchSeed: () => set({ matchSeed: (Math.random() * 0xffffff) >>> 0 }),

  brain: initialBrain(),
  setBrain: (brain) => set({ brain }),
  brainSeed: SEED_PARAM ?? DEFAULT_MATCH_SEED,
  brainFallback: readEnumParam<"random">("fallback", ["random"]),
  replayTrace: null,
  setReplayTrace: (replayTrace) => set({ replayTrace }),
  jevControl: readEnumParam<ControlMode>("jevControl", CONTROL_MODES) ?? "precision",
  setJevControl: (jevControl) => set({ jevControl }),
  playerProfile:
    readEnumParam<PlayerProfile>("playerProfile", PLAYER_PROFILES) ?? "standard",
  setPlayerProfile: (playerProfile) => set({ playerProfile }),
  eliteRecoilAssist: readEnumParam<"0" | "1">("eliteRecoil", ["0", "1"]) !== "0",
  toggleEliteRecoilAssist: () =>
    set((s) => ({ eliteRecoilAssist: !s.eliteRecoilAssist })),
}));
