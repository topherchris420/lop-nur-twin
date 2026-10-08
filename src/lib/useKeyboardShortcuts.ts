import { useEffect, useRef } from "react";
import { useTwinStore } from "./store";
import { resetKeyboardPan, stepKeyboardPan } from "./keyboardPan";

/** Global hotkeys: 1/2/3 cameras, N day/night, I index, R research, M measure, L lens, H help. */
export function useKeyboardShortcuts(): void {
  const keys = useRef<Set<string>>(new Set());

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const isEditing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT" ||
        target?.isContentEditable;
      if (isEditing && e.key !== "Escape") return;

      keys.current.add(e.code);

      const s = useTwinStore.getState();
      switch (e.key.toLowerCase()) {
        case "1":
          s.setCameraMode("orbit");
          break;
        case "2":
          s.setCameraMode("fps");
          break;
        case "3":
          s.setCameraMode("cinematic");
          break;
        case "n":
          s.toggleNight();
          break;
        case "i":
          s.toggleIndex();
          break;
        case "r":
          s.toggleResearch();
          break;
        case "h":
          s.toggleHelp();
          break;
        case "m":
          s.toggleMeasureMode();
          break;
        case "l":
          s.toggleLens();
          break;
        case "escape":
          if (s.showHelp) s.toggleHelp();
          else if (s.showResearch) s.toggleResearch();
          else if (s.showIndex) s.toggleIndex();
          else if (s.measureMode || s.measurePoints.length > 0) {
            s.clearMeasure();
            if (s.measureMode) s.toggleMeasureMode();
          } else if (s.selectedId) s.select(null);
          break;
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      keys.current.delete(e.code);
    };

    // A key released while the window is not focused (Alt-Tab, a click into
    // another app, a hidden tab) never delivers its keyup here, so the held
    // set is dropped whenever focus or visibility goes.
    const releaseAll = () => keys.current.clear();
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") releaseAll();
    };

    // Arrow keys / WASD pan the orbit camera through their own channel, so the
    // ease-out after release never touches the touch pan-stick's deflection.
    const updateKeys = () => {
      if (useTwinStore.getState().cameraMode === "orbit") {
        stepKeyboardPan(keys.current);
      } else {
        resetKeyboardPan();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", releaseAll);
    document.addEventListener("visibilitychange", onVisibilityChange);

    const interval = setInterval(updateKeys, 16);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", releaseAll);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      clearInterval(interval);
      releaseAll();
      resetKeyboardPan();
    };
  }, []);
}
