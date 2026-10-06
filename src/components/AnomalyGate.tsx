import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { resolvesBethesda } from "../bethesda/discovery";
import { isChunkLoadError, reloadPage, STALE_BUILD_NOTICE } from "@/lib/staleBuild";
import { closeLayer, forgetLayers, onLayersChange, pushLayer } from "@/lib/historyLayers";
const Bethesda = lazy(() => import("../bethesda/App"));
class Boundary extends Component<
  { children: ReactNode; onReturn: () => void },
  { failed: false | "stale" | "error" }
> {
  state: { failed: false | "stale" | "error" } = { failed: false };
  static getDerivedStateFromError(error: unknown) {
    return { failed: isChunkLoadError(error) ? "stale" : "error" };
  }
  render() {
    return this.state.failed ? (
      <div
        role="alert"
        className="absolute inset-0 z-50 grid place-items-center bg-[#071012] p-6 text-center text-teal-100"
      >
        <div className="max-w-md">
          <p>Location could not resolve.</p>
          {this.state.failed === "stale" ? (
            <p className="mt-3 text-sm text-teal-100/80">
              {STALE_BUILD_NOTICE} The location is resolved again from the twin.
            </p>
          ) : null}
          <div className="mt-4 flex justify-center gap-6">
            {this.state.failed === "stale" ? (
              <button className="underline" onClick={reloadPage}>
                Reload
              </button>
            ) : null}
            <button className="underline" onClick={this.props.onReturn}>
              Return to Lop Nur
            </button>
          </div>
        </div>
      </div>
    ) : (
      this.props.children
    );
  }
}
/** The site the twin normally resolves, and where the anomaly lands. */
const FROM = { lat: 40.77252, lon: 89.28122 };
const TO = { lat: 38.9847, lon: -77.0947 };
const GLYPHS = "0123456789·°/#";
function format(lat: number, lon: number) {
  return `${Math.abs(lat).toFixed(5)}° ${lat >= 0 ? "N" : "S"} · ${Math.abs(lon).toFixed(5)}° ${lon >= 0 ? "E" : "W"}`;
}
/**
 * The telemetry drifts from Lop Nur's coordinates into Bethesda's, decaying
 * glitches and all, then settles. Reduced motion shows the settled card.
 */
function Resolution() {
  const reduce =
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches;
  const [t, setT] = useState(reduce ? 1 : 0);
  useEffect(() => {
    if (reduce) return;
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / 1100);
      setT(p);
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [reduce]);
  const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const text = format(
    FROM.lat + (TO.lat - FROM.lat) * e,
    FROM.lon + (TO.lon - FROM.lon) * e,
  );
  const noisy = [...text]
    .map((c, i) =>
      t < 1 &&
      /[0-9]/.test(c) &&
      (Math.sin(i * 12.9898 + t * 78.233) * 43758.5453) % 1 > 0.55 + t * 0.45
        ? GLYPHS[(i + Math.floor(t * 40)) % GLYPHS.length]
        : c,
    )
    .join("");
  return (
    <div
      role="status"
      className="absolute inset-0 z-50 grid place-items-center bg-[#071012] text-center font-mono text-[#afc9c7]"
    >
      <div>
        <p className="text-xs tracking-[.32em]">ANOMALOUS LOCATION RESOLUTION</p>
        <p className="mt-6 text-sm tracking-[.18em] opacity-70" aria-hidden="true">
          {noisy}
        </p>
        <p className="mt-4 text-4xl tracking-[.2em]" style={{ opacity: 0.25 + 0.75 * t }}>
          39° N · 77° W
        </p>
        <p className="mt-5 text-sm tracking-[.5em]" style={{ opacity: t }}>
          BETHESDA
        </p>
      </div>
    </div>
  );
}
/** Other hidden entrances (the site index) ask the gate to resolve. */
export const ANOMALY_EVENT = "lop-nur:anomalous-resolution";
/** The history layer the city occupies (see `historyLayers.ts`). */
const LAYER = "anomaly";
export function AnomalyGate({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<"dormant" | "resolver" | "transition" | "city">(
      "dormant",
    ),
    [text, setText] = useState(""),
    [error, setError] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        (e.target as HTMLElement | null)?.matches(
          "input,textarea,select,[contenteditable]",
        )
      )
        return;
      if (e.code === "Backquote" && phase === "dormant") {
        e.preventDefault();
        setPhase("resolver");
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [phase]);
  // The city takes a history entry, so Back returns to the twin rather than
  // leaving the site; "Return to the desert" goes back through the same entry.
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const enter = useRef(() => {
    if (phaseRef.current === "transition" || phaseRef.current === "city") return;
    setError("");
    pushLayer(LAYER);
    setPhase("transition");
  });
  const leave = useRef(() => {
    if (closeLayer(LAYER)) return;
    setPhase("dormant");
    setText("");
  });
  useEffect(() => {
    // An entry left over from before a reload opens nothing.
    forgetLayers(() => false);
    return onLayersChange((layers) => {
      const open = phaseRef.current === "transition" || phaseRef.current === "city";
      if (open && !layers.includes(LAYER)) {
        setPhase("dormant");
        setText("");
      } else if (!open) forgetLayers(() => false);
    });
  }, []);
  useEffect(() => {
    const resolve = () => enter.current();
    window.addEventListener(ANOMALY_EVENT, resolve);
    return () => window.removeEventListener(ANOMALY_EVENT, resolve);
  }, []);
  useEffect(() => {
    if (phase === "resolver") ref.current?.focus();
    if (phase !== "transition") return;
    const timer = setTimeout(() => setPhase("city"), 1400);
    return () => clearTimeout(timer);
  }, [phase]);
  if (phase === "transition") return <Resolution />;
  if (phase === "city")
    return (
      <Boundary onReturn={() => leave.current()}>
        <Suspense fallback={<Resolution />}>
          <Bethesda onReturn={() => leave.current()} />
        </Suspense>
      </Boundary>
    );
  return (
    <>
      {children}
      {phase === "resolver" ? (
        <div className="absolute bottom-5 left-5 z-50 w-[min(90vw,360px)] rounded border border-teal-100/20 bg-[#071012]/95 p-4 font-mono text-xs text-teal-100">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (resolvesBethesda(text)) enter.current();
              else setError("UNRESOLVED · latitude, longitude");
            }}
          >
            <label htmlFor="anomaly-coordinate" className="tracking-[.2em]">
              TELEMETRY RESOLVER
            </label>
            <input
              ref={ref}
              id="anomaly-coordinate"
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={64}
              placeholder="latitude, longitude"
              className="mt-3 w-full rounded border border-teal-100/20 bg-transparent p-2"
              onKeyDown={(e) => {
                if (e.key === "Escape") setPhase("dormant");
              }}
            />
            <p role="status" className="mt-2">
              {error || "A location is a hypothesis."}
            </p>
            <div className="mt-3 flex gap-4">
              <button type="submit">Resolve</button>
              <button type="button" onClick={() => setPhase("dormant")}>
                Dismiss
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}
