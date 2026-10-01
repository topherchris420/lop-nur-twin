import { validateProposal } from "./contract";
import type { CitySimulation } from "./simulation";
/** No authority: the broker can only submit a proposal to the simulator. */
export class CityDecisionBroker {
  enabled = false;
  status = "RULES";
  requests = 0;
  accepted = 0;
  fallbacks = 0;
  private sequence = 0;
  private cursor = 0;
  private controller: AbortController | null = null;
  private disposed = false;
  private readonly session = crypto.randomUUID().replace(/-/g, "");
  constructor(
    private readonly sim: CitySimulation,
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
  ) {}
  async poll() {
    if (!this.enabled || this.disposed || this.controller || this.sim.paused) return;
    if (this.requests >= 120) {
      this.status = "BUDGET COMPLETE · RULES";
      this.enabled = false;
      return;
    }
    const agents = this.sim.agents.filter((a) => !a.inside && this.sim.hazard(a.point));
    const a = agents[this.cursor++ % Math.max(1, agents.length)];
    if (!a) {
      this.status = "IDLE · RULES";
      return;
    }
    const observation = this.sim.observe(a.id, ++this.sequence),
      controller = new AbortController();
    this.controller = controller;
    this.requests++;
    this.status = "PENDING · RULES";
    const timer = setTimeout(() => controller.abort(), 1200);
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
    if (this.sim.decisions.at(-1)?.source === "jev") {
      this.accepted++;
      this.status = "JEV VALIDATED";
    } else {
      this.fallbacks++;
      this.status = `FALLBACK · ${failure ?? "stale or invalid"}`;
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
