import type * as THREE from "three";
import type { RootState } from "@react-three/fiber";

/**
 * Longest a load or a quality step waits for the driver before rendering anyway.
 * Past this the first frame simply blocks on the link, which is what every frame
 * did before this existed, so a driver that never reports completion costs a wait
 * and nothing worse.
 */
const WARMUP_TIMEOUT_MS = 20_000;

/** Work between yields: long enough to make progress, well short of a long task. */
const SLICE_MS = 12;

let latestRun = 0;

const nextTask = () => new Promise((resolve) => setTimeout(resolve, 0));

function setActive(state: RootState, active: boolean): void {
  state.set((current) => ({ internal: { ...current.internal, active } }));
}

/** Stops R3F rendering without touching its clock: see `warmProgramsThenRender`. */
export function pauseRendering(state: RootState): void {
  setActive(state, false);
}

function collectTextures(materials: Set<THREE.Material>): Set<THREE.Texture> {
  const textures = new Set<THREE.Texture>();
  const take = (value: unknown) => {
    if ((value as THREE.Texture | null)?.isTexture) textures.add(value as THREE.Texture);
  };
  for (const material of materials) {
    Object.values(material).forEach(take);
    // Procedural surfaces keep their maps in uniforms, not on the material.
    for (const key of ["groundDetail", "hardSurface"]) {
      const uniforms = material.userData[key] as
        Record<string, THREE.IUniform> | undefined;
      if (uniforms) Object.values(uniforms).forEach((uniform) => take(uniform.value));
    }
  }
  return textures;
}

type TrackedProgram = {
  isReady(): boolean;
  getUniforms(): unknown;
  getAttributes(): unknown;
};

function programOf(gl: THREE.WebGLRenderer, material: THREE.Material) {
  return (gl.properties.get(material) as { currentProgram?: TrackedProgram })
    .currentProgram;
}

/**
 * Resolves when every program has linked. This is `compileAsync` with two changes:
 * a material disposed while its program links is skipped, where `compileAsync` throws
 * inside its timer and never resolves, and it asks about one program per poll, not
 * every program, because each question is a round trip to the GPU process.
 */
async function programsLinked(
  gl: THREE.WebGLRenderer,
  materials: Set<THREE.Material>,
): Promise<void> {
  const deadline = performance.now() + WARMUP_TIMEOUT_MS;
  const pending = [...materials];
  while (pending.length > 0 && performance.now() < deadline) {
    const material = pending[pending.length - 1] as THREE.Material;
    if (programOf(gl, material)?.isReady() ?? true) pending.pop();
    else await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** Runs `work` on each item, giving the page a turn whenever a slice is used up. */
async function sliced<T>(items: Iterable<T>, work: (item: T) => void): Promise<void> {
  let sliceStart = performance.now();
  for (const item of items) {
    work(item);
    if (performance.now() - sliceStart > SLICE_MS) {
      await nextTask();
      sliceStart = performance.now();
    }
  }
}

/**
 * Resolves when the GPU has caught up with everything queued so far, without ever
 * blocking on it: the fence is only polled. Any synchronous call made while the
 * queue is full waits for all of it, so the first frame must not start until the
 * queue is empty, or its first status read pays for every upload ahead of it.
 */
async function gpuQueueDrained(gl: WebGL2RenderingContext): Promise<void> {
  const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  if (fence === null) return;
  gl.flush();
  const deadline = performance.now() + WARMUP_TIMEOUT_MS;
  while (
    gl.getSyncParameter(fence, gl.SYNC_STATUS) !== gl.SIGNALED &&
    !gl.isContextLost() &&
    performance.now() < deadline
  ) {
    await new Promise((resolve) => setTimeout(resolve, 4));
  }
  gl.deleteSync(fence);
}

/** Creates the programs the next frame will draw with, and returns their materials. */
type CompileNextFrame = (state: RootState) => Set<THREE.Material>;

const compileScene: CompileNextFrame = ({ gl, scene, camera }) =>
  gl.compile(scene, camera);

/**
 * The same for a frame of the post stack, which `compileScene` gets wrong twice. The
 * passes' own materials are not in the scene, and the scene itself is drawn into the
 * composer's buffer, not the screen. The output colour space is part of a program's
 * key, so what `compileScene` links for that is a set of programs nothing draws with.
 *
 * So this walks one composer frame with `render` swapped for `compile`. Every pass asks
 * for what it really draws, with its real target bound, and nothing is drawn. That
 * needs no knowledge of what each pass keeps inside it, which for N8AO and the bloom
 * mip chain is quite a lot.
 */
export function compileComposerFrame(composer: {
  render(deltaTime?: number): void;
}): CompileNextFrame {
  return ({ gl }) => {
    const materials = new Set<THREE.Material>();
    const render = gl.render;
    gl.render = (scene, camera) => {
      gl.compile(scene, camera).forEach((material) => materials.add(material));
    };
    try {
      composer.render(0);
    } finally {
      gl.render = render;
    }
    return materials;
  };
}

/**
 * Pauses the frame loop while the driver links what the scene is about to draw,
 * and does the rest of the work its first frame would otherwise do at once.
 *
 * Linking is the single largest cost of starting the twin: three.js reads a
 * program's status the first time it draws with it, and that read waits for the
 * link. On ANGLE over D3D11 that held the main thread for seconds, with the page
 * unable to take input. Here the driver's worker threads do the same work through
 * `KHR_parallel_shader_compile` while this polls for it, so the page keeps running.
 * Without the extension every program reports ready at once and the first lookup
 * of each one blocks, which is no worse than it was.
 *
 * Uniform lookups and texture uploads then run in slices. Left to the first frame
 * they pile up behind one another, and every synchronous call in that frame waits
 * for all of them.
 *
 * The pause goes through `internal.active`, the flag R3F itself raises to start
 * rendering, and not through `frameloop`: `setFrameloop` zeroes `clock.elapsedTime`,
 * which the aircraft, vehicles and dust are positioned from, so pausing that way
 * would teleport them on every quality step.
 */
export async function warmProgramsThenRender(
  state: RootState,
  compile: CompileNextFrame = compileScene,
): Promise<void> {
  const run = ++latestRun;
  setActive(state, false);
  // Canvas applies the tier's shadow setting from the page's own React root, which
  // commits separately from the scene's. Give it its turn before reading it.
  await nextTask();
  if (run !== latestRun) return;

  try {
    const { gl } = state.get();
    const materials = compile(state.get());
    await programsLinked(gl, materials);
    if (run !== latestRun) return;

    await sliced(materials, (material) => {
      const program = programOf(gl, material);
      program?.getUniforms();
      program?.getAttributes();
    });
    await sliced(collectTextures(materials), (texture) => gl.initTexture(texture));
    await gpuQueueDrained(gl.getContext() as WebGL2RenderingContext);
  } finally {
    if (run === latestRun) {
      setActive(state, true);
      // The loop stopped itself when nothing was active; this restarts it.
      state.get().invalidate();
    }
  }
}
