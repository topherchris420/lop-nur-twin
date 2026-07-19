import { useEffect, useRef } from "react";
import { useTwinStore } from "./store";
import { touchInput } from "./touchInput";

/** Global hotkeys: 1/2/3 cameras, N day/night, I index, R research, H help. */
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
        case "escape":
          if (s.showHelp) s.toggleHelp();
          else if (s.showResearch) s.toggleResearch();
          else if (s.showIndex) s.toggleIndex();
          else if (s.selectedId) s.select(null);
          break;
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      keys.current.delete(e.code);
    };

    // Update touchInput for orbit panning (arrow keys) and FPS movement
    const updateKeys = () => {
      const mode = useTwinStore.getState().cameraMode;
      if (mode === "orbit") {
        // Arrow keys for orbit panning
        if (keys.current.has("ArrowUp") || keys.current.has("KeyW")) {
          touchInput.moveY = 0.8;
        } else if (keys.current.has("ArrowDown") || keys.current.has("KeyS")) {
          touchInput.moveY = -0.8;
        } else {
          touchInput.moveY *= 0.8;
        }

        if (keys.current.has("ArrowRight") || keys.current.has("KeyD")) {
          touchInput.moveX = 0.8;
        } else if (keys.current.has("ArrowLeft") || keys.current.has("KeyA")) {
          touchInput.moveX = -0.8;
        } else {
          touchInput.moveX *= 0.8;
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    const interval = setInterval(updateKeys, 16);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      clearInterval(interval);
      touchInput.moveX = 0;
      touchInput.moveY = 0;
    };
  }, []);
}
