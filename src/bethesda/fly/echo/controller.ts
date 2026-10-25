/** ECHO extends the existing adapter seam. The legacy controller retains its
 * existing inputs; EchoModel sees only the separate closed sensor port.
 */
import type {
  AdapterDescriptor,
  BodySnapshot,
  DecisionInput,
  FlyNeuralAdapter,
  MotorCommand,
} from "../neural.js";
import type { ResolvedParams } from "../params.js";
import {
  EchoModel,
  ECHO_VERSION,
  type EchoVariant,
  type MotionObservation,
} from "./model.js";

export class EchoController implements FlyNeuralAdapter {
  readonly descriptor: AdapterDescriptor;
  readonly inner: FlyNeuralAdapter;
  private estimate: EchoModel;
  get model(): EchoModel {
    return this.estimate;
  }
  /** Host-only explicit reset ablation; never used by the observation panel. */
  resetExperimentalModel(model: EchoModel): void {
    if (this.estimate.variant !== "reset_memory" || model.variant !== "reset_memory")
      throw new Error("Reset requires the explicit amnesia configuration");
    this.estimate = model;
  }
  constructor(inner: FlyNeuralAdapter, variant: EchoVariant = "full", model?: EchoModel) {
    if (model && model.variant !== variant)
      throw new Error("ECHO checkpoint configuration mismatch");
    this.inner = inner;
    this.estimate = model ?? new EchoModel(variant);
    this.descriptor = {
      ...inner.descriptor,
      id: `${ECHO_VERSION}/${variant}`,
      label: "Project ECHO (experimental)",
      fidelity:
        "Bounded adaptive self-model over idealized local motion feedback; no neurons or subjective consciousness are simulated.",
    };
  }
  get state() {
    return {
      inner: (this.inner as { state?: unknown }).state ?? null,
      echo: this.model.state,
    };
  }
  start(body: BodySnapshot): void {
    this.inner.start?.(body);
  }
  observeMotion(o: MotionObservation): void {
    this.model.observe(o);
  }
  acceptedMotion(
    command: MotorCommand,
    params: ResolvedParams,
    interrupted: boolean,
  ): void {
    if (interrupted) {
      this.model.invalidate();
      return;
    }
    this.model.predict({
      mode: command.mode,
      walkSpeedCmS: command.walkSpeed ?? 0,
      yawRate: command.yawRate ?? 0,
      dt: params.decisionPeriodMs / 1000,
      stepS: params.physicsStepMs / 1000,
      walkTauS: params.walkSpeedTauS,
    });
  }
  invalidateMotion(): void {
    this.model.invalidate();
  }
  interrupt(input: DecisionInput): MotorCommand | null {
    return this.inner.interrupt?.(input) ?? null;
  }
  decide(input: DecisionInput): MotorCommand {
    const command = this.inner.decide(input);
    // Escape, landing, feeding and grooming keep the native controller's action.
    if (
      command.mode !== "walk" ||
      (command.walkSpeed !== undefined &&
        (!Number.isFinite(command.walkSpeed) ||
          command.walkSpeed < 0 ||
          command.walkSpeed > input.params.walkSpeedMaxCmS)) ||
      (command.yawRate !== undefined &&
        (!Number.isFinite(command.yawRate) || Math.abs(command.yawRate) > Math.PI * 4))
    )
      return command;
    const adjusted = this.model.regulate(
      command.walkSpeed ?? 0,
      command.yawRate ?? 0,
      input.params.walkSpeedMaxCmS,
    );
    return { ...command, walkSpeed: adjusted.speed, yawRate: adjusted.turn };
  }
}
