import * as THREE from "three";
import { BlendFunction, Effect, EffectAttribute } from "postprocessing";
import { SKY_MODEL_GLSL, skyUniforms } from "./skyModel";

/**
 * Aerial perspective for the top tier: the air between the camera and what it
 * sees, in scene-linear light before the grade.
 *
 * Scene fog is one colour and depends on distance alone, so a ridge ten
 * kilometres out faded toward a beige the sky behind it never had, and the
 * near apron got the same veil per metre as the far horizon. This pass reads
 * the depth buffer instead and integrates an exponential height fog along
 * each pixel's ray — dense on the lakebed, thinning with altitude, so a
 * mountain's base hazes more than its crest — and fades toward
 * `skyHorizonHaze` in that pixel's direction: warm and bright toward the sun,
 * cooler and bluer away from it, exactly the colour the dome draws at the
 * horizon behind it. The first `start` metres are clear, so the foreground
 * keeps its full contrast.
 *
 * It also casts the sun's shafts. Sixteen taps of the depth buffer march from
 * each pixel toward the sun's position on screen; the fraction that lands on
 * open sky is how much of the sun's in-scattered light reaches that ray. Where
 * a roof or a tank covers the disc the air behind it goes dark, which is what
 * a shaft is — light added where the sun reaches, not a veil over the frame.
 *
 * Sky pixels (nothing written to depth) are left alone: the dome already
 * carries its own haze. The viewmodel is composited after this pass, so the
 * weapon in your hands is never fogged.
 */

const FRAGMENT = /* glsl */ `
${SKY_MODEL_GLSL}
uniform mat4 apCameraWorld;
uniform mat4 apInverseProjection;
uniform vec3 apCameraPosition;
uniform float apDensity;
uniform float apFalloff;
uniform float apGroundY;
uniform float apStart;
uniform vec3 apSunScreen;
uniform float apShafts;
uniform float apLogFar;

float apRawDepth(const in vec2 uv) {
  return texture2D(depthBuffer, uv).r;
}

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  float raw = apRawDepth(uv);
  vec4 ray = apInverseProjection * vec4(uv * 2.0 - 1.0, 1.0, 1.0);
  vec3 rayView = ray.xyz / ray.w;
  vec3 dir = normalize(mat3(apCameraWorld) * rayView);
  bool sky = raw >= 0.999999;

  vec3 color = inputColor.rgb;
  if (!sky) {
    // The logarithmic depth buffer stores log2(1 + w) / log2(1 + far), where
    // w is the view-space depth; along the ray that is w / cos(angle).
    float w = exp2(raw * apLogFar) - 1.0;
    float dist = w * length(rayView) / max(-rayView.z, 1e-4);
    float d = max(dist - apStart, 0.0);
    float h = apCameraPosition.y - apGroundY + dir.y * apStart;
    float k = apFalloff;
    float dy = dir.y * d * k;
    float column = abs(dy) > 1e-4 ? (1.0 - exp(-dy)) / dy : 1.0 - 0.5 * dy;
    float tau = apDensity * exp(-k * max(h, -50.0)) * d * column;
    float transmittance = exp(-tau);
    vec3 haze = skyHorizonHaze(dir);
    color = color * transmittance + haze * (1.0 - transmittance);
  }

  // Sun shafts: march toward the sun on screen and count open sky.
  if (apShafts > 0.0 && apSunScreen.z > 0.0) {
    vec2 toSun = apSunScreen.xy - uv;
    float lit = 0.0;
    float weight = 0.0;
    float decay = 1.0;
    float jitter = fract(sin(dot(uv * 913.7, vec2(12.9898, 78.233))) * 43758.5453);
    for (int i = 0; i < 16; i++) {
      float t = (float(i) + jitter) / 16.0;
      vec2 p = uv + toSun * t;
      float open = 0.0;
      if (p.x > 0.0 && p.x < 1.0 && p.y > 0.0 && p.y < 1.0) {
        open = step(0.999999, apRawDepth(p));
      } else {
        open = 1.0;
      }
      lit += open * decay;
      weight += decay;
      decay *= 0.94;
    }
    lit /= weight;
    float cosSun = dot(dir, skySunDir);
    float lobe = skyHg(cosSun, 0.72) * 0.5 + 0.06;
    float aspect = resolution.x / resolution.y;
    float screenDist = length(toSun * vec2(aspect, 1.0));
    float reach = exp(-screenDist * 2.2);
    // Only the occluded remainder darkens; open air keeps the sky's glow,
    // so shafts are contrast between lit and shadowed air, not a lift.
    vec3 sunAir = skySunColor * lobe * apShafts * apSunScreen.z * skyDay;
    color += sunAir * (lit - 0.55) * reach * (sky ? 0.35 : 1.0);
  }
  outputColor = vec4(max(color, 0.0), inputColor.a);
}
`;

