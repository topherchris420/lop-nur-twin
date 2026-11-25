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

/** Roughly where a held weapon sits in eye space, between grip and muzzle. */
const WEAPON_CENTER = new THREE.Vector3(0.05, -0.12, -0.5);
const RIM_SKY = new THREE.Color(0x9dc4ff);

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
  private readonly shoulder: THREE.DirectionalLight;
  private readonly options: ViewmodelStageOptions;
  private adsBlend = 0;

  // A long lens, well under the world's 80, which is what shipping shooters
  // do. Perspective is what makes a viewmodel read as a toy: under a wide
  // lens the receiver's rear, a hand's width from the eye, balloons against
  // a muzzle seventy centimetres out. A narrow lens with the weapon held
  // further away keeps a rifle's real proportions — the optic, receiver and
  // handguard read at one scale — and the hands still fill the lower right.
  constructor(options: ViewmodelStageOptions = { fov: 64, adsFov: 50 }) {
    this.options = options;
    // A very short depth range: the weapon lives between 5 cm and 4 m, so the
    // pass gets the whole precision budget to itself.
    this.camera = new THREE.PerspectiveCamera(options.fov, 1, 0.01, 8);
    this.scene.add(this.root);

    this.key = new THREE.DirectionalLight(0xfff1da, 1.45);
    this.key.position.set(0.6, 1.1, 0.35);
    // The key aims at where the weapon is held, not at the eye, so its shadow
    // frustum can be a tight box around the rifle and the hands: about a
    // millimetre a texel at 1024. Self-shadowing is what grounds a viewmodel
    // — the optic's shadow on the rail, the glove's on the handguard, the
    // receiver's on the magazine — and the lack of it is a large part of why
    // the weapon read as a cutout. Off below the high tiers (`setShadows`).
    this.key.target.position.copy(WEAPON_CENTER);
    const shadowCamera = this.key.shadow.camera;
    shadowCamera.left = -0.5;
    shadowCamera.right = 0.5;
    shadowCamera.top = 0.5;
    shadowCamera.bottom = -0.5;
    shadowCamera.near = 0.5;
    shadowCamera.far = 4;
    shadowCamera.updateProjectionMatrix();
    this.key.shadow.mapSize.set(1024, 1024);
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.0012;
    this.key.shadow.radius = 2;
    this.key.castShadow = false;
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

    // A soft fill from over the shoulder, fixed to the camera. The key
    // follows the sun, so facing away from it leaves the back of the gloves
    // and the rifle's flank in shadow; this keeps them legible without
    // flattening the key's modelling.
    this.shoulder = new THREE.DirectionalLight(0xf3e6d2, 0.35);
    this.shoulder.position.set(-0.35, 0.7, 0.6);
    this.scene.add(this.shoulder);
    this.scene.add(this.shoulder.target);
  }

  /** Point the key light along the world sun and match its colour. */
  setSun(
    direction: THREE.Vector3,
    color: THREE.Color,
    intensity: number,
    dayFactor = 1,
  ): void {
    this.key.position.copy(direction).multiplyScalar(2).add(WEAPON_CENTER);
    this.key.color.copy(color);
    // The weapon pass has its own lights, so it has to fall off with the
    // world's or the rifle stays daylit against a moonlit apron -- under the
    // night grade's higher exposure it rendered brighter than at noon. Matching
    // the world's ratios exactly (moon ~0.09 of the sun, sky fill a few
    // percent) was judged too dark to read in a blind comparison: a shooter
    // keeps its weapon legible. So the falloff stops well short of physical.
    //
    // A blind review still found the night rifle "lit almost as in daytime",
    // so the falloff now goes most of the way: the key drops to a fifth and
    // the fills to a third, leaving bevels and the rim to carry the shape.
    const night = 1 - THREE.MathUtils.clamp(dayFactor, 0, 1);
    const keyScale = 1 - night * 0.8;
    const fillScale = 1 - night * 0.68;
    // The combat grade sits near exposure 0.64. A key under 1 leaves a
    // gunmetal receiver on the wrong side of AgX's toe, which is how the
    // rifle became a black cutout against the sand. `direction` is already
    // in view space (camera looks down -Z).
    //
    // A sun ahead of the lens lights the far side of the weapon, not the side
    // the eye sees. The key used to climb 2.6x there, which made the backlit
    // rifle the brightest of any frame; now the key holds and the rim turns
    // toward the sun instead, so a backlit rifle goes dark with lit edges.
    const sunAhead = Math.max(0, -direction.z);
    this.key.intensity = (1.25 + intensity * 1.5) * keyScale;
    // The fills sit at about a fifth of the key in full sun. More than that
    // and the shadow side of the receiver reads as flat ambient grey — the
    // 2:1 ratio that made every surface sit at mid-grey — and the key's
    // raking modelling disappears.
    this.fill.intensity = (0.14 + intensity * 0.16) * fillScale * (1 - sunAhead * 0.35);
    this.rim.position
      .set(-0.8, 0.35, -1)
      .normalize()
      .lerp(direction, sunAhead * 0.8)
      .normalize();
    this.rim.color.copy(RIM_SKY).lerp(color, sunAhead);
    this.rim.intensity =
      (0.22 + intensity * 0.16 + sunAhead * intensity * 1.6) * fillScale;
    this.bounce.intensity = (0.04 + intensity * 0.12) * fillScale;
    this.shoulder.intensity =
      (0.07 + intensity * 0.15) * fillScale * (1 - sunAhead * 0.5);
  }

  /**
   * Self-shadowing for the weapon and hands. One small map over a few dozen
   * draws; the renderer's own shadow switch still governs whether it runs.
   */
  setShadows(enabled: boolean): void {
    if (this.key.castShadow === enabled) return;
    this.key.castShadow = enabled;
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
    this.shoulder.dispose();
    this.scene.clear();
  }
}
