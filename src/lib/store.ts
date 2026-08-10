import { create } from "zustand";
import { TIMELINE_BOUNDS, getStructure, isVisibleAtTimelineYear } from "./layout";
import {
  DEFAULT_EVIDENCE_MODE,
  EVIDENCE_MODES,
  isSubjectVisible,
  type EvidenceMode,
} from "./evidenceMode";
import { EVIDENCE_CLASSIFICATIONS, type EvidenceClassification } from "./evidence";
import { XRAY_MODES, type XrayMode } from "./xray";
import {
  SCRUB_MIN_DAY,
  SCRUB_SPAN_DAYS,
  clampDay,
  dateAtDay,
  dayOfDate,
  nextStopAfter,
  previousDayBefore,
} from "./timeScrubber";
import { OVERLAY_MODES, getReferenceScene, type OverlayMode } from "./referenceImagery";
import { TEMPORAL_SNAPSHOT_DATES, isIsoDate } from "./temporal";
import type { MeasurePoint } from "./measure";
import { readEnumParam, readFlag, readIntParam, readIsoDateParam } from "./params";

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

/**
 * A registered reference scene the user supplied.
 *
 * `objectUrl` is a blob URL for a file read in this browser. It is never
 * uploaded and never fetched, and it is revoked whenever it is replaced or
 * cleared — a blob URL outlives the component that made it and would otherwise
 * pin the decoded image for the life of the tab.
 */
export interface ReferenceOverlayState {
  sceneId: string;
  objectUrl: string | null;
  /** Pixel dimensions of the supplied crop, for the registration readout. */
  widthPx: number;
  heightPx: number;
  mode: OverlayMode;
  /** 0-1, how strongly the scene is drawn over the model's own ground. */
  opacity: number;
  /** 0-1 position of the swipe divider across the site, west to east. */
  swipe: number;
}

interface TwinState {
  cameraMode: CameraMode;
  setCameraMode: (mode: CameraMode) => void;

  night: boolean;
  toggleNight: () => void;

  activeTimelineYear: number;
  setActiveTimelineYear: (year: number) => void;

  /**
   * Which evidence classifications the scene, the minimap, the index and the
   * dossier are allowed to draw. Every consumer asks
   * `isSubjectVisible(id, evidenceMode)` rather than deciding for itself.
   */
  evidenceMode: EvidenceMode;
  setEvidenceMode: (mode: EvidenceMode) => void;

  /**
   * Snapshot date for the temporal view, or null for "the model's current
   * state". Kept separate from `activeTimelineYear`, which is the existing
   * year-granularity scene filter and keeps working unchanged.
   *
   * This and `scrubDay` are two views of one position and are only ever written
   * together, by the two setters below. Nothing else may assign either of them.
   */
  snapshotDate: string | null;
  setSnapshotDate: (date: string | null) => void;
  /**
   * The time scrubber's playhead, in days after the earliest evidence date, or
   * null when the scrubber is parked at the model's current state. The axis is
   * days rather than ledger index so four quiet years and three busy weeks do
   * not take the same time to cross.
   */
  scrubDay: number | null;
  setScrubDay: (day: number | null) => void;
  /** Move to the next or previous date the ledger can actually be read at. */
  stepScrub: (direction: 1 | -1) => void;
  scrubPlaying: boolean;
  setScrubPlaying: (playing: boolean) => void;
  toggleScrubPlaying: () => void;
  /** The second date in a change comparison, or null when not comparing. */
  comparisonDate: string | null;
  setComparisonDate: (date: string | null) => void;

  /**
   * How certain the scene is allowed to look. `off` is the reconstruction as
   * built; the other two make support visible as solidity and altitude.
   */
  xrayMode: XrayMode;
  setXrayMode: (mode: XrayMode) => void;
  cycleXrayMode: () => void;
  /** Which evidence layer is isolated, or null for all four at once. */
  xrayFocus: EvidenceClassification | null;
  setXrayFocus: (classification: EvidenceClassification | null) => void;

  /**
   * The strict reading: draw only geometry a cited public source defends, and
   * remove everything else. Overrides the appearance controls while it is on.
   */
  proveIt: boolean;
  toggleProveIt: () => void;
  setProveIt: (on: boolean) => void;

  /** Whether the reference-imagery panel and its ground frame are shown. */
  showReference: boolean;
  toggleReference: () => void;
  /** Registered public reference imagery the user supplied, or null. */
  reference: ReferenceOverlayState;
  setReferenceScene: (sceneId: string) => void;
  setReferenceImage: (objectUrl: string | null, width: number, height: number) => void;
  setReferenceMode: (mode: OverlayMode) => void;
  setReferenceOpacity: (opacity: number) => void;
  setReferenceSwipe: (swipe: number) => void;
  clearReference: () => void;