export interface AerialPerspectiveSettings {
  /** Extinction per metre at the lakebed. */
  density: number;
  /** Inverse scale height, per metre. */
  falloff: number;
  /** Metres of clear air in front of the camera. */
  start: number;
  /** Strength of the screen-space sun shafts. */
  shafts: number;
}

const _sunWorld = new THREE.Vector3();

export class AerialPerspectiveEffect extends Effect {
  private camera: THREE.Camera | null = null;

  constructor() {
    const uniforms = new Map<string, THREE.Uniform>();
    for (const [name, uniform] of Object.entries(skyUniforms)) {
      // The same objects the dome reads, so the haze cannot disagree with it.
      uniforms.set(name, uniform as THREE.Uniform);
    }
    uniforms.set("apCameraWorld", new THREE.Uniform(new THREE.Matrix4()));
    uniforms.set("apInverseProjection", new THREE.Uniform(new THREE.Matrix4()));
    uniforms.set("apCameraPosition", new THREE.Uniform(new THREE.Vector3()));
    uniforms.set("apDensity", new THREE.Uniform(0.00012));
    uniforms.set("apFalloff", new THREE.Uniform(1 / 900));
    uniforms.set("apGroundY", new THREE.Uniform(0));
    uniforms.set("apStart", new THREE.Uniform(160));
    uniforms.set("apSunScreen", new THREE.Uniform(new THREE.Vector3(0.5, 0.5, 0)));
    uniforms.set("apShafts", new THREE.Uniform(0.6));
    uniforms.set("apLogFar", new THREE.Uniform(Math.log2(26001)));
    super("AerialPerspectiveEffect", FRAGMENT, {
      blendFunction: BlendFunction.SRC,
      attributes: EffectAttribute.DEPTH,
      defines: new Map([["SKY_CLOUD_TAPS", "0"]]),
      uniforms,
    });
  }

  override set mainCamera(value: THREE.Camera) {
    this.camera = value;
  }

  configure(settings: AerialPerspectiveSettings): void {
    this.setValue("apDensity", settings.density);
    this.setValue("apFalloff", settings.falloff);
    this.setValue("apStart", settings.start);
    this.setValue("apShafts", settings.shafts);
  }

  private setValue(name: string, value: number): void {
    const uniform = this.uniforms.get(name);
    if (uniform) uniform.value = value;
  }

  override update(): void {
    const camera = this.camera;
    if (!camera) return;
    camera.updateMatrixWorld();
    (this.uniforms.get("apCameraWorld")?.value as THREE.Matrix4).copy(camera.matrixWorld);
    if (camera instanceof THREE.PerspectiveCamera) {
      (this.uniforms.get("apInverseProjection")?.value as THREE.Matrix4).copy(
        camera.projectionMatrixInverse,
      );
      this.setValue("apLogFar", Math.log2(camera.far + 1));
    }
    (this.uniforms.get("apCameraPosition")?.value as THREE.Vector3).copy(camera.position);

    // Where the sun sits on screen, and how far it is inside the frame.
    const sun = skyUniforms.skySunDir.value;
    _sunWorld.copy(camera.position).addScaledVector(sun, 1000).project(camera);
    const ahead = _sunWorld.z < 1 && sun.y > -0.02;
    const edge = Math.max(Math.abs(_sunWorld.x), Math.abs(_sunWorld.y));
    const visible = ahead ? THREE.MathUtils.clamp((1.6 - edge) / 0.6, 0, 1) : 0;
    (this.uniforms.get("apSunScreen")?.value as THREE.Vector3).set(
      _sunWorld.x * 0.5 + 0.5,
      _sunWorld.y * 0.5 + 0.5,
      visible,
    );
  }
}
