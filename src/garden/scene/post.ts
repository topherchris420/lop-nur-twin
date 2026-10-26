/**
 * From the rendered light to the picture, like a camera's sensor and a
 * colourist: the scene is drawn into a linear HDR buffer (multisampled where
 * the device can), then
 *
 * 1. **Ambient occlusion** (half resolution, from depth alone): soft contact
 *    darkening where clay meets clay, its radius scaled to what the lens is
 *    looking at, so the fly's feet darken a leaf in macro and the pot darkens
 *    the lawn in the wide shot. Blurred with respect for depth edges.
 * 2. **Depth of field** (half resolution, gathered on a disc): each pixel's
 *    blur is the thin-lens circle of confusion for the lens's focus and
 *    aperture, with the in-focus subject never smeared by the background.
 * 3. **Finishing**: exposure from the light, a colour grade (cooler and less
 *    saturated by night), AgX film-like tone mapping, a light vignette and
 *    film grain that changes with each stop-motion frame. No bloom.
 *
 * Optional motion blur averages several exposures across the shutter's
 * opening before the rest of the chain.
 *
 * A light meter reads the HDR picture a few times a second: the mean log
 * luminance of an 8 × 8 grid, read back without stalling the GPU, and
 * centre-weighted on the CPU (`metered`), for the close-up lenses' exposure.
 *
 * Macro lenses put the near clipping plane a millimetre from the glass, which
 * leaves a depth buffer no precision for the garden metres behind; there the
 * scene is drawn in two depth ranges, far then near, so nothing distant
 * flickers.
 */
import * as THREE from "three";
import { centreWeighted, METER, METER_LOW, METER_STOPS } from "../core/meter.js";

const SPLIT_BELOW_NEAR = 0.02;
const SPLIT_AT = 0.22;
/** Layer for things only the far range draws (the sky, which ignores clipping). */
export const FAR_LAYER = 2;

