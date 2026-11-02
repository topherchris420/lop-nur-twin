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

function collectMaterials(scene: THREE.Object3D): Set<THREE.Material> {
  const materials = new Set<THREE.Material>();
  scene.traverse((object) => {
    const material = (object as THREE.Mesh).material;
    if (Array.isArray(material)) material.forEach((entry) => materials.add(entry));
    else if (material) materials.add(material);
  });
  return materials;
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

/**
 * Pauses the frame loop while the driver links what the scene is about to draw,
 * and does the rest of the work its first frame would otherwise do at once.
 *
 * Linking is the single largest cost of starting the twin: three.js reads a
 * program's status the first time it draws with it, and that read waits for the
 * link. On ANGLE over D3D11 that held the main thread for seconds, with the page
 * unable to take input. `compileAsync` hands the same work to the driver's worker
 * threads through `KHR_parallel_shader_compile` and polls for it, so the page keeps
 * running. Without the extension it resolves at once and the first frame blocks,
 * exactly as it would have.
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
export async function warmProgramsThenRender(state: RootState): Promise<void> {
  const run = ++latestRun;
  setActive(state, false);
  // A quality step arrives mid-frame, ahead of the React commits that swap the
  // materials and the shadow setup. Compiling now would compile the outgoing tier.
  await nextTask();
  if (run !== latestRun) return;

  try {
    const { gl, scene, camera } = state.get();
    await Promise.race([
      gl.compileAsync(scene, camera),
      new Promise((resolve) => setTimeout(resolve, WARMUP_TIMEOUT_MS)),
    ]);
    if (run !== latestRun) return;

    const materials = collectMaterials(scene);
    await sliced(materials, (material) => {
      const program = (
        gl.properties.get(material) as {
          currentProgram?: { getUniforms(): unknown; getAttributes(): unknown };
        }
      ).currentProgram;
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
