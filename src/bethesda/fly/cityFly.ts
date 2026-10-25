import { ReducedOrderController } from "./controller.js";
import { EchoController } from "./echo/controller.js";
import { EchoModel, type EchoVariant } from "./echo/model.js";
/**
 * The one digital fly that lives in Bethesda, stepped with the city.
 *
 * It is placed on the mapped bench or picnic table nearest the arrival point
 * and advanced one city tick (0.1 s) after each `sim.step()`, so it is paused
 * when the city is paused and keeps going while the visitor is in the lab.
 * The pedestrians near it look at it twenty times a second as it advances
 * (`people.ts`): they may notice it, follow it with their eyes and swat at
 * it, and their hands are moving things it sees. They walk on as the city
 * moves them: nothing they do about the fly reaches the city.
 * Its seed derives from the city's, so a given city configuration always
 * holds the same fly. Its code is a chunk of its own, so the page places it
 * at whatever tick the city has reached when that code arrives (App.tsx). It
 * reads the city and never writes to it: it is not a recorded command, not in
 * the city's state hash and not in a city replay. A replayed city gets a fly
 * placed fresh at the replay's tick.
 */
import { arrival } from "../model";
import { BENCH, PICNIC_TABLE } from "../furniture";
import { DT, type CitySimulation } from "../simulation";
import { groundAt } from "../terrain";
import { BethesdaFlyWorld, homeSeat } from "./bethesdaWorld.js";
import { DigitalFly, FLY_VERSION } from "./fly.js";
import { People } from "./people.js";
import type { V3 } from "./units.js";

/** The city's fly is placed somewhat hungry, so that it forages (a model choice; `startReserve`). */
export const CITY_START_RESERVE = 0.6;
/** The people look at the fly this many times per city tick (20 Hz). */
const LOOKS_PER_TICK = 2;

export class CityFly {
  readonly fly: DigitalFly;
  readonly world: BethesdaFlyWorld;
  /** The pedestrians as they perceive the fly and what they do about it. */
  readonly people: People;
  readonly seed: number;
  readonly placedAtTick: number;
  readonly placedOn: string;
  /** Set if the fly ever threw; it then stops, and the city carries on without it. */
  failed: string | null = null;
  private sim: CitySimulation;
  private lastTick: number;

  constructor(sim: CitySimulation, options: { echo?: EchoVariant } = {}) {
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
    this.world = new BethesdaFlyWorld(sim);
    this.seed = (Math.imul(sim.config.seed, 0x9e3779b1) ^ 0x0f1e5) >>> 0;
    this.placedAtTick = sim.tick;
    this.lastTick = sim.tick;
    this.fly = new DigitalFly({
      seed: this.seed,
      world: this.world,
      start: { p: [at.x, groundAt(at) + top + 0.002, at.z], yaw: Math.PI / 2 },
      config: { startReserve: CITY_START_RESERVE },
      ...(options.echo
        ? {
            adapter: (rng: () => number, streams: { navigation: () => number }) =>
              new EchoController(
                new ReducedOrderController(rng, streams.navigation),
                options.echo,
                new EchoModel(options.echo, { seed: this.seed, simulator: FLY_VERSION }),
              ),
          }
        : {}),
    });
    this.people = new People({
      seed: this.seed,
      sight: (from, to) => this.clearLine(from, to),
      where: (id, t) => this.world.personAt(id, t),
    });
    this.world.attachPeople(this.people);
  }

  /** Whether a person at `from` sees `to` past the city's static geometry (glass is seen through). */
  clearLine(from: V3, to: V3): boolean {
    const d: V3 = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
    const len = Math.hypot(...d);
    if (!(len > 0)) return true;
    const hit = this.world.raycast(from, [d[0] / len, d[1] / len, d[2] / len], len, true);
    return !hit || hit.t >= len - 0.01;
  }

  /** Everything that decides what comes next for the fly and the people near it. */
  stateHash(): string {
    return `${this.fly.stateHash()}:${this.people.stateHash()}`;
  }

  /** The people near the fly look at it. */
  private look(): void {
    const s = this.fly.state;
    this.people.observe(
      s.t,
      { p: s.p, flying: s.mode === "flight" || s.mode === "land" },
      this.world.peopleNear(s.t, s.p, this.people.range),
    );
  }

  /** The fly is paused exactly when the city is. */
  get paused(): boolean {
    return this.sim.paused;
  }

  /**
   * Advance with the city: once per tick the city actually took. Only the
   * city's present is known, so after several ticks at once the people and
   * vehicles move from where the fly last saw them to where they are now
   * across all of those ticks, not within the first.
   */
  tick(): void {
    if (this.failed || this.sim.tick === this.lastTick) return;
    const ticks = this.sim.tick - this.lastTick;
    this.lastTick = this.sim.tick;
    if (ticks <= 0) return;
    try {
      const t = this.fly.state.t;
      this.world.sync(t, t + ticks * DT, this.fly.state.p);
      // The fly's trajectory does not depend on how its advance is split.
      for (let k = 0; k < ticks * LOOKS_PER_TICK; k++) {
        this.look();
        this.fly.advance(DT / LOOKS_PER_TICK);
      }
    } catch (e) {
      this.failed = e instanceof Error ? e.message : String(e);
    }
  }
}
