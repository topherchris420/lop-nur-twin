import * as THREE from "three";

/**
 * A near-field shadow cascade for the first-person camera.
 *
 * The site sun in `Atmosphere` covers a 2 km square with one map, because from
 * the twin's aerial camera that is the frame. At 2048 px that is a 0.98 m
 * texel: a crate casts one texel, a soldier casts none, and nothing on the
 * ground is grounded. Standing in it, the single most missing cue is the
 * contact shadow.
 *
 * This adds a second shadow map over the same sun — a *cascade*, not a second
 * light. It follows the camera with a ~64 m frustum, which is a ~3 cm texel, so
 * a boot sole resolves to a handful of texels.
 *
 * ## Why a cascade and not simply a second light
 *
 * Two directional lights pointing the same way light everything twice. Splitting
 * the sun's intensity between them does not fix it, because three's `getShadow`
 * returns *lit* for anything outside a shadow camera's frustum: with the sun
 * split f / (1 - f), a contact shadow inside the tight frustum is only f deep
 * and every shadow outside it is washed out by f. The two requirements pull in
 * opposite directions, so there is no value of f that works.
 *
 * The fix is the one every engine uses: one light, several maps, selected in the
 * shader. three ships `CSM` in its addons and it is the same idea, but it
 * requires every material in the scene to be registered with
 * `csm.setupMaterial()` — and a material that is missed is lit N times over,
 * which is a far worse trap than the one being fixed. Materials here are built
 * at runtime by the character, weapon, clutter and FX layers, so "register them
 * all" is a promise this codebase cannot keep.
 *
 * So the cascade is selected from data the standard shader already has.
 * `installCascadeShadows()` patches the stock `lights_fragment_begin` chunk
 * once, globally, so *every* material — including ones built later — picks it
 * up. The rule it adds:
 *
 *   Two shadow-casting directional lights that point the same way are one light
 *   with two maps. Their shadow terms are combined with `min()`.
 *
 * `min()` rather than a product: a fragment is shadowed if *either* map says so,
 * and a fragment in both penumbrae is not darkened twice. It also means the
 * cascade can only ever add shadow the coarse map missed, never remove any, so
 * the change is monotone and cannot brighten the frame.
 *
 * The cascade light carries `intensity = 0`, so its `RE_Direct` contributes
 * nothing and the sun's radiometry is untouched. three renders a shadow map for
 * it regardless — neither `WebGLRenderer.projectObject` nor `WebGLShadowMap`
 * looks at intensity.
 *
 * The twin route mounts one shadow-casting directional light, so
 * `NUM_DIR_LIGHT_SHADOWS` is 1 there, the whole cascade branch compiles out and
 * the aerial look is bit-for-bit what it was.
 */

/* ------------------------------------------------------------------ */
/* Shader patch                                                        */
/* ------------------------------------------------------------------ */

/**
 * The stock r185 declarations at the top of the directional block. The cascade
 * pre-pass is inserted after them, where `directionalLightShadow` is in scope.
 */
const STOCK_DECLARATIONS = `	DirectionalLight directionalLight;
	#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLightShadow;
	#endif
`;

/** The stock r185 in-loop shadow lookup, replaced by the cascade-aware one. */
const STOCK_SHADOW_LOOKUP = `		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )
		directionalLightShadow = directionalLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
		#endif
`;

/**
 * Runs once before the loop. Both maps are sampled here rather than in the
 * loop so neither is sampled twice, and the merged term is written to both
 * slots so the loop does not care which light is the tight one.
 */
const CASCADE_PREPASS = `	// --- near-field shadow cascade (src/game/render/shadowCascade.ts) ---
	#if defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS > 1 )
	// Shadow-casting lights are sorted first, so 0 and 1 are the two maps.
	bool cascadePaired = dot( directionalLights[ 0 ].direction, directionalLights[ 1 ].direction ) > 0.9999;
	float cascadeShadow[ 2 ];
	cascadeShadow[ 0 ] = 1.0;
	cascadeShadow[ 1 ] = 1.0;
	if ( cascadePaired && receiveShadow ) {
		directionalLightShadow = directionalLightShadows[ 0 ];
		cascadeShadow[ 0 ] = getShadow( directionalShadowMap[ 0 ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ 0 ] );
		directionalLightShadow = directionalLightShadows[ 1 ];
		cascadeShadow[ 1 ] = getShadow( directionalShadowMap[ 1 ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ 1 ] );
		float mergedCascade = min( cascadeShadow[ 0 ], cascadeShadow[ 1 ] );
		cascadeShadow[ 0 ] = mergedCascade;
		cascadeShadow[ 1 ] = mergedCascade;
	}
	#endif
`;

const CASCADE_SHADOW_LOOKUP = `		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )
		#if ( NUM_DIR_LIGHT_SHADOWS > 1 ) && ( UNROLLED_LOOP_INDEX < 2 )
		if ( cascadePaired ) {
			directLight.color *= cascadeShadow[ UNROLLED_LOOP_INDEX ];
		} else
		#endif
		{
			directionalLightShadow = directionalLightShadows[ i ];
			directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
		}
		#endif
`;

let installed: boolean | null = null;

/**
 * Patches `ShaderChunk.lights_fragment_begin` so shadow-casting directional
 * lights that share a direction are treated as cascades of one light.
 *
 * Idempotent, and *checked*: if three's chunk is not the text this was written
 * against — a minor upgrade is allowed by the version range — the patch is
 * skipped and `false` is returned, so the caller can leave the cascade light
 * unmounted rather than ship a second sun. Failing back to today's single map
 * is a look regression; failing forward is a scene lit twice.
 */
