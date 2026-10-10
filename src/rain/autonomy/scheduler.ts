/** Durable bounded scheduling over the native journal. Restart is always disarmed.
 * Reservations are recorded before work starts and never refunded after a crash.
 * Every session still requires the separately authorized, unchanged native charter.
 */
import { checkData } from "../../bethesda/rain/discoveryProtocol.js";
import {
  SESSION_POLICY_SCHEMA,
  type SessionPolicy,
  type ScheduleView,
} from "../../bethesda/rain/scheduleProtocol.js";
import {
  charterSha256,
  verifyCharterAuthorization,
  type Charter,
  type CharterAuthorization,
} from "../../bethesda/rain/standing.js";
import { sha256Json } from "../sha256.js";
import type { ResearchStore } from "./store.js";

export function createSessionScheduler(store: ResearchStore, now = () => Date.now()) {
  let armed = false;
  let pending = false;
  const entries = () => store.discoveryEntries();
  const state = (): ScheduleView | null => {
    const approved = entries()
      .filter((e) => e.kind === "schedule-approved")
      .at(-1);
    if (!approved) return null;
    const p = approved.payload as {
      policy: SessionPolicy;
      digest: string;
      ceilings: Charter["ceilings"];
    };
    const events = entries().filter(
      (e) =>
        e.sequence > approved.sequence &&
        (e.payload as { digest?: string }).digest === p.digest,
    );
    const starts = events.filter((e) => e.kind === "schedule-reserved");
    const lastControl = events.filter((e) => e.kind === "schedule-control").at(-1)
      ?.payload as { status: ScheduleView["status"] } | undefined;
    const last = starts.at(-1);
    const due = last ? Date.parse(last.at) + p.policy.interval_ms : now();
    const terminal =
      lastControl?.status === "cancelled" || lastControl?.status === "stopped";
    return {
      policy: p.policy,
      digest: p.digest,
      started: starts.length,
      status: terminal
        ? lastControl.status
        : now() >= Date.parse(p.policy.expires_at)
          ? "expired"
          : starts.length >= p.policy.sessions
            ? "exhausted"
            : armed
              ? "armed"
              : "paused",
      next_at: terminal ? null : new Date(due).toISOString(),
      reserved: {
        model_calls: starts.length * p.ceilings.model_calls,
        experiments: starts.length * p.ceilings.experiments,
        runtime_ms: starts.length * p.ceilings.runtime_ms,
        model_tokens:
          p.ceilings.model_tokens === null
            ? null
            : starts.length * p.ceilings.model_tokens,
      },
    };
  };
  const validate = (
    policy: SessionPolicy,
    charter: Charter,
    authorization: CharterAuthorization,
  ) => {
    const checked = checkData<SessionPolicy>(policy, SESSION_POLICY_SCHEMA);
    if (!checked.ok) throw new Error(checked.errors.join("; "));
    const expiry = Date.parse(policy.expires_at);
    if (
      !Number.isFinite(expiry) ||
      expiry <= now() ||
      expiry > now() + 7 * 86400000 ||
      expiry > Date.parse(authorization.expires_at)
    )
      throw new Error(
        "Policy must expire within seven days and its charter authorization",
      );
    if (policy.charter_sha256 !== charterSha256(charter))
      throw new Error("Scheduler charter mismatch");
    const errors = verifyCharterAuthorization(authorization, charter);
    if (errors.length || Date.parse(authorization.authorized_at) > now())
      throw new Error("Current charter authorization required");
    if (
      policy.storage_bytes > store.maxBytes ||
      store.storageBytes() >= policy.storage_bytes
    )
      throw new Error("Scheduler storage ceiling exceeded");
  };
  return {
    state,
    approve(
      policy: SessionPolicy,
      charter: Charter,
      authorization: CharterAuthorization,
      prefix: string,
      reviewed: boolean,
    ) {
      if (pending || store.lock()) throw new Error("Stop active work before scheduling");
      validate(policy, charter, authorization);
      const digest = sha256Json(policy);
      if (!reviewed || prefix !== digest.slice(0, 8))
        throw new Error("Review the policy and confirm its digest");
      store.appendDiscovery("scheduler", "schedule-approved", {
        policy: structuredClone(policy),
        digest,
        ceilings: charter.ceilings,
        operator: authorization.operator,
      });
      armed = true;
      return state();
    },
    control(status: "paused" | "armed" | "cancelled" | "stopped") {
      const current = state();
      if (!current) return null;
      if (
        status === "armed" &&
        ["cancelled", "stopped", "expired", "exhausted"].includes(current.status)
      )
        throw new Error("Terminal policy requires a new explicit approval");
      if (["cancelled", "stopped", "expired", "exhausted"].includes(current.status))
        return current;
      armed = status === "armed";
      store.appendDiscovery("scheduler", "schedule-control", {
        digest: current.digest,
        status,
      });
      return state();
    },
    async tick(
      charter: Charter,
      authorization: CharterAuthorization,
      run: () => Promise<unknown>,
    ) {
      const current = state();
      if (
        !current ||
        current.status !== "armed" ||
        pending ||
        store.lock() ||
        Date.parse(current.next_at!) > now()
      )
        return false;
      validate(current.policy, charter, authorization);
      pending = true;
      try {
        // Reserve the entire session ceiling, not a model's predicted usage.
        store.appendDiscovery("scheduler", "schedule-reserved", {
          digest: current.digest,
          ordinal: current.started + 1,
          charter_sha256: current.policy.charter_sha256,
        });
        await run();
        store.appendDiscovery("scheduler", "schedule-completed", {
          digest: current.digest,
          ordinal: current.started + 1,
        });
        return true;
      } catch (error) {
        armed = false;
        store.appendDiscovery("scheduler", "schedule-control", {
          digest: current.digest,
          status: "stopped",
          reason: String(error),
        });
        throw error;
      } finally {
        pending = false;
      }
    },
  };
}
