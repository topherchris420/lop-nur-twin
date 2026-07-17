import { create } from "zustand";

export type CameraMode = "orbit" | "fps" | "cinematic";

/** 3 = everything on … 0 = minimum (see lib/adaptiveQuality.ts). */
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

  qualityTier: QualityTier;
  autoQuality: boolean;
  setQualityTier: (tier: QualityTier) => void;

  /** true while the first-person camera has captured the mouse */
  pointerLocked: boolean;
  setPointerLocked: (locked: boolean) => void;
}

/**
 * `?quality=0..3` pins the quality tier and disables the adaptive ladder —
 * handy for screenshots and for testing each tier by hand.
 */
function initialQuality(): Pick<TwinState, "qualityTier" | "autoQuality"> {
  if (typeof window !== "undefined") {
    const q = new URLSearchParams(window.location.search).get("quality");
    const n = q === null ? NaN : Number(q);
    if (Number.isInteger(n) && n >= 0 && n <= 3) {
      return { qualityTier: n as QualityTier, autoQuality: false };
    }
  }
  return { qualityTier: 3, autoQuality: true };
}

export const useTwinStore = create<TwinState>()((set) => ({
  cameraMode: "orbit",
  setCameraMode: (cameraMode) => set({ cameraMode }),

  night: false,
  toggleNight: () => set((s) => ({ night: !s.night })),

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
  toggleIndex: () => set((s) => ({ showIndex: !s.showIndex })),
  showHelp: false,
  toggleHelp: () => set((s) => ({ showHelp: !s.showHelp })),

  ...initialQuality(),
  setQualityTier: (qualityTier) => set({ qualityTier }),

  pointerLocked: false,
  setPointerLocked: (pointerLocked) => set({ pointerLocked }),
}));