export function installCascadeShadows(): boolean {
  if (installed !== null) return installed;

  const chunk = THREE.ShaderChunk.lights_fragment_begin;
  const canPatch =
    chunk.split(STOCK_DECLARATIONS).length === 2 &&
    chunk.split(STOCK_SHADOW_LOOKUP).length === 2;

  if (!canPatch) {
    if (import.meta.env.DEV) {
      console.warn(
        "[shadowCascade] three's lights_fragment_begin chunk has changed; " +
          "the near-field cascade is disabled. Re-check the markers in " +
          "src/game/render/shadowCascade.ts against this three version.",
      );
    }
    installed = false;
    return installed;
  }

  THREE.ShaderChunk.lights_fragment_begin = chunk
    .replace(STOCK_DECLARATIONS, STOCK_DECLARATIONS + CASCADE_PREPASS)
    .replace(STOCK_SHADOW_LOOKUP, CASCADE_SHADOW_LOOKUP);

  installed = true;
  return installed;
}

/* ------------------------------------------------------------------ */
/* The light                                                           */
/* ------------------------------------------------------------------ */

/** How far up-sun the cascade's camera sits. Must clear the tallest caster. */
const LIGHT_DISTANCE = 220;
/** Depth range of the cascade camera, centred on `LIGHT_DISTANCE`. */
const DEPTH_MARGIN = 180;
/**
 * Target texel density, in texels per metre. 32 gives a ~3 cm texel, which is
 * about a fifth of a boot: enough for a contact shadow to read as a shape
 * rather than a smudge.
 */
const TEXELS_PER_METRE = 32;
/** How far ahead of the camera the frustum is centred, as a fraction of `R`. */
const LEAD_FRACTION = 0.42;

const _forward = new THREE.Vector3();
const _focus = new THREE.Vector3();
const _lightPos = new THREE.Vector3();
const _lightSpace = new THREE.Matrix4();
const _lightSpaceInverse = new THREE.Matrix4();
const _snap = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _origin = new THREE.Vector3();

export interface CascadeOptions {
  /** Shadow map resolution; the frustum is sized from it. */
  mapSize: number;
}

export class NearShadowCascade {
  readonly light: THREE.DirectionalLight;
  /** Half-width of the frustum, in metres. */
  readonly radius: number;
  private readonly texel: number;

  constructor(options: CascadeOptions) {
    const size = options.mapSize;
    this.radius = size / (2 * TEXELS_PER_METRE);
    this.texel = (2 * this.radius) / size;

    // Intensity 0: this light exists only for its depth map. See the note at
    // the top of the file — the shader folds its shadow into the real sun.
    const light = new THREE.DirectionalLight(0xffffff, 0);
    light.name = "sun-near-cascade";
    light.castShadow = true;

    const shadow = light.shadow;
    shadow.mapSize.set(size, size);
    const camera = shadow.camera;
    camera.left = -this.radius;
    camera.right = this.radius;
    camera.top = this.radius;
    camera.bottom = -this.radius;
    camera.near = LIGHT_DISTANCE - DEPTH_MARGIN;
    camera.far = LIGHT_DISTANCE + DEPTH_MARGIN;
    camera.updateProjectionMatrix();

    // The site sun runs `normalBias` 0.6 m because its texels are a metre
    // across. At 3 cm texels that would detach every shadow from its object;
    // the bias here is scaled to the texel instead. `bias` is in normalised
    // depth over the camera's 360 m range, so ~1 cm of depth.
    shadow.normalBias = this.texel * 1.2;
    shadow.bias = -0.00003;
    shadow.radius = 2;

    this.light = light;
  }

  /**
   * Re-centre the frustum ahead of the camera.
   *
   * The centre is snapped to whole shadow texels in light space, without which
   * the map slides under the geometry as the player walks and every shadow edge
   * crawls.
   */
  update(camera: THREE.Camera, sunDirection: THREE.Vector3): void {
    camera.getWorldDirection(_forward);
    _forward.y = 0;
    if (_forward.lengthSq() < 1e-6) _forward.set(0, 0, -1);
    _forward.normalize();

    _focus
      .copy(camera.position)
      .addScaledVector(_forward, this.radius * LEAD_FRACTION);
    // Sit the frustum on the ground rather than at eye height, so its depth
    // range is spent on the world and not on the air above the player.
    _focus.y -= 1.0;

    // Snap in the light's own frame: rounding world XZ would still crawl,
    // because the map's axes are perpendicular to the sun, not to the world.
    _lightSpace.identity().lookAt(sunDirection, _origin, _up);
    _lightSpaceInverse.copy(_lightSpace).invert();
    _snap.copy(_focus).applyMatrix4(_lightSpaceInverse);
    _snap.x = Math.round(_snap.x / this.texel) * this.texel;
    _snap.y = Math.round(_snap.y / this.texel) * this.texel;
    _focus.copy(_snap).applyMatrix4(_lightSpace);

    _lightPos.copy(_focus).addScaledVector(sunDirection, LIGHT_DISTANCE);
    this.light.position.copy(_lightPos);
    this.light.target.position.copy(_focus);
  }

  dispose(): void {
    this.light.shadow.map?.dispose();
    this.light.dispose();
  }
}
