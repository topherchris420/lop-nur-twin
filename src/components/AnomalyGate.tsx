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
const Bethesda = lazy(() => import("../bethesda/App"));
class Boundary extends Component<
  { children: ReactNode; onReturn: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div className="absolute inset-0 z-50 grid place-items-center bg-[#071012] text-teal-100">
        <div>
          <p>Location could not resolve.</p>
          <button className="mt-4 underline" onClick={this.props.onReturn}>
            Return to Lop Nur
          </button>
        </div>
      </div>
    ) : (
      this.props.children
    );
  }
}
function Resolution() {
  return (
    <div
      role="status"
      className="absolute inset-0 z-50 grid place-items-center bg-[#071012] text-center font-mono text-[#afc9c7]"
    >
      <div>
        <p className="text-xs tracking-[.32em]">ANOMALOUS LOCATION RESOLUTION</p>
        <p className="mt-6 text-4xl tracking-[.2em]">39° N · 77° W</p>
        <p className="mt-5 text-sm tracking-[.5em]">BETHESDA</p>
      </div>
    </div>
  );
}
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
  useEffect(() => {
    if (phase === "resolver") ref.current?.focus();
    if (phase !== "transition") return;
    const timer = setTimeout(() => setPhase("city"), 1400);
    return () => clearTimeout(timer);
  }, [phase]);
  if (phase === "transition") return <Resolution />;
  if (phase === "city")
    return (
      <Boundary onReturn={() => setPhase("dormant")}>
        <Suspense fallback={<Resolution />}>
          <Bethesda
            onReturn={() => {
              setPhase("dormant");
              setText("");
            }}
          />
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
              if (resolvesBethesda(text)) {
                setError("");
                setPhase("transition");
              } else setError("UNRESOLVED · latitude, longitude");
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
