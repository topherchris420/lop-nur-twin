import { useEffect } from "react";
import { useTwinStore } from "./store";

/** Global hotkeys: 1/2/3 cameras, N day/night, I index, H help, Esc close. */
export function useKeyboardShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;

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
        case "h":
          s.toggleHelp();
          break;
        case "escape":
          if (s.showHelp) s.toggleHelp();
          else if (s.showIndex) s.toggleIndex();
          else if (s.selectedId) s.select(null);
          break;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
