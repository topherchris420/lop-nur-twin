/**
 * Occupants of the commons: a digital fly (any of the repository's
 * controllers, unchanged, or a research adapter built outside `fly/`), and
 * the record the experimenter keeps of it.
 *
 * An organism-kind fly (`OrganismAdapter` and its descendants) has
 * physiology that its own life advances, not its adapter
 * (`OrganismLife.advanceTicks`). The occupant does the same, in the same
 * order and at the same tick (physiology for 0.1 s, its maintenance supply
 * into the reserve, then the body's 0.1 s), so hunger, fatigue and sleep
 * pressure move here as they do in the deployed life's kind. Arenas held
 * them at their initial values (`CONTROLLER_APPROXIMATIONS`); the commons
 * does not.
 */
import type { DigitalFly } from "../../fly/fly.js";
import type { V3 } from "../../fly/units.js";
import { OrganismAdapter } from "../../life/organism.js";
import type { SurfaceChemistry } from "../socialSensing.js";
import {
  FLY_BODY_RADIUS_M,
  type BodyPose,
  type Occupant,
  type SocialPort,
} from "./commons.js";

/** The organism life's tick (s): `DT` in life/headless.ts. */
export const ORGANISM_TICK_S = 0.1;

export class FlyOccupant implements Occupant {
  readonly id: string;
  readonly fly: DigitalFly;
  readonly chemistry: SurfaceChemistry | null;
  readonly port?: SocialPort;
  private last: V3;
  private speed = 0;
  private sinceTick = 0;
  private readonly organism: OrganismAdapter | null;
  /** Energy the organism's maintenance supplied here (J), for the record. */
  maintenanceJ = 0;

  constructor(options: {
    id: string;
    fly: DigitalFly;
    chemistry: SurfaceChemistry | null;
    port?: SocialPort;
  }) {
    this.id = options.id;
    this.fly = options.fly;
    this.chemistry = options.chemistry ? [...options.chemistry] : null;
    if (options.port) this.port = options.port;
    const s = this.fly.state.p;
    this.last = [s[0], s[1], s[2]];
    this.organism = this.fly.adapter instanceof OrganismAdapter ? this.fly.adapter : null;
  }

  pose(): BodyPose {
    const s = this.fly.state;
    return {
      center: [s.p[0], s.p[1], s.p[2]],
      yaw: s.yaw,
      radius: FLY_BODY_RADIUS_M,
      speed: this.speed,
    };
  }

  step(dt: number): void {
    if (this.organism && this.sinceTick <= 1e-9) this.physiology();
    this.fly.advance(dt);
    this.sinceTick += dt;
    if (this.sinceTick >= ORGANISM_TICK_S - 1e-9) this.sinceTick = 0;
    const p = this.fly.state.p;
    this.speed = Math.hypot(p[0] - this.last[0], p[2] - this.last[2]) / dt;
    this.last = [p[0], p[1], p[2]];
  }

  /** As OrganismLife.advanceTicks does before each tick of the body. */
  private physiology(): void {
    const a = this.organism!;
    const fly = this.fly;
    const capacity = fly.params.reserveJ;
    const supplied = a.physiology.advance(ORGANISM_TICK_S, {
      mode: fly.state.mode,
      reserve: Math.min(fly.state.reserve, capacity),
      capacity,
    });
    if (supplied > 0) {
      fly.state.reserve = Math.min(capacity, fly.state.reserve + supplied);
      this.maintenanceJ += supplied;
    }
  }
}
