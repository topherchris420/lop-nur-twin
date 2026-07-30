import { create } from "zustand";
import {
  TIMELINE_BOUNDS,
  getStructure,
  isVisibleAtTimelineYear,
} from "./layout";
import type { MeasurePoint } from "./measure";

export type CameraMode = "orbit" | "fps" | "cinematic";

/** 3 = maximum detail; 0 = minimum (see lib/quality.ts). */
export type QualityTier = 0 | 1 | 2 | 3;

export interface FlyToRequest {
  /** camera destination */
  position: [number, number, number];
  /** orbit target / look-at point */
  target: [number, number, number];
  /** monotonically increasing so identical destinations still re-trigger */
  seq: number;
}

interface TwinState {
  cameraMode: CameraMode;
  setCameraMode: (mode: CameraMode) => void;

  night: boolean;
  toggleNight: () => void;

  activeTimelineYear: number;
  setActiveTimelineYear: (year: number) => void;

  selectedId: string | null;
  select: (id: string | null) => void;

  flyTo: FlyToRequest | null;
  requestFlyTo: (
    position: [number, number, number],
    target: [number, number, number],
  ) => void;

  showIndex: boolean;
  toggleIndex: () => void;
  showHelp: boolean;
  toggleHelp: () => void;
  showResearch: boolean;
  toggleResearch: () => void;

  /** When true, minimap clicks drop measurement vertices instead of flying. */
  measureMode: boolean;
  toggleMeasureMode: () => void;
  /** Ordered vertices of the active measurement path, in local metres. */
  measurePoints: readonly MeasurePoint[];
  addMeasurePoint: (point: MeasurePoint) => void;
  undoMeasurePoint: () => void;
  clearMeasure: () => void;

  /** Zero-based month index into the public NASA POWER climatology. */
  environmentMonth: number;
  setEnvironmentMonth: (month: number) => void;

  qualityTier: QualityTier;
  autoQuality: boolean;
  setQualityTier: (tier: QualityTier) => void;

  reducedMotion: boolean;
  setReducedMotion: (reduced: boolean) => void;

  /** true while the first-person camera has captured the mouse */
  pointerLocked: boolean;
  setPointerLocked: (locked: boolean) => void;

  /** flips true once the scene has rendered its first frame */
  ready: boolean;
  setReady: () => void;
}

/**
 * `?quality=0..3` pins the quality tier and disables the adaptive ladder;
 * handy for screenshots and for testing each tier by hand.
 */
function initialReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  );
}

function pinnedQualityTier(): QualityTier | null {
  if (typeof window !== "undefined") {
    const q = new URLSearchParams(window.location.search).get("quality");
    const n = q === null ? NaN : Number(q);
    if (Number.isInteger(n) && n >= 0 && n <= 3) return n as QualityTier;
  }
  return null;
}

function initialQuality(): Pick<TwinState, "qualityTier" | "autoQuality"> {
  if (typeof window !== "undefined") {
    const pinnedTier = pinnedQualityTier();
    if (pinnedTier !== null) return { qualityTier: pinnedTier, autoQuality: false };

    const navigatorWithMemory = window.navigator as Navigator & {
      deviceMemory?: number;
    };
    const reducedMotion = initialReducedMotion();
    const constrainedDevice =
      (navigatorWithMemory.deviceMemory !== undefined &&
        navigatorWithMemory.deviceMemory <= 4) ||
      (window.navigator.hardwareConcurrency !== undefined &&
        window.navigator.hardwareConcurrency <= 4);

    return {
      qualityTier: reducedMotion || constrainedDevice ? 1 : 2,
      autoQuality: !reducedMotion,
    };
  }
  return { qualityTier: 2, autoQuality: true };
}

/** `?month=1..12` selects the initial climatology month. June is the default. */
function initialEnvironmentMonth(): number {
  if (typeof window !== "undefined") {
    const raw = new URLSearchParams(window.location.search).get("month");
    const month = raw === null ? NaN : Number(raw);
    if (Number.isInteger(month) && month >= 1 && month <= 12) return month - 1;
  }
  return 5;
}

function normalizeMonth(month: number): number {
  if (!Number.isFinite(month)) return 5;
  return ((Math.round(month) % 12) + 12) % 12;
}

function normalizeTimelineYear(year: number): number {
  if (!Number.isFinite(year)) return TIMELINE_BOUNDS.maxYear;
  return Math.min(
    TIMELINE_BOUNDS.maxYear,
    Math.max(TIMELINE_BOUNDS.minYear, Math.round(year)),
  );
}

export const useTwinStore = create<TwinState>()((set) => ({
  cameraMode: "orbit",
  setCameraMode: (cameraMode) => set({ cameraMode }),

  night: false,
  toggleNight: () => set((s) => ({ night: !s.night })),

  activeTimelineYear: TIMELINE_BOUNDS.maxYear,
  setActiveTimelineYear: (year) =>
    set((state) => {
      const activeTimelineYear = normalizeTimelineYear(year);
      const selectedStructure = state.selectedId
        ? getStructure(state.selectedId)
        : undefined;
      return {
        activeTimelineYear,
        selectedId:
          selectedStructure &&
          !isVisibleAtTimelineYear(selectedStructure, activeTimelineYear)
            ? null
            : state.selectedId,
      };
    }),

  selectedId: null,
  select: (selectedId) => set({ selectedId }),

  flyTo: null,
  requestFlyTo: (position, target) =>
    set((s) => ({
      // fly-to is an orbit-camera gesture; switch modes if needed
      cameraMode: "orbit",
      flyTo: { position, target, seq: (s.flyTo?.seq ?? 0) + 1 },
    })),

  showIndex: false,
  toggleIndex: () =>
    set((s) => ({ showIndex: !s.showIndex, showResearch: false })),
  showHelp: false,
  toggleHelp: () => set((s) => ({ showHelp: !s.showHelp })),
  showResearch: false,
  toggleResearch: () =>
    set((s) => ({ showResearch: !s.showResearch, showIndex: false })),

  measureMode: false,
  toggleMeasureMode: () => set((s) => ({ measureMode: !s.measureMode })),
  measurePoints: [],
  addMeasurePoint: (point) =>
    set((s) => ({ measurePoints: [...s.measurePoints, point].slice(-64) })),
  undoMeasurePoint: () =>
    set((s) => ({ measurePoints: s.measurePoints.slice(0, -1) })),
  clearMeasure: () =>
    set((s) => (s.measurePoints.length === 0 ? s : { measurePoints: [] })),

  environmentMonth: initialEnvironmentMonth(),
  setEnvironmentMonth: (environmentMonth) =>
    set({ environmentMonth: normalizeMonth(environmentMonth) }),

  ...initialQuality(),
  setQualityTier: (qualityTier) => set({ qualityTier }),

  reducedMotion: initialReducedMotion(),
  setReducedMotion: (reducedMotion) =>
    set(() => ({
      reducedMotion,
      autoQuality: pinnedQualityTier() === null && !reducedMotion,
    })),

  pointerLocked: false,
  setPointerLocked: (pointerLocked) => set({ pointerLocked }),

  ready: false,
  setReady: () => set((s) => (s.ready ? s : { ready: true })),
}));

/**
 * Dev-only handle for `tools/probe.mjs`, which needs to drive the camera to an
 * exact position to capture a scale-accurate plan view for comparison against
 * reference satellite imagery. Stripped from production builds.
 */
if (import.meta.env.DEV && typeof globalThis !== "undefined") {
  (globalThis as { __twinStore?: typeof useTwinStore }).__twinStore = useTwinStore;
}
