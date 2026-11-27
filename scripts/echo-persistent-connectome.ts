/** Rehearse a continuation on an ECHO plasticity checkpoint. Each output
 * contains the body, the entire neural state and its motor sampling clock.
 * This command writes a new file and never opens the original life store. */
import {
  closeSync,
  fsyncSync,
  linkSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { sha256Json } from "../src/rain/sha256.js";
import {
  checkpointLife,
  restoreLife,
  type LifeCheckpoint,
} from "../src/bethesda/life/continuity.js";
import type { HeadlessGenesis } from "../src/bethesda/life/headless.js";
import {
  PLASTICITY_LIFE,
  PlasticityOrganismAdapter,
} from "../src/bethesda/life/plasticOrganism.js";
import {
  PERCHED,
  type DecisionInput,
  type MotorCommand,
} from "../src/bethesda/fly/neural.js";
import {
  descendingCommand,
  sensable,
  SmallObjectEye,
  type Readouts,
} from "./echo-neural-shadow.js";
import { wrapAngle } from "../src/bethesda/fly/units.js";
import { SyncBrain } from "./fly-neural-sync.js";

const SCHEMA = "echo-banc-rehearsal/v1";
type Body = LifeCheckpoint<HeadlessGenesis>;
interface Clock {
  bin: number;
  eye: ReturnType<SmallObjectEye["snapshot"]>;
  observation: ReturnType<typeof sensable> | null;
  signals: Readouts | null;
}
interface Pair {
  schema: typeof SCHEMA;
  checkpoint: Body;
  clock: Clock;
  neural: unknown;
}

function saveExclusive(path: string, pair: Pair) {
  const dir = dirname(path);
  const temp = mkdtempSync(join(dir, ".echo-checkpoint-"));
  try {
    const file = join(temp, "pair.json");
    writeFileSync(file, JSON.stringify(pair), { mode: 0o600, flush: true });
    linkSync(file, path);
    const fd = openSync(dir, "r");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

function drive(input: DecisionInput, intention: MotorCommand, r: Readouts): MotorCommand {
  if (intention.mode === "escape" || intention.mode === "takeoff") return intention;
  if (PERCHED.has(input.body.mode)) {
    if (r.escape.predicted || r.jump?.predicted)
      return {
        mode: "escape",
        heading: wrapAngle(
          input.body.yaw + (input.frame.looming?.bearing ?? 0) + Math.PI,
        ),
        prepare: input.params.shortModePrepMs / 1000,
        reason: "BANC escape readout",
      };
    if (input.body.onFood !== null && r.feed.predicted)
      return { mode: "feed", reason: "BANC MN9 feeding readout" };
  }
  return descendingCommand(input, intention, r);
}

export function rehearse(
  mode: string,
  inputFile: string,
  outputFile: string,
  individual: string,
  root: string,
  ticks: number,
) {
  if (
    !["attach", "resume"].includes(mode) ||
    !Number.isSafeInteger(ticks) ||
    ticks < 0 ||
    ticks > 10000
  )
    throw new Error("expected attach or resume and 0–10000 body ticks");
  const input = JSON.parse(readFileSync(inputFile, "utf8"));
  if ((input.schema === SCHEMA) !== (mode === "resume"))
    throw new Error("attach accepts a body checkpoint; resume requires a complete pair");
  const source: Body = input.checkpoint ?? input;
  if (source.birth.individual !== individual) throw new Error("ECHO individual mismatch");
  const life = restoreLife(PLASTICITY_LIFE, source);
  const clock: Clock =
    mode === "resume"
      ? input.clock
      : {
          bin: Math.round(life.cityFly.fly.state.t * 10000),
          signals: null,
          observation: null,
          eye: null,
        };
  const binding = (body: Body) => sha256Json({ checkpoint: body.digest, clock });
  const brain = new SyncBrain({
    command: process.env.FLY_NEURAL_PYTHON || "python",
    args: ["-m", "fly_neural.persistent", resolve(root)],
    cwd: resolve("fly-neural"),
    header: {
      individual,
      ...(mode === "resume" ? { body: binding(source), checkpoint: input.neural } : {}),
    },
    bufferBytes: 16 * 1024 * 1024,
  });
  try {
    const adapter = life.adaptive;
    const eye = new SmallObjectEye(clock.eye);
    function sense(input: DecisionInput) {
      const bin = Math.round(input.body.t * 10000);
      if (bin < clock.bin) throw new Error("ECHO sensory clock moved backward");
      if (bin === clock.bin && clock.observation) return;
      if (bin > clock.bin) {
        // The stimulus held through the elapsed interval was known at its start.
        const reply = brain.request({
          duration_ms: (bin - clock.bin) / 10,
          obs: clock.observation ?? {},
        });
        clock.signals = reply.readouts as Readouts;
      }
      clock.observation = sensable(input);
      clock.observation.smallObject = eye.see(input.frame);
      clock.eye = eye.snapshot();
      clock.bin = bin;
    }
    // These hooks are local to this restored instance. The original graph
    // remains serializable by its own release. Reinstall after each verified restore.
    Object.defineProperties(adapter, {
      decide: {
        configurable: true,
        value(input: DecisionInput) {
          sense(input);
          return PlasticityOrganismAdapter.prototype.decide.call(adapter, input);
        },
      },
      interrupt: {
        configurable: true,
        value(input: DecisionInput) {
          sense(input);
          return PlasticityOrganismAdapter.prototype.interrupt.call(adapter, input);
        },
      },
      shape: {
        configurable: true,
        value(input: DecisionInput, intention: MotorCommand) {
          const base = adapter.plasticity.shape(input, intention);
          return clock.signals ? drive(input, base, clock.signals) : base;
        },
      },
    });
    try {
      life.advanceTicks(ticks);
      if (life.cityFly.failed !== null) throw new Error(String(life.cityFly.failed));
    } finally {
      for (const name of ["shape", "interrupt", "decide"])
        Reflect.deleteProperty(adapter, name);
    }
    const checkpoint = checkpointLife(PLASTICITY_LIFE, life, {
      genesis: source.genesis,
      birth: source.birth,
      previous: source,
    });
    const neural = brain.request({ pack: binding(checkpoint) }).checkpoint;
    saveExclusive(outputFile, { schema: SCHEMA, checkpoint, clock, neural });
    return {
      individual,
      tick: checkpoint.tick,
      sensoryBin: clock.bin,
      model: brain.ready.pin,
    };
  } finally {
    brain.close();
  }
}

if (
  process.argv
    .slice(1, 3)
    .some(
      (x) =>
        x.endsWith("/echo-persistent-connectome.ts") ||
        x === "scripts/echo-persistent-connectome.ts",
    )
) {
  const args = process.argv.slice(
    process.argv.findIndex((x) => x.endsWith("echo-persistent-connectome.ts")) + 1,
  );
  if (args.length !== 6)
    throw new Error("usage: attach|resume INPUT OUTPUT INDIVIDUAL MODEL_ROOT TICKS");
  console.log(
    JSON.stringify(
      rehearse(args[0]!, args[1]!, args[2]!, args[3]!, args[4]!, Number(args[5])),
    ),
  );
}
