import * as THREE from "three";
import { horizontalToVerticalFov } from "../core/types";

/**
 * The viewmodel stage: a private scene, camera and lighting rig for the
 * first-person weapon.
 *
 * A weapon parented to the world camera is wrong for two reasons that cannot
 * be worked around by moving it. At the 90–105° the world wants, a rifle held
 * where a rifle is actually held is violently distorted by the perspective
 * divide, and its buttstock — which in reality sits behind your eye, in your
 * shoulder — crosses the near plane. Shipping shooters solve both by rendering
 * the weapon in a second pass with its own narrower field of view and its own
 * depth range, and that is what this does.
 *
 * The stage keeps its own lights so the weapon is lit consistently no matter
 * where the player stands, with the key light tracking the world's sun so it
 * still reads as being in the same place.
 */

export interface ViewmodelStageOptions {
  /** Horizontal field of view for the weapon, in degrees. */
  fov: number;
  /** Narrower FOV used at full aim, so the weapon grows toward the eye. */
  adsFov: number;
}

export class ViewmodelStage {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly root = new THREE.Group();

  private readonly key: THREE.DirectionalLight;
  private readonly fill: THREE.HemisphereLight;
  private readonly rim: THREE.DirectionalLight;
  private readonly bounce: THREE.DirectionalLight;
  private readonly options: ViewmodelStageOptions;
  private adsBlend = 0;

  // 96 horizontal is a wider lens than the world's 80, which is deliberate and
  // is what shipping shooters do: at the world's own lens a rifle held where a
  // rifle is held eats a third of the screen. These were 70/56 when they were
  // being fed to a *vertical* FOV property — the same 102/86 horizontal at
  // 16:9 — so the weapon is drawn at very close to the size it always was.
  constructor(options: ViewmodelStageOptions = { fov: 96, adsFov: 80 }) {
    this.options = options;
    // A very short depth range: the weapon lives between 5 cm and 4 m, so the
    // pass gets the whole precision budget to itself.
    this.camera = new THREE.PerspectiveCamera(options.fov, 1, 0.01, 8);
    this.scene.add(this.root);

    this.key = new THREE.DirectionalLight(0xfff1da, 1.45);
    this.key.position.set(0.6, 1.1, 0.35);
    this.scene.add(this.key);
    this.scene.add(this.key.target);

    // Sky stays cool; the ground hemisphere is desert sand, or the glove
    // undersides and the dust cover pick up a blue fill that doesn't exist
    // on this site.
    this.fill = new THREE.HemisphereLight(0xd5e4f5, 0xc6a36e, 0.42);
    this.scene.add(this.fill);

    // A cool back-rim keeps the weapon's silhouette legible against a bright
    // desert floor, which is otherwise the hardest case for a black rifle.
    this.rim = new THREE.DirectionalLight(0x9dc4ff, 0.7);
    this.rim.position.set(-0.8, 0.35, -1);
    this.scene.add(this.rim);

    // Upward bounce. With only the key and the hemisphere, the palm side of
    // the glove and the inside of the dust cover fall out of the sun and read
    // as unlit black. No shadow map — the viewmodel pass has no casters worth
    // the cost, and a shadow on the hands flickers with the sway.
    this.bounce = new THREE.DirectionalLight(0xffd2a8, 0.12);
    this.bounce.position.set(0.08, -0.85, -0.55);
    this.scene.add(this.bounce);
    this.scene.add(this.bounce.target);
  }

  /** Point the key light along the world sun and match its colour. */
  setSun(direction: THREE.Vector3, color: THREE.Color, intensity: number): void {
    this.key.position.copy(direction).multiplyScalar(3);
    this.key.color.copy(color);
    // The combat grade sits near exposure 0.64. A key under 1 leaves a
    // gunmetal receiver on the wrong side of AgX's toe, which is how the
    // rifle became a black cutout against the sand.
    this.key.intensity = 1.15 + intensity * 1.35;
    // Full sun stays under half a unit. Higher than that and the sand bounce
    // lifts the whole rifle off the key and the parkerising goes grey.
    this.fill.intensity = 0.22 + intensity * 0.26;
    this.rim.intensity = 0.28 + intensity * 0.22;
    this.bounce.intensity = 0.04 + intensity * 0.14;
  }

  setEnvironment(texture: THREE.Texture | null): void {
    this.scene.environment = texture;
    // Enough desert sky to pull an edge out of parkerising and a glove seam,
    // still far under the world's 0.68 — near that the furniture wraps the
    // apron and the rifle reads as polished aluminium.
    // Material.envMapIntensity is already ~0.2 on the dark finishes. This
    // scene multiplier stacks with that, so a "subtle" 0.2 here is really
    // ~0.04 and the metal stops reflecting entirely. 1 keeps the per-material
    // values meaningful; the world's 0.68 is a different scene.
    this.scene.environmentIntensity = 1;
  }

  /**
   * Blend the camera's field of view toward the aimed value.
   *
   * Horizontal degrees, like the world camera's — the weapon pass is a
   * *narrower lens on the same shot*, and if the two use different conventions
   * that relationship inverts the moment the aspect ratio is not 1:1.
   */
  setAds(blend: number): void {
    this.adsBlend = blend;
    this.applyFov();
  }

  setAspect(aspect: number): void {
    if (Math.abs(this.camera.aspect - aspect) < 1e-4) return;
    this.camera.aspect = aspect;
    this.applyFov();
  }

  private applyFov(): void {
    const horizontal =
      this.options.fov + (this.options.adsFov - this.options.fov) * this.adsBlend;
    const target = horizontalToVerticalFov(horizontal, this.camera.aspect);
    if (Math.abs(this.camera.fov - target) > 1e-3) this.camera.fov = target;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Draw the weapon over whatever is already in the frame buffer.
   *
   * The depth buffer is cleared first so the weapon is never occluded by world
   * geometry, and the renderer's tone mapping is forced to match the world's
   * so the two passes agree on exposure — without that the weapon reads as a
   * sticker pasted onto the scene.
   */
  render(
    renderer: THREE.WebGLRenderer,
    toneMapping: THREE.ToneMapping,
    exposure: number,
  ): void {
    const previousAutoClear = renderer.autoClear;
    const previousToneMapping = renderer.toneMapping;
    const previousExposure = renderer.toneMappingExposure;
    const previousTarget = renderer.getRenderTarget();

    renderer.setRenderTarget(null);
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.toneMapping = toneMapping;
    renderer.toneMappingExposure = exposure;
    renderer.render(this.scene, this.camera);

    renderer.autoClear = previousAutoClear;
    renderer.toneMapping = previousToneMapping;
    renderer.toneMappingExposure = previousExposure;
    renderer.setRenderTarget(previousTarget);
  }

  dispose(): void {
    this.key.dispose();
    this.fill.dispose();
    this.rim.dispose();
    this.bounce.dispose();
    this.scene.clear();
  }
}
