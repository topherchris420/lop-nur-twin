/** Operator-owned scheduling vocabulary. No model may issue these controls. */
import { closed } from "./discoveryProtocol.js";
export interface SessionPolicy {
  schema: "rain-session-policy/v1";
  charter_sha256: string;
  expires_at: string;
  interval_ms: number;
  sessions: number;
  storage_bytes: number;
}
export const SESSION_POLICY_SCHEMA = closed({
  schema: { const: "rain-session-policy/v1" },
  charter_sha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
  expires_at: { type: "string", maxLength: 32 },
  interval_ms: { type: "integer", minimum: 10000, maximum: 86400000 },
  sessions: { type: "integer", minimum: 1, maximum: 100 },
  storage_bytes: { type: "integer", minimum: 1048576, maximum: 268435456 },
});
export interface ScheduleView {
  policy: SessionPolicy;
  digest: string;
  status: "paused" | "armed" | "cancelled" | "stopped" | "expired" | "exhausted";
  started: number;
  next_at: string | null;
  reserved: {
    model_calls: number;
    experiments: number;
    runtime_ms: number;
    model_tokens: number | null;
  };
}
