import { validateProposal } from "./contract";
import type { CitySimulation } from "./simulation";

/** Labels are claims, in Blacksite's vocabulary: LIVE JEV only after a validated answer. */
export type BrokerStatus =
  | "OFF · RULES"
  | "IDLE · RULES"
  | "PENDING · RULES"
  | "LIVE JEV"
  | "FALLBACK · TIMEOUT"
  | "FALLBACK · UNAVAILABLE"
  | "FALLBACK · ERROR"
  | "FALLBACK · STALE OR INVALID"
  | "BUDGET COMPLETE · RULES";

/**
 * No authority: the broker can only submit a proposal to the simulator, which
 * re-observes the agent, re-checks legality and staleness, and falls back to
 * its own rules for anything that does not pass.
 */
export class CityDecisionBroker {
  enabled = false;
  status: BrokerStatus = "OFF · RULES";
  requests = 0;
  accepted = 0;
  fallbacks = 0;
  lastFailure: string | null = null;
  static readonly BUDGET = 120;
  static readonly DEADLINE_MS = 1200;
  private sequence = 0;
  private cursor = 0;
  private controller: AbortController | null = null;
  private disposed = false;
  private readonly session = crypto.randomUUID().replace(/-/g, "");
  constructor(
    private readonly sim: CitySimulation,
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
  ) {}
  /**
   * Event participants first; with nothing happening, an ordinary pedestrian
   * at a choice point (a portal, a stop, a gathering place) — so the model is
   * asked about routine life too, not only emergencies.
   */
  private candidate() {
    const free = this.sim.agents.filter(
      (a) => !a.inside && a.kind !== "bus" && (a.kind !== "emergency" || a.assignment),
    );
    const involved = free.filter((a) => this.sim.involved(a.point));
    if (involved.length) return involved[this.cursor++ % involved.length];
    const choosing = free.filter((a) => {
      if (a.kind !== "pedestrian") return false;
      const o = this.sim.observe(a.id);
      return o.atPortal || o.atBusStop || o.atGathering || o.atMetro;
    });
    return choosing.length ? choosing[this.cursor++ % choosing.length] : undefined;
  }
  async poll() {
    if (!this.enabled) {
      this.status =
        this.requests >= CityDecisionBroker.BUDGET
          ? "BUDGET COMPLETE · RULES"
          : "OFF · RULES";
      return;
    }
    if (this.disposed || this.controller || this.sim.paused) return;
    if (this.requests >= CityDecisionBroker.BUDGET) {
      this.status = "BUDGET COMPLETE · RULES";
      this.enabled = false;
      return;
    }
    const a = this.candidate();
    if (!a) {
      this.status = "IDLE · RULES";
      return;
    }
    const observation = this.sim.observe(a.id, ++this.sequence),
      controller = new AbortController();
    this.controller = controller;
    this.requests++;
    this.status = "PENDING · RULES";
    const timer = setTimeout(() => controller.abort(), CityDecisionBroker.DEADLINE_MS);
    let proposal: unknown = null,
      failure: string | null = null;
    try {
      const response = await this.fetchImpl("/api/jev/decision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session: this.session, observation }),
        signal: controller.signal,
      });
      if (!response.ok)
        failure =
          response.status === 503
            ? "unavailable"
            : response.status === 504
              ? "timeout"
              : `service HTTP ${response.status}`;
      else {
        proposal = await response.json();
        if (!validateProposal(proposal, observation)) failure = "invalid provider answer";
      }
    } catch {
      failure = controller.signal.aborted ? "timeout" : "network error";
    } finally {
      clearTimeout(timer);
      this.controller = null;
    }
    if (this.disposed || !this.enabled) return;
    this.sim.accept(observation, proposal, failure);
    this.lastFailure = failure;
    if (this.sim.decisions.at(-1)?.source === "jev") {
      this.accepted++;
      this.status = "LIVE JEV";
    } else {
      this.fallbacks++;
      this.status =
        failure === "timeout"
          ? "FALLBACK · TIMEOUT"
          : failure === "unavailable"
            ? "FALLBACK · UNAVAILABLE"
            : failure
              ? "FALLBACK · ERROR"
              : "FALLBACK · STALE OR INVALID";
    }
  }
  start() {
    this.disposed = false;
  }
  dispose() {
    this.disposed = true;
    this.enabled = false;
    this.controller?.abort();
  }
}
