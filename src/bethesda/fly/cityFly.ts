/**
 * The one digital fly that lives in Bethesda, stepped with the city.
 *
 * It is placed on the mapped bench or picnic table nearest the arrival point
 * and advanced one city tick (0.1 s) after each `sim.step()`, so it is paused
 * when the city is paused and keeps going while the visitor is in the lab.
 * Its seed derives from the city's, so a given city configuration always
 * holds the same fly. It reads the city and never writes to it: it is not a
 * recorded command, not in the city's state hash and not in a city replay. A
 * replayed city gets a fly placed fresh at the replay's tick.
 */
import { arrival } from "../model";
import { BENCH, PICNIC_TABLE } from "../furniture";
import { DT, type CitySimulation } from "../simulation";
import { groundAt } from "../terrain";
import { BethesdaFlyWorld, homeSeat } from "./bethesdaWorld.js";
import { DigitalFly } from "./fly.js";

export class CityFly {
  readonly fly: DigitalFly;
  readonly world: BethesdaFlyWorld;
  readonly seed: number;
  readonly placedAtTick: number;
  readonly placedOn: string;
  /** Set if the fly ever threw; it then stops, and the city carries on without it. */
  failed: string | null = null;
  private sim: CitySimulation;
  private lastTick: number;

  constructor(sim: CitySimulation) {
    this.sim = sim;
    const seat = homeSeat(arrival);
    const at = seat?.point ?? arrival;
    const top =
      seat?.kind === "picnic_table"
        ? PICNIC_TABLE.top.y + PICNIC_TABLE.top.h / 2
        : seat
          ? BENCH.seat.y + BENCH.seat.h / 2
          : 0;
    this.placedOn = seat
      ? `${seat.kind === "picnic_table" ? "picnic table" : "bench"} (OSM ${seat.osmId})`
      : "the ground at the arrival point";
    this.world = new BethesdaFlyWorld(sim, at);
    this.seed = (Math.imul(sim.config.seed, 0x9e3779b1) ^ 0x0f1e5) >>> 0;
    this.placedAtTick = sim.tick;
    this.lastTick = sim.tick;
    this.fly = new DigitalFly({
      seed: this.seed,
      world: this.world,
      start: { p: [at.x, groundAt(at) + top + 0.002, at.z], yaw: Math.PI / 2 },
    });
  }

  /** The fly is paused exactly when the city is. */
  get paused(): boolean {
    return this.sim.paused;
  }

  /** Advance with the city: once per tick the city actually took. */
  tick(): void {
    if (this.failed || this.sim.tick === this.lastTick) return;
    const ticks = this.sim.tick - this.lastTick;
    this.lastTick = this.sim.tick;
    try {
      for (let k = 0; k < ticks; k++) {
        const t = this.fly.state.t;
        this.world.sync(t, t + DT);
        this.fly.advance(DT);
      }
    } catch (e) {
      this.failed = e instanceof Error ? e.message : String(e);
    }
  }
}
