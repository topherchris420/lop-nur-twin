import { useState } from "react";
import { sha256Json } from "../../rain/sha256";
import type { DiscoveryView } from "./discoveryView";
import type { SessionPolicy } from "./scheduleProtocol";
export function SchedulePanel({
  view,
  act,
  busy,
}: {
  view: DiscoveryView;
  act: (action: string, extra?: Record<string, unknown>) => Promise<void>;
  busy: boolean;
}) {
  const [sessions, setSessions] = useState(2);
  const [expiry, setExpiry] = useState("");
  const [expiryLocal, setExpiryLocal] = useState("");
  const [prefix, setPrefix] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const policy: SessionPolicy = {
    schema: "rain-session-policy/v1",
    charter_sha256: view.charter_sha256 ?? "",
    expires_at: expiry,
    interval_ms: 60000,
    sessions,
    storage_bytes: 128 * 1024 * 1024,
  };
  const digest = sha256Json(policy);
  return (
    <details className="my-3">
      <summary>Schedule bounded sessions</summary>
      <p className="text-sm">
        Approve a time-limited policy after authorizing the current charter. Each session
        reserves its full compute ceiling. Restart pauses the policy; resume requires
        reconnecting its exact scope. Stop and cancel require a new policy approval.
      </p>
      <label className="block">
        Maximum sessions{" "}
        <input
          type="number"
          min={1}
          max={100}
          value={sessions}
          onChange={(e) => {
            setSessions(Number(e.target.value));
            setReviewed(false);
          }}
        />
      </label>
      <label className="block">
        Stop scheduling at (your local time){" "}
        <input
          type="datetime-local"
          value={expiryLocal}
          onChange={(e) => {
            setExpiryLocal(e.target.value);
            const date = new Date(e.target.value);
            setExpiry(Number.isFinite(date.getTime()) ? date.toISOString() : "");
            setReviewed(false);
          }}
        />
      </label>
      <pre className="whitespace-pre-wrap text-xs">
        {JSON.stringify(
          { policy, compute_ceiling_per_session: view.charter?.ceilings, digest },
          null,
          2,
        )}
      </pre>
      <label className="block">
        <input
          type="checkbox"
          checked={reviewed}
          onChange={(e) => setReviewed(e.target.checked)}
        />{" "}
        I reviewed the policy, aggregate sessions and per-session compute limits
      </label>
      <label className="block">
        First 8 policy digest characters{" "}
        <input maxLength={8} value={prefix} onChange={(e) => setPrefix(e.target.value)} />
      </label>
      <button
        disabled={busy || view.active || !reviewed || prefix !== digest.slice(0, 8)}
        onClick={() => void act("schedule", { policy, prefix, reviewed })}
      >
        Approve and arm schedule
      </button>
      {view.schedule && (
        <>
          <pre className="whitespace-pre-wrap text-xs">
            {JSON.stringify(view.schedule, null, 2)}
          </pre>
          {(["paused", "armed", "cancelled"] as const).map((command) => (
            <button
              key={command}
              disabled={busy}
              className="m-2 border p-2"
              onClick={() => void act("schedule-control", { command })}
            >
              {command === "armed"
                ? "Resume policy"
                : command === "paused"
                  ? "Pause policy"
                  : "Cancel policy"}
            </button>
          ))}
        </>
      )}
    </details>
  );
}