  /** Whether spatial uncertainty envelopes are drawn in the scene and minimap. */
  showUncertainty: boolean;
  toggleUncertainty: () => void;

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
  const tier = readIntParam("quality", 0, 3);
  return tier === null ? null : (tier as QualityTier);
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
  const month = readIntParam("month", 1, 12);
  return month === null ? 5 : month - 1;
}

function normalizeMonth(month: number): number {
  if (!Number.isFinite(month)) return 5;
  return ((Math.round(month) % 12) + 12) % 12;
}

/**
 * `?year=` pins the construction-timeline year. Out-of-range values clamp to the
 * modeled bounds rather than being trusted, same as every other parameter.
 */
function initialTimelineYear(): number {
  const year = readIntParam("year", TIMELINE_BOUNDS.minYear, TIMELINE_BOUNDS.maxYear);
  return year ?? TIMELINE_BOUNDS.maxYear;
}

/** `?evidence=observed|reported|interpretation|full-simulation`. */
function initialEvidenceMode(): EvidenceMode {
  return readEnumParam("evidence", EVIDENCE_MODES) ?? DEFAULT_EVIDENCE_MODE;
}

/**
 * `?snapshot=YYYY-MM-DD`. Only a date the ledger can actually be snapshotted at
 * is accepted; anything else falls back to null, meaning "current state".
 */
function initialSnapshotDate(): string | null {
  return normalizeSnapshotDate(readIsoDateParam("snapshot"));
}

function normalizeSnapshotDate(date: string | null): string | null {
  if (date === null || !isIsoDate(date)) return null;
  return TEMPORAL_SNAPSHOT_DATES.includes(date) ? date : null;
}

/** `?xray=off|ghost|stratified`. */
function initialXrayMode(): XrayMode {
  return readEnumParam("xray", XRAY_MODES) ?? "off";
}

/** `?layer=observed|reported|interpreted|illustrative` isolates one stratum. */
function initialXrayFocus(): EvidenceClassification | null {
  return readEnumParam("layer", EVIDENCE_CLASSIFICATIONS);
}

/**
 * The scrubber's initial playhead, derived from `?snapshot=` so one parameter
 * keeps driving the temporal position and the two never disagree on load.
 */
function initialScrubDay(snapshotDate: string | null): number | null {
  return snapshotDate === null ? null : (dayOfDate(snapshotDate) ?? null);
}

const INITIAL_REFERENCE: ReferenceOverlayState = {
  sceneId: "sentinel-2-site",
  objectUrl: null,
  widthPx: 0,
  heightPx: 0,
  mode: "swipe",
  opacity: 0.85,
  swipe: 0.5,
};

/** Blob URLs outlive their component, so every replacement revokes the old one. */
function revoke(objectUrl: string | null): void {
  if (objectUrl !== null && typeof URL !== "undefined") {
    URL.revokeObjectURL(objectUrl);
  }
}