const FULLSCREEN_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4( position.xy, 0.0, 1.0 );
}`;

const DEPTH_HELPERS = /* glsl */ `
uniform sampler2D tDepth;
uniform float uNear, uFar;
uniform vec2 uProj;
float viewZAt( vec2 uv ) {
  // Explicit level: these lookups run inside loops, where derivatives are undefined.
  float d = textureLod( tDepth, uv, 0.0 ).x;
  // Nothing drawn here (the sky, or the far range of a split render): treat as far away.
  return d >= 0.99999 ? -1e4 : ( uNear * uFar ) / ( ( uFar - uNear ) * d - uFar );
}
vec3 viewPosAt( vec2 uv ) {
  float z = viewZAt( uv );
  vec2 ndc = uv * 2.0 - 1.0;
  return vec3( ndc.x * -z / uProj.x, ndc.y * -z / uProj.y, z );
}
// Interleaved gradient noise (Jimenez): cheap, well-spread per-pixel rotation.
float ign( vec2 p ) { return fract( 52.9829189 * fract( dot( p, vec2( 0.06711056, 0.00583715 ) ) ) ); }
`;

const AO_FRAGMENT = /* glsl */ `
${DEPTH_HELPERS}
uniform vec2 uTexel;
uniform vec2 uResolution;
uniform float uRadius, uIntensity;
varying vec2 vUv;
void main() {
  float d = texture2D( tDepth, vUv ).x;
  if ( d >= 0.99999 ) { gl_FragColor = vec4( 1.0 ); return; }
  vec3 P = viewPosAt( vUv );
  vec3 ax = viewPosAt( vUv + vec2( uTexel.x, 0.0 ) ) - P, bx = P - viewPosAt( vUv - vec2( uTexel.x, 0.0 ) );
  vec3 ay = viewPosAt( vUv + vec2( 0.0, uTexel.y ) ) - P, by = P - viewPosAt( vUv - vec2( 0.0, uTexel.y ) );
  vec3 N = normalize( cross( abs( ax.z ) < abs( bx.z ) ? ax : bx, abs( ay.z ) < abs( by.z ) ? ay : by ) );
  float rPx = uRadius * uProj.y * 0.5 * uResolution.y / max( -P.z, 1e-6 );
  if ( rPx < 1.0 ) { gl_FragColor = vec4( 1.0 ); return; }
  rPx = min( rPx, 0.12 * uResolution.y );
  float rot = ign( gl_FragCoord.xy ) * 6.2831853;
  float occ = 0.0;
  for ( int i = 0; i < AO_SAMPLES; i ++ ) {
    float f = ( float( i ) + 0.5 ) / float( AO_SAMPLES );
    float a = float( i ) * 2.3999632 + rot;
    vec2 o = vec2( cos( a ), sin( a ) ) * sqrt( f ) * rPx;
    vec3 v = viewPosAt( vUv + o / uResolution ) - P;
    float len = length( v );
    occ += max( 0.0, dot( v / max( len, 1e-9 ), N ) - 0.12 ) * ( 1.0 - smoothstep( uRadius * 0.6, uRadius * 1.3, len ) );
  }
  float ao = clamp( 1.0 - uIntensity * occ / float( AO_SAMPLES ), 0.0, 1.0 );
  gl_FragColor = vec4( ao, ao, ao, 1.0 );
}`;

const AO_BLUR_FRAGMENT = /* glsl */ `
${DEPTH_HELPERS}
uniform sampler2D tAO;
uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  float z0 = viewZAt( vUv );
  float sum = 0.0, wsum = 0.0;
  for ( int y = -2; y <= 2; y ++ )
    for ( int x = -2; x <= 2; x ++ ) {
      vec2 uv = vUv + vec2( float( x ), float( y ) ) * uTexel;
      float z = viewZAt( uv );
      float w = exp( -abs( z - z0 ) / ( 0.03 * abs( z0 ) + 1e-6 ) ) * ( 1.0 - 0.12 * float( x * x + y * y ) / 8.0 );
      sum += textureLod( tAO, uv, 0.0 ).r * w;
      wsum += w;
    }
  float ao = sum / max( wsum, 1e-6 );
  gl_FragColor = vec4( ao, ao, ao, 1.0 );
}`;

const COC = /* glsl */ `
uniform float uFocus, uAperture, uMaxCoc;
// Thin-lens circle of confusion, in full-resolution pixels.
float cocAt( float viewZ ) {
  float z = max( -viewZ, 1e-6 );
  return min( uAperture * abs( z - uFocus ) / z, uMaxCoc );
}
`;

const DOF_FRAGMENT = /* glsl */ `
${DEPTH_HELPERS}
${COC}
uniform sampler2D tColor;
uniform vec2 uResolution;
varying vec2 vUv;
void main() {
  float z0 = viewZAt( vUv );
  float c0 = cocAt( z0 );
  vec3 sum = texture2D( tColor, vUv ).rgb;
  float wsum = 1.0;
  float rot = ign( gl_FragCoord.xy ) * 6.2831853;
  for ( int i = 0; i < DOF_SAMPLES; i ++ ) {
    float f = ( float( i ) + 0.5 ) / float( DOF_SAMPLES );
    float a = float( i ) * 2.3999632 + rot;
    float dist = sqrt( f ) * uMaxCoc;
    vec2 uv = vUv + vec2( cos( a ), sin( a ) ) * dist / uResolution;
    float z = viewZAt( uv );
    float c = cocAt( z );
    // The background cannot spread over a sharper subject in front of it.
    float reach = z < z0 - 1e-6 ? min( c, c0 ) : c;
    float w = smoothstep( dist - 1.5, dist + 1.5, reach );
    sum += textureLod( tColor, uv, 0.0 ).rgb * w;
    wsum += w;
  }
  gl_FragColor = vec4( sum / wsum, c0 );
}`;

const ACCUMULATE_FRAGMENT = /* glsl */ `
uniform sampler2D tColor;
uniform float uWeight;
varying vec2 vUv;
void main() { gl_FragColor = vec4( texture2D( tColor, vUv ).rgb * uWeight, 1.0 ); }`;

const FINISH_FRAGMENT = /* glsl */ `
${DEPTH_HELPERS}
${COC}
#include <tonemapping_pars_fragment>
uniform sampler2D tColor, tAO, tDOF;
uniform float uExposure, uNight, uAOStrength, uDOF, uGrain, uGrainSeed, uVignette, uAspect;
varying vec2 vUv;
float grainHash( vec2 p ) { return fract( sin( dot( p, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ); }
void main() {
  vec3 c = texture2D( tColor, vUv ).rgb;
  if ( uDOF > 0.5 ) {
    float coc = cocAt( viewZAt( vUv ) );
    c = mix( c, texture2D( tDOF, vUv ).rgb, smoothstep( 0.8, 2.6, coc ) );
  }
  c *= mix( 1.0, texture2D( tAO, vUv ).r, uAOStrength );
  c *= uExposure;
  // Night: the eye loses colour and shifts toward blue; graded so here.
  float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
  c = mix( c, vec3( l ), 0.3 * uNight );
  c *= mix( vec3( 1.0 ), vec3( 0.8, 0.9, 1.14 ), uNight );
  // A gentle split tone: shadows a touch cool, highlights a touch warm.
  float k = smoothstep( 0.02, 0.6, l * uExposure );
  c *= mix( vec3( 0.985, 0.995, 1.02 ), vec3( 1.02, 1.0, 0.975 ), k );
  c = AgXToneMapping( c );
  // AgX's base look is flat; a little contrast back, as a print would have.
  c = mix( c, c * c * ( 3.0 - 2.0 * c ), 0.22 );
  vec4 o = sRGBTransferOETF( vec4( c, 1.0 ) );
  vec2 q = ( vUv - 0.5 ) * vec2( uAspect, 1.0 );
  o.rgb *= 1.0 - uVignette * smoothstep( 0.45, 1.05, length( q ) );
  float g = grainHash( floor( gl_FragCoord.xy ) + uGrainSeed ) + grainHash( floor( gl_FragCoord.xy ) * 1.3 + uGrainSeed * 0.7 ) - 1.0;
  o.rgb += g * uGrain * ( 1.0 - 0.7 * o.rgb );
  gl_FragColor = vec4( clamp( o.rgb, 0.0, 1.0 ), 1.0 );
}`;

const METER_FRAGMENT = /* glsl */ `
uniform sampler2D tColor;
uniform vec2 uCell;
varying vec2 vUv;
void main() {
  // Mean log luminance of this cell, from a 4 × 4 grid of taps across it.
  float s = 0.0;
  for ( int j = 0; j < 4; j++ )
    for ( int i = 0; i < 4; i++ ) {
      vec2 uv = vUv + ( vec2( float( i ), float( j ) ) - 1.5 ) * 0.25 * uCell;
      vec3 c = textureLod( tColor, uv, 0.0 ).rgb;
      s += log2( max( dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ), 1e-5 ) );
    }
  gl_FragColor = vec4( clamp( ( s / 16.0 - float( ${METER_LOW} ) ) / float( ${METER_STOPS} ), 0.0, 1.0 ), 0.0, 0.0, 1.0 );
}`;

export interface PostFrame {
  exposure: number;
  night: number;
  focus: { distance: number; aperture: number };
  /** Depth of field and ambient occlusion on or off for this frame. */
  dof: boolean;
  ao: boolean;
  /** The stop-motion frame, so grain changes only when the picture does. */
  frameIndex: number;
  /** Exposures to average (motion blur), and how to set the scene for each (0…1 across the shutter). */
  blur: { samples: number; set(k: number): void } | null;
  /** Keep the light meter reading. */
  meter: boolean;
}

/** A fullscreen triangle with one material. */
class Pass {
  readonly scene = new THREE.Scene();
  readonly mesh: THREE.Mesh;
  static readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  static geometry: THREE.BufferGeometry | null = null;
  constructor(readonly material: THREE.ShaderMaterial) {
    if (!Pass.geometry) {
      Pass.geometry = new THREE.BufferGeometry();
      Pass.geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3),
      );
    }
    this.mesh = new THREE.Mesh(Pass.geometry, material);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }
  render(r: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget | null) {
    r.setRenderTarget(target);
    r.render(this.scene, Pass.camera);
  }
}

const pass = (
  fragmentShader: string,
  uniforms: Record<string, THREE.IUniform>,
  defines: Record<string, number> = {},
  blending: THREE.Blending = THREE.NoBlending,
) =>
  new Pass(
    new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERTEX,
      fragmentShader,
      uniforms,
      defines,
      depthTest: false,
      depthWrite: false,
      blending,
      toneMapped: false,
    }),
  );

export class PostChain {
  private hdr: THREE.WebGLRenderTarget;
  private accum: THREE.WebGLRenderTarget;
  private ao: THREE.WebGLRenderTarget;
  private aoBlur: THREE.WebGLRenderTarget;
  private dof: THREE.WebGLRenderTarget;
  private readonly aoPass: Pass;
  private readonly aoBlurPass: Pass;
  private readonly dofPass: Pass;
  private readonly accumPass: Pass;
  private readonly finishPass: Pass;
  private readonly meterPass: Pass;
  private readonly meterTarget: THREE.WebGLRenderTarget;
  private readonly meterPixels = new Uint8Array(METER * METER * 4);
  private metering = false;
  private meteredAt = -Infinity;
  private meterEpoch = 0;
  /** Centre-weighted scene luminance (before exposure) at the last reading; null before the first. */
  metered: number | null = null;
  private readonly white: THREE.DataTexture;
  private width = 1;
  private height = 1;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    samples: number,
    aoSamples: number,
    dofSamples: number,
  ) {
    // Half-float colour needs a renderable float format; without one the
    // light is clipped at white before tone mapping, but still drawn.
    const ext = renderer.extensions;
    const hdrType =
      ext.has("EXT_color_buffer_float") || ext.has("EXT_color_buffer_half_float")
        ? THREE.HalfFloatType
        : THREE.UnsignedByteType;
    this.hdr = new THREE.WebGLRenderTarget(1, 1, {
      type: hdrType,
      samples,
      depthBuffer: true,
    });
    this.hdr.depthTexture = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
    this.accum = new THREE.WebGLRenderTarget(1, 1, { type: hdrType, depthBuffer: false });
    const half = { type: THREE.UnsignedByteType, depthBuffer: false } as const;
    this.ao = new THREE.WebGLRenderTarget(1, 1, half);
    this.aoBlur = new THREE.WebGLRenderTarget(1, 1, half);
    this.dof = new THREE.WebGLRenderTarget(1, 1, { type: hdrType, depthBuffer: false });
    this.meterTarget = new THREE.WebGLRenderTarget(METER, METER, {
      type: THREE.UnsignedByteType,
      depthBuffer: false,
    });
    this.white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    this.white.needsUpdate = true;
    const depth = () => ({
      tDepth: { value: this.hdr.depthTexture },
      uNear: { value: 0.05 },
      uFar: { value: 40 },
      uProj: { value: new THREE.Vector2(1, 1) },
    });
    this.aoPass = pass(
      AO_FRAGMENT,
      {
        ...depth(),
        uTexel: { value: new THREE.Vector2() },
        uResolution: { value: new THREE.Vector2() },
        uRadius: { value: 0.1 },
        uIntensity: { value: 1.6 },
      },
      { AO_SAMPLES: aoSamples },
    );
    this.aoBlurPass = pass(AO_BLUR_FRAGMENT, {
      ...depth(),
      tAO: { value: this.ao.texture },
      uTexel: { value: new THREE.Vector2() },
    });
    const coc = () => ({
      uFocus: { value: 4 },
      uAperture: { value: 7 },
      uMaxCoc: { value: 32 },
    });
    this.dofPass = pass(
      DOF_FRAGMENT,
      {
        ...depth(),
        ...coc(),
        tColor: { value: this.hdr.texture },
        uResolution: { value: new THREE.Vector2() },
      },
      { DOF_SAMPLES: dofSamples },
    );
    this.meterPass = pass(METER_FRAGMENT, {
      tColor: { value: this.hdr.texture },
      uCell: { value: new THREE.Vector2(1 / METER, 1 / METER) },
    });
    this.accumPass = pass(
      ACCUMULATE_FRAGMENT,
      { tColor: { value: this.hdr.texture }, uWeight: { value: 1 } },
      {},
      THREE.AdditiveBlending,
    );
    this.finishPass = pass(FINISH_FRAGMENT, {
      ...depth(),
      ...coc(),
      tColor: { value: this.hdr.texture },
      tAO: { value: this.white },
      tDOF: { value: this.dof.texture },
      toneMappingExposure: { value: 1 },
      uExposure: { value: 1 },
      uNight: { value: 0 },
      uAOStrength: { value: 0.85 },
      uDOF: { value: 0 },
      uGrain: { value: 0.022 },
      uGrainSeed: { value: 0 },
      uVignette: { value: 0.22 },
      uAspect: { value: 16 / 9 },
    });
  }

  /** Drawing-buffer size in pixels. */
  setSize(width: number, height: number) {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.hdr.setSize(this.width, this.height);
    this.accum.setSize(this.width, this.height);
    const hw = Math.max(1, this.width >> 1),
      hh = Math.max(1, this.height >> 1);
    this.ao.setSize(hw, hh);
    this.aoBlur.setSize(hw, hh);
    this.dof.setSize(hw, hh);
  }

  /** Draws the scene in one or two depth ranges into the HDR buffer. */
  private drawScene(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    const r = this.renderer;
    r.setRenderTarget(this.hdr);
    r.clear(true, true, true);
    const near = camera.near,
      far = camera.far;
    if (near >= SPLIT_BELOW_NEAR) {
      camera.layers.enable(FAR_LAYER);
      r.render(scene, camera);
      return { near, far };
    }
    // Far range, then the near range over it with a fresh depth buffer.
    camera.layers.enable(FAR_LAYER);
    camera.near = SPLIT_AT * 0.9;
    camera.updateProjectionMatrix();
    r.render(scene, camera);
    r.clearDepth();
    camera.layers.disable(FAR_LAYER);
    camera.near = near;
    camera.far = SPLIT_AT;
    camera.updateProjectionMatrix();
    const shadows = r.shadowMap.autoUpdate;
    r.shadowMap.autoUpdate = false;
    r.render(scene, camera);
    r.shadowMap.autoUpdate = shadows;
    camera.layers.enable(FAR_LAYER);
    const used = { near, far: SPLIT_AT };
    camera.far = far;
    camera.updateProjectionMatrix();
    return used;
  }

  /** Forgets the reading (a new shot); the next is taken as soon as none is in flight. */
  resetMeter() {
    this.meterEpoch++;
    this.metered = null;
    this.meteredAt = -Infinity;
  }

  /** Takes a reading of `color` if one is due and none is in flight; it lands in `metered` a frame or two later. */
  private meter(color: THREE.Texture) {
    const now = performance.now();
    if (this.metering || now - this.meteredAt < 250) return;
    this.meteredAt = now;
    this.metering = true;
    const epoch = this.meterEpoch;
    this.meterPass.material.uniforms.tColor!.value = color;
    this.meterPass.render(this.renderer, this.meterTarget);
    this.renderer
      .readRenderTargetPixelsAsync(this.meterTarget, 0, 0, METER, METER, this.meterPixels)
      .then((px) => {
        if (epoch === this.meterEpoch) this.metered = centreWeighted(px as Uint8Array);
      })
      // Unreadable (a lost context, an old driver): the light's exposure stands.
      .catch(() => (this.metered = null))
      .finally(() => (this.metering = false));
  }

  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera, f: PostFrame) {
    const r = this.renderer;
    const autoClear = r.autoClear;
    r.autoClear = false;
    let range = { near: camera.near, far: camera.far };
    let color: THREE.Texture = this.hdr.texture;
    const n = f.blur && f.blur.samples > 1 ? f.blur.samples : 1;
    if (n > 1 && f.blur) {
      r.setRenderTarget(this.accum);
      r.clear(true, false, false);
      this.accumPass.material.uniforms.uWeight!.value = 1 / n;
      for (let k = 0; k < n; k++) {
        f.blur.set(k / (n - 1));
        range = this.drawScene(scene, camera);
        this.accumPass.render(r, this.accum);
      }
      color = this.accum.texture;
    } else range = this.drawScene(scene, camera);
    if (f.meter) this.meter(color);

    const P = camera.projectionMatrix.elements;
    // The projection the depth buffer was written with (the near range's, when split).
    const proj = new THREE.Vector2(P[0], P[5]);
    const setDepth = (m: THREE.ShaderMaterial) => {
      m.uniforms.uNear!.value = range.near;
      m.uniforms.uFar!.value = range.far;
      m.uniforms.uProj!.value.copy(proj);
    };
    const hw = Math.max(1, this.width >> 1),
      hh = Math.max(1, this.height >> 1);
    const scaleY = this.height / 1080;
    const fin = this.finishPass.material.uniforms;
    if (f.ao) {
      const u = this.aoPass.material.uniforms;
      setDepth(this.aoPass.material);
      u.uTexel!.value.set(1 / this.width, 1 / this.height);
      u.uResolution!.value.set(hw, hh);
      u.uRadius!.value = Math.min(0.3, Math.max(0.0004, f.focus.distance * 0.035));
      this.aoPass.render(r, this.ao);
      const b = this.aoBlurPass.material.uniforms;
      setDepth(this.aoBlurPass.material);
      b.uTexel!.value.set(1 / hw, 1 / hh);
      this.aoBlurPass.render(r, this.aoBlur);
      fin.tAO!.value = this.aoBlur.texture;
    } else fin.tAO!.value = this.white;
    const cocUniforms = (m: THREE.ShaderMaterial, pxScale: number) => {
      m.uniforms.uFocus!.value = f.focus.distance;
      m.uniforms.uAperture!.value = f.focus.aperture * scaleY * pxScale;
      m.uniforms.uMaxCoc!.value = 22 * scaleY * pxScale + 2;
    };
    if (f.dof) {
      const u = this.dofPass.material.uniforms;
      setDepth(this.dofPass.material);
      cocUniforms(this.dofPass.material, 0.5);
      u.tColor!.value = color;
      u.uResolution!.value.set(hw, hh);
      this.dofPass.render(r, this.dof);
    }
    setDepth(this.finishPass.material);
    cocUniforms(this.finishPass.material, 1);
    fin.tColor!.value = color;
    fin.uDOF!.value = f.dof ? 1 : 0;
    fin.uExposure!.value = f.exposure;
    fin.uNight!.value = f.night;
    fin.uGrainSeed!.value = (f.frameIndex % 997) * 1.618;
    fin.uAspect!.value = this.width / this.height;
    this.finishPass.render(r, null);
    r.autoClear = autoClear;
  }

  dispose() {
    for (const t of [
      this.hdr,
      this.accum,
      this.ao,
      this.aoBlur,
      this.dof,
      this.meterTarget,
    ]) {
      t.depthTexture?.dispose();
      t.dispose();
    }
    this.white.dispose();
    for (const p of [
      this.aoPass,
      this.aoBlurPass,
      this.dofPass,
      this.accumPass,
      this.finishPass,
      this.meterPass,
    ])
      p.material.dispose();
    Pass.geometry?.dispose();
    Pass.geometry = null;
  }
}
