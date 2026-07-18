import { useEffect, useRef, useState } from "react";
import { useTwinStore } from "@/lib/store";

/**
 * Branded boot screen shown while the 3D scene warms up (texture generation,
 * first frame). Fades out once the store's `ready` flag flips, then unmounts so
 * it never eats pointer events afterwards.
 */
export function IntroOverlay() {
  const ready = useTwinStore((s) => s.ready);
  const [mounted, setMounted] = useState(true);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!ready) return;
    // keep the panel up briefly after the first frame, then fade + unmount
    timer.current = window.setTimeout(() => setMounted(false), 900);
    return () => window.clearTimeout(timer.current);
  }, [ready]);

  if (!mounted) return null;

  return (
    <div
      className={[
        "pointer-events-none absolute inset-0 z-50 flex flex-col items-center justify-center",
        "bg-background transition-opacity duration-700 ease-out",
        ready ? "opacity-0" : "opacity-100",
      ].join(" ")}
    >
      {/* faint reticle rings */}
      <div className="relative flex h-40 w-40 items-center justify-center">
        <span className="absolute inset-0 animate-ping rounded-full border border-primary/25" />
        <span className="absolute inset-3 rounded-full border border-primary/20" />
        <span className="absolute inset-8 rounded-full border border-primary/30" />
        <span className="scan-sweep absolute inset-0 rounded-full" />
        <span className="h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_12px_var(--color-primary)]" />
      </div>

      <div className="mt-8 text-center">
        <div className="text-foreground/90 font-mono text-sm tracking-[0.4em] uppercase">
          Lop Nur
        </div>
        <div className="text-muted-foreground mt-1 font-mono text-[10px] tracking-[0.3em] uppercase">
          Test Airfield · Xinjiang · Digital Twin
        </div>
      </div>

      <div className="text-muted-foreground/70 mt-6 font-mono text-[10px] tracking-[0.2em] uppercase">
        {ready ? "Site online" : "Reconstructing site…"}
      </div>
    </div>
  );
}