function clampUnit(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(1, Math.max(0, value));
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

  night: readFlag("night"),
  toggleNight: () => set((s) => ({ night: !s.night })),

  activeTimelineYear: initialTimelineYear(),
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

  evidenceMode: initialEvidenceMode(),
  setEvidenceMode: (evidenceMode) =>
    set((state) => ({
      evidenceMode,
      // A selection the new mode withholds must not stay open behind it: a
      // dossier for a building the scene is no longer drawing is the exact
      // confusion the modes exist to prevent.
      selectedId:
        state.selectedId !== null && !isSubjectVisible(state.selectedId, evidenceMode)
          ? null
          : state.selectedId,
    })),

  // `snapshotDate` and `scrubDay` are one position in two units. Both setters
  // write both fields, and nothing else writes either, so they cannot drift.
  snapshotDate: initialSnapshotDate(),
  setSnapshotDate: (date) => {
    const snapshotDate = normalizeSnapshotDate(date);
    set({ snapshotDate, scrubDay: initialScrubDay(snapshotDate) });
  },
  scrubDay: initialScrubDay(initialSnapshotDate()),
  setScrubDay: (day) => {
    if (day === null) {
      set({ scrubDay: null, snapshotDate: null, scrubPlaying: false });
      return;
    }
    const scrubDay = clampDay(day);
    set({ scrubDay, snapshotDate: dateAtDay(scrubDay) });
  },
  stepScrub: (direction) =>
    set((state) => {
      const current = state.scrubDay ?? SCRUB_SPAN_DAYS;
      // Stepping back off the earliest stop lands on the pre-evidence slot,
      // whose snapshot date is legitimately null — nothing was public yet.
      const day =
        direction === 1 ? nextStopAfter(current)?.day : previousDayBefore(current);
      if (day === undefined) return state;
      return { scrubDay: day, snapshotDate: dateAtDay(day) };
    }),
  scrubPlaying: false,
  setScrubPlaying: (scrubPlaying) => set({ scrubPlaying }),
  toggleScrubPlaying: () =>
    set((state) => ({
      scrubPlaying: !state.scrubPlaying,
      // Pressing play with the scrubber parked starts it from the beginning
      // rather than doing nothing, which is what every viewer expects. The
      // beginning is the pre-evidence slot, not the first stop: the honest
      // opening frame is the site before anything about it was public.
      ...(state.scrubPlaying || state.scrubDay !== null
        ? {}
        : { scrubDay: SCRUB_MIN_DAY, snapshotDate: dateAtDay(SCRUB_MIN_DAY) }),
    })),
  comparisonDate: normalizeSnapshotDate(readIsoDateParam("compare")),
  setComparisonDate: (comparisonDate) =>
    set({ comparisonDate: normalizeSnapshotDate(comparisonDate) }),

  xrayMode: initialXrayMode(),
  setXrayMode: (xrayMode) => set({ xrayMode }),
  cycleXrayMode: () =>
    set((state) => ({
      xrayMode:
        XRAY_MODES[(XRAY_MODES.indexOf(state.xrayMode) + 1) % XRAY_MODES.length] ?? "off",
    })),
  xrayFocus: initialXrayFocus(),
  setXrayFocus: (xrayFocus) => set({ xrayFocus }),

  proveIt: readFlag("prove"),
  toggleProveIt: () => set((state) => ({ proveIt: !state.proveIt })),
  setProveIt: (proveIt) => set({ proveIt }),

  showReference: false,
  toggleReference: () =>
    set((state) => ({ showReference: !state.showReference, showIndex: false })),
  reference: INITIAL_REFERENCE,
  setReferenceScene: (sceneId) =>
    set((state) => {
      if (getReferenceScene(sceneId) === undefined) return state;
      if (sceneId === state.reference.sceneId) return state;
      // A crop belongs to the window it was cut for. Keeping it across a scene
      // change would stretch a whole-site image over the runway window (or the
      // reverse) and recompute the registration report as though it fitted —
      // a comparison that looks convincing and is spatially false, which is the
      // one thing this feature must never produce.
      revoke(state.reference.objectUrl);
      return {
        reference: {
          ...state.reference,
          sceneId,
          objectUrl: null,
          widthPx: 0,
          heightPx: 0,
        },
      };
    }),
  setReferenceImage: (objectUrl, widthPx, heightPx) =>
    set((state) => {
      revoke(state.reference.objectUrl);
      return {
        reference: {
          ...state.reference,
          objectUrl,
          widthPx: Math.max(0, Math.round(widthPx)),
          heightPx: Math.max(0, Math.round(heightPx)),
        },
      };
    }),
  setReferenceMode: (mode) =>
    set((state) =>
      OVERLAY_MODES.includes(mode) ? { reference: { ...state.reference, mode } } : state,
    ),
  setReferenceOpacity: (opacity) =>
    set((state) => ({
      reference: { ...state.reference, opacity: clampUnit(opacity, 0.85) },
    })),
  setReferenceSwipe: (swipe) =>
    set((state) => ({
      reference: { ...state.reference, swipe: clampUnit(swipe, 0.5) },
    })),
  clearReference: () =>
    set((state) => {
      revoke(state.reference.objectUrl);
      return {
        reference: { ...state.reference, objectUrl: null, widthPx: 0, heightPx: 0 },
      };
    }),

  showUncertainty: readFlag("uncertainty"),
  toggleUncertainty: () => set((s) => ({ showUncertainty: !s.showUncertainty })),

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
  toggleIndex: () => set((s) => ({ showIndex: !s.showIndex, showResearch: false })),
  showHelp: false,
  toggleHelp: () => set((s) => ({ showHelp: !s.showHelp })),
  showResearch: false,
  toggleResearch: () => set((s) => ({ showResearch: !s.showResearch, showIndex: false })),

  measureMode: false,
  toggleMeasureMode: () => set((s) => ({ measureMode: !s.measureMode })),
  measurePoints: [],
  addMeasurePoint: (point) =>
    set((s) => ({ measurePoints: [...s.measurePoints, point].slice(-64) })),
  undoMeasurePoint: () => set((s) => ({ measurePoints: s.measurePoints.slice(0, -1) })),
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
