import * as THREE from "three";
import { CopyMaterial, Pass } from "postprocessing";
import type { ViewmodelStage } from "../player/viewmodelStage";

/**
 * Draws the first-person weapon into the composer's HDR buffer.
 *
 * The viewmodel used to be a second draw after AgX, with its own exposure.
 * That is why a shot into the sun washed the apron out and left the rifle
 * crisp: the two images were graded apart, and bloom never saw the weapon.
 * This pass copies the world colour, clears depth, and renders the weapon in
 * scene-linear light so the bloom and the AgX pass that follow are the only
 * grade either of them gets.
 */

let bound: ViewmodelStage | null = null;
let passMounted = false;

export function bindViewmodelStage(stage: ViewmodelStage | null): void {
  bound = stage;
}

export function setViewmodelPassMounted(value: boolean): void {
  passMounted = value;
}

/** True once CombatEffects has the composite in the chain. */
export function viewmodelPassActive(): boolean {
  return passMounted && bound !== null;
}

export class ViewmodelCompositePass extends Pass {
  constructor() {
    super("ViewmodelCompositePass");
    const copy = new CopyMaterial();
    // The copy shader's colour-space chunk would bake a display transform
    // into the HDR buffer, and AgX would grade it a second time.
    delete copy.defines.COLOR_SPACE_CONVERSION;
    copy.needsUpdate = true;
    this.fullscreenMaterial = copy;
    this.needsSwap = true;
  }

  override render(
    renderer: THREE.WebGLRenderer,
    inputBuffer: THREE.WebGLRenderTarget,
    outputBuffer: THREE.WebGLRenderTarget,
  ): void {
    const copy = this.fullscreenMaterial as CopyMaterial;
    copy.inputBuffer = inputBuffer.texture;

    const previousTarget = renderer.getRenderTarget();
    const previousAutoClear = renderer.autoClear;
    const previousToneMapping = renderer.toneMapping;
    const previousExposure = renderer.toneMappingExposure;

    renderer.setRenderTarget(outputBuffer);
    renderer.autoClear = false;
    renderer.render(this.scene, this.camera);

    const stage = bound;
    if (stage && stage.root.visible) {
      renderer.clearDepth();
      renderer.toneMapping = THREE.NoToneMapping;
      renderer.toneMappingExposure = 1;
      renderer.render(stage.scene, stage.camera);
    }

    renderer.autoClear = previousAutoClear;
    renderer.toneMapping = previousToneMapping;
    renderer.toneMappingExposure = previousExposure;
    renderer.setRenderTarget(previousTarget);
  }
}
