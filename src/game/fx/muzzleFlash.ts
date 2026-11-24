import * as THREE from "three";

/**
 * Muzzle flash as layered geometry, not a sprite.
 *
 * A rifle's flash is three things at once: a white-hot core sitting on the
 * crown, a star of short blades where gas leaves the flash-hider slots (or two
 * fat side jets from a brake), and a ragged forward tongue of burning
 * propellant. Each of those is drawn here as its own card: the blades and the
 * tongue are *axial* billboards — long along their own axis, turned about it
 * to face the eye — so a prong reads as a blade from any angle and the tongue
 * shortens honestly when it points away from the camera, which is exactly how
 * a shooter sees his own flash: a star with a short cone in the middle.
 *
 * Every shot gets a new prong count, angle, length and tongue, and every
 * rendered frame re-jitters lengths and the noise seed, so no two frames of a
 * burst are the same picture. The colour is scene-linear HDR well above the
 * bloom threshold, so the composer's bloom and AgX roll it off.
 *
 * A flash is held by *rendered frames*, not by the clock: one full-strength
 * frame, then one cooler, larger ghost (and a short time-based tail at high
 * frame rates). A 40 ms flash on a time base vanishes entirely between two
 * frames whenever the frame time is longer than its life, and a flash you
 * never see is worse than one that lasts a frame too long.
 *
 * One instanced draw per renderer. The first-person renderer lives in the
 * weapon's stage scene and is carried by the muzzle socket; the third-person
 * one lives in the world with its cards in world space.
 */

export const FLASH_KIND = {
  /** Camera-facing white-hot disc on the crown. */
  core: 0,
  /** Thin tapered blade: a flash-hider prong or a spark jet. */
  prong: 1,
  /** Fat, ragged forward cone of burning gas. */
  tongue: 2,
  /** Large soft camera-facing halo, the glow bloom builds on. */
  glow: 3,
  /** Brake side jet: a short, wide, turbulent fan. */
  jet: 4,
} as const;

const CARDS_PER_BURST = 16;

const VERTEX = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec4 aStart;   // xyz origin, w kind
attribute vec4 aDir;     // xyz axis, w length
attribute vec4 aShape;   // x width0, y width1, z seed, w temperature
attribute vec4 aColor;   // rgb tint, w intensity
varying vec2 vUv;
varying vec4 vColor;
varying vec4 vShape;
varying float vKind;
void main() {
  vUv = uv;
  vColor = aColor;
  vShape = aShape;
  vKind = aStart.w;
  if (aColor.w < 0.001) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec4 startV = modelViewMatrix * vec4(aStart.xyz, 1.0);
  // Card sizes are authored in the renderer's own units; carry its scale.
  float sc = length(modelViewMatrix[0].xyz);
  vec3 p;
  float kind = aStart.w;
  if (kind < 0.5 || (kind > 2.5 && kind < 3.5)) {
    // Camera-facing disc, centred on the start point.
    p = startV.xyz + vec3((uv - 0.5) * aShape.x * sc, 0.0);
    // Pull a hair toward the eye so the crown never cuts the disc in half.
    p += normalize(-startV.xyz) * aShape.x * sc * 0.25;
  } else {
    vec3 axis = normalize(mat3(modelViewMatrix) * aDir.xyz);
    vec3 along = startV.xyz + axis * aDir.w * sc * uv.y;
    vec3 toEye = normalize(-along);
    vec3 side = cross(axis, toEye);
    float sl = length(side);
    side = sl > 1e-4 ? side / sl : vec3(1.0, 0.0, 0.0);
    // End-on, an axial card collapses to a line. Lend it width so a tongue
    // pointing at the eye still reads as a hot ball, not nothing.
    float endOn = 1.0 - sl;
    float width = mix(aShape.x, aShape.y, uv.y);
    width = max(width, aShape.x * endOn * 0.9) * sc;
    p = along + side * (uv.x - 0.5) * width;
  }
  gl_Position = projectionMatrix * vec4(p, 1.0);
  #include <logdepthbuf_vertex>
}
`;

const FRAGMENT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
varying vec2 vUv;
varying vec4 vColor;
varying vec4 vShape;
varying float vKind;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
    mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}
// Blackbody-ish ramp: 0 = dull red edge, 1 = white core.
vec3 ramp(float t) {
  vec3 red = vec3(1.0, 0.16, 0.02);
  vec3 orange = vec3(1.0, 0.46, 0.09);
  vec3 yellow = vec3(1.0, 0.8, 0.42);
  vec3 white = vec3(1.0, 0.96, 0.88);
  vec3 c = mix(red, orange, smoothstep(0.0, 0.35, t));
  c = mix(c, yellow, smoothstep(0.3, 0.7, t));
  return mix(c, white, smoothstep(0.68, 1.0, t));
}

void main() {
  #include <logdepthbuf_fragment>
  float seed = vShape.z;
  float temp = vShape.w;
  float x = (vUv.x - 0.5) * 2.0;
  float y = vUv.y;
  float mask;
  float heat;
  if (vKind < 0.5) {
    // Core: a hard white disc with a slightly ragged rim.
    vec2 c = (vUv - 0.5) * 2.0;
    float r = length(c);
    float a = atan(c.y, c.x);
    float rag = 0.82 + 0.3 * vnoise(vec2(a * 2.2 + seed * 17.0, seed * 3.1));
    float d = r / rag;
    mask = exp(-d * d * 5.5) * (1.0 - smoothstep(0.75, 1.0, r));
    heat = clamp(1.0 - d * 0.55, 0.0, 1.0);
  } else if (vKind > 2.5 && vKind < 3.5) {
    // Glow: a soft wide halo, gently lumpy so it does not read as a disc.
    vec2 c = (vUv - 0.5) * 2.0;
    float r = length(c);
    float lump = 0.8 + 0.4 * vnoise(c * 2.5 + seed * 11.0);
    mask = pow(max(0.0, 1.0 - r), 2.2) * lump;
    heat = 0.25 * (1.0 - r);
  } else if (vKind < 1.5) {
    // Prong: a sharp blade, widest just off the crown, ragged along its edge.
    float env = smoothstep(0.0, 0.08, y) * pow(max(0.0, 1.0 - y), 1.15);
    float n = vnoise(vec2(y * 7.0 + seed * 23.0, seed * 5.0));
    float edge = env * (0.65 + 0.6 * n);
    float d = abs(x) / max(edge, 0.001);
    mask = (1.0 - smoothstep(0.35, 1.0, d)) * smoothstep(1.0, 0.72, y + n * 0.12);
    heat = clamp((1.0 - d) * (1.0 - y * 0.85), 0.0, 1.0);
  } else {
    // Tongue (2) and jet (4): a fat turbulent cone, swelling then guttering.
    bool jet = vKind > 3.5;
    float swell = jet ? pow(sin(min(y * 1.15, 1.0) * PI), 0.5)
                      : pow(sin(clamp(pow(y, 0.62), 0.0, 1.0) * PI), 0.75);
    float n1 = vnoise(vec2(y * 5.0 + seed * 31.0, x * 1.5 + seed * 7.0));
    float n2 = vnoise(vec2(y * 13.0 - seed * 19.0, x * 3.5 + seed * 2.0));
    float turb = n1 * 0.65 + n2 * 0.35;
    float edge = swell * (0.55 + 0.7 * turb);
    float d = abs(x + (turb - 0.5) * 0.35 * y) / max(edge, 0.001);
    float body = 1.0 - smoothstep(0.25, 1.0, d);
    // Ragged tip: the cone breaks up into licks rather than ending in a line.
    float tip = smoothstep(1.02, 0.55, y + turb * 0.4);
    mask = body * tip * smoothstep(0.0, 0.04, y);
    // A brighter shock band a little way out, where the gas re-compresses.
    float shock = jet ? 0.0 : exp(-pow((y - 0.24) * 9.0, 2.0)) * 0.35;
    heat = clamp((1.0 - d * 0.8) * (1.0 - y * 0.9) + shock, 0.0, 1.0);
  }
  heat = clamp(heat * (0.55 + 0.45 * temp) + temp * 0.15, 0.0, 1.0);
  float intensity = vColor.w;
  // Emission climbs steeply with temperature: the core sits far above the
  // bloom threshold, the licks at the edge only just reach it.
  float emission = mix(2.2, 46.0, heat * heat) * intensity;
  vec3 rgb = ramp(heat) * vColor.rgb * emission * mask;
  if (max(rgb.r, max(rgb.g, rgb.b)) < 0.004) discard;
  gl_FragColor = vec4(rgb, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

interface Burst {
  active: boolean;
  /** Rendered frames since the burst was spawned. */
  frames: number;
  age: number;
  intensity: number;
  /** Per-card base length and widths, re-jittered every frame. */
  readonly baseLen: Float32Array;
  readonly baseW0: Float32Array;
  readonly baseW1: Float32Array;
  readonly baseTemp: Float32Array;
  readonly baseIntensity: Float32Array;
  readonly kinds: Uint8Array;
  count: number;
}

export interface FlashSpec {
  /** Origin of the flash, in the renderer's space. */
  origin: THREE.Vector3;
  /** Unit barrel axis (the way the round leaves). */
  forward: THREE.Vector3;
  /** Unit vector to the weapon's right. */
  right: THREE.Vector3;
  /** Unit vector to the weapon's top. */
  up: THREE.Vector3;
  /** Overall size multiplier; 1 is a rifle seen from the shoulder. */
  scale: number;
  /** Calibre class, 0.2 (pistol) to 0.34 (LMG/marksman). */
  calibre: number;
  /** Muzzle brake: two side jets replace most of the forward star. */
  brake: boolean;
}

const _side = new THREE.Vector3();
const _dir = new THREE.Vector3();

export class MuzzleFlashRenderer {
  readonly mesh: THREE.Mesh;
  private readonly bursts: Burst[] = [];
  private cursor = 0;
  private readonly start: Float32Array;
  private readonly dir: Float32Array;
  private readonly shape: Float32Array;
  private readonly color: Float32Array;
  private readonly geometry: THREE.InstancedBufferGeometry;
  private readonly material: THREE.ShaderMaterial;
  private dirty = false;

  constructor(capacity: number, name: string) {
    const base = new THREE.PlaneGeometry(1, 1);
    // uv.y runs along the card: put the card's origin at its base.
    base.translate(0, 0.5, 0);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = base.index;
    geometry.attributes["position"] = base.attributes["position"]!;
    geometry.attributes["uv"] = base.attributes["uv"]!;
    const total = capacity * CARDS_PER_BURST;
    geometry.instanceCount = total;
    this.start = new Float32Array(total * 4);
    this.dir = new Float32Array(total * 4);
    this.shape = new Float32Array(total * 4);
    this.color = new Float32Array(total * 4);
    const add = (attr: string, array: Float32Array): void => {
      const attribute = new THREE.InstancedBufferAttribute(array, 4);
      attribute.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute(attr, attribute);
    };
    add("aStart", this.start);
    add("aDir", this.dir);
    add("aShape", this.shape);
    add("aColor", this.color);
    for (let i = 0; i < capacity; i += 1) {
      this.bursts.push({
        active: false,
        frames: 0,
        age: 0,
        intensity: 0,
        baseLen: new Float32Array(CARDS_PER_BURST),
        baseW0: new Float32Array(CARDS_PER_BURST),
        baseW1: new Float32Array(CARDS_PER_BURST),
        baseTemp: new Float32Array(CARDS_PER_BURST),
        baseIntensity: new Float32Array(CARDS_PER_BURST),
        kinds: new Uint8Array(CARDS_PER_BURST),
        count: 0,
      });
    }
    this.material = new THREE.ShaderMaterial({
      name: "fx-muzzle-flash",
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
      side: THREE.DoubleSide,
      toneMapped: true,
    });
    this.geometry = geometry;
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
    this.mesh.name = name;
    this.mesh.userData["noCollide"] = true;
    base.dispose();
  }

  /** True while any burst is still on screen. */
  get busy(): boolean {
    for (const b of this.bursts) if (b.active) return true;
    return false;
  }

  /**
   * Lay out a new flash. `slot` pins the burst (the first-person renderer
   * reuses slot 0 so a new shot replaces the previous ghost); otherwise the
   * ring buffer picks the next.
   */
  spawn(spec: FlashSpec, rand: () => number, slot?: number): number {
    const index = slot ?? this.cursor;
    if (slot === undefined) this.cursor = (this.cursor + 1) % this.bursts.length;
    const burst = this.bursts[index]!;
    const first = index * CARDS_PER_BURST;
    const s = spec.scale * (spec.calibre / 0.26);
    let card = 0;
    const put = (
      kind: number,
      ox: number,
      oy: number,
      oz: number,
      dx: number,
      dy: number,
      dz: number,
      length: number,
      w0: number,
      w1: number,
      temp: number,
      intensity: number,
    ): void => {
      if (card >= CARDS_PER_BURST) return;
      const i = first + card;
      const i4 = i * 4;
      this.start[i4] = ox;
      this.start[i4 + 1] = oy;
      this.start[i4 + 2] = oz;
      this.start[i4 + 3] = kind;
      this.dir[i4] = dx;
      this.dir[i4 + 1] = dy;
      this.dir[i4 + 2] = dz;
      this.dir[i4 + 3] = length;
      this.shape[i4] = w0;
      this.shape[i4 + 1] = w1;
      this.shape[i4 + 2] = rand() * 64;
      this.shape[i4 + 3] = temp;
      // A warm-white tint with a little per-card drift toward orange.
      const warm = rand() * 0.12;
      this.color[i4] = 1;
      this.color[i4 + 1] = 0.94 - warm;
      this.color[i4 + 2] = 0.86 - warm * 1.6;
      this.color[i4 + 3] = intensity;
      burst.baseLen[card] = length;
      burst.baseW0[card] = w0;
      burst.baseW1[card] = w1;
      burst.baseTemp[card] = temp;
      burst.baseIntensity[card] = intensity;
      burst.kinds[card] = kind;
      card += 1;
    };

    const o = spec.origin;
    const f = spec.forward;
    const r = spec.right;
    const u = spec.up;

    // Core on the crown, and the halo around it.
    put(FLASH_KIND.core, o.x, o.y, o.z, f.x, f.y, f.z, 0, 0.05 * s, 0, 1, 1);
    put(
      FLASH_KIND.glow,
      o.x + f.x * 0.03 * s,
      o.y + f.y * 0.03 * s,
      o.z + f.z * 0.03 * s,
      f.x,
      f.y,
      f.z,
      0,
      (0.22 + rand() * 0.08) * s,
      0,
      0.2,
      0.16,
    );

    // Forward tongue: one ragged outer cone and a hotter, narrower inner one,
    // each kinked a few degrees off the bore.
    const tongueLen = (0.15 + rand() * 0.17) * s * (spec.brake ? 0.6 : 1);
    for (let k = 0; k < 2; k += 1) {
      const inner = k === 1;
      const kink = inner ? 0.03 : 0.07;
      _dir
        .copy(f)
        .addScaledVector(r, (rand() - 0.5) * kink * 2)
        .addScaledVector(u, (rand() - 0.5) * kink * 2)
        .normalize();
      put(
        FLASH_KIND.tongue,
        o.x,
        o.y,
        o.z,
        _dir.x,
        _dir.y,
        _dir.z,
        tongueLen * (inner ? 0.62 : 1),
        (inner ? 0.032 : 0.06) * s,
        0.006 * s,
        inner ? 0.95 : 0.55,
        inner ? 0.9 : 0.62,
      );
    }

    if (spec.brake) {
      // Two fat side fans out of the brake ports, a little behind the crown
      // and swept slightly back, plus a smaller pair from the front port.
      for (let side = -1; side <= 1; side += 2) {
        for (let k = 0; k < 2; k += 1) {
          const back = k === 0 ? 0.028 : 0.012;
          _dir
            .copy(r)
            .multiplyScalar(side)
            .addScaledVector(f, k === 0 ? -0.18 : 0.25)
            .addScaledVector(u, 0.12 + (rand() - 0.5) * 0.3)
            .normalize();
          put(
            FLASH_KIND.jet,
            o.x - f.x * back * s,
            o.y - f.y * back * s,
            o.z - f.z * back * s,
            _dir.x,
            _dir.y,
            _dir.z,
            (k === 0 ? 0.11 : 0.07) * s * (0.8 + rand() * 0.45),
            (k === 0 ? 0.075 : 0.05) * s,
            0.02 * s,
            0.7,
            0.85,
          );
        }
      }
    }

    // The star: 3-5 blades out of the hider slots, tilted forward, uneven.
    const prongs = spec.brake ? 2 : 3 + Math.floor(rand() * 3);
    const phase = rand() * Math.PI * 2;
    for (let k = 0; k < prongs; k += 1) {
      const angle = phase + (k / prongs) * Math.PI * 2 + (rand() - 0.5) * 0.7;
      _side.copy(r).multiplyScalar(Math.cos(angle)).addScaledVector(u, Math.sin(angle));
      const tilt = 0.35 + rand() * 0.75;
      _dir.copy(_side).addScaledVector(f, tilt).normalize();
      const len = (0.05 + rand() * 0.075) * s * (spec.brake ? 0.6 : 1);
      put(
        FLASH_KIND.prong,
        o.x + f.x * 0.004,
        o.y + f.y * 0.004,
        o.z + f.z * 0.004,
        _dir.x,
        _dir.y,
        _dir.z,
        len,
        (0.013 + rand() * 0.008) * s,
        0.0015 * s,
        0.75,
        0.85 + rand() * 0.3,
      );
    }

    // A few unburnt-powder sparks that outrun the flash.
    const sparks = 2 + Math.floor(rand() * 3);
    for (let k = 0; k < sparks; k += 1) {
      _dir
        .copy(f)
        .addScaledVector(r, (rand() - 0.5) * 0.9)
        .addScaledVector(u, (rand() - 0.5) * 0.9)
        .normalize();
      const at = (0.03 + rand() * 0.12) * s;
      put(
        FLASH_KIND.prong,
        o.x + _dir.x * at,
        o.y + _dir.y * at,
        o.z + _dir.z * at,
        _dir.x,
        _dir.y,
        _dir.z,
        (0.04 + rand() * 0.07) * s,
        0.004 * s,
        0.001 * s,
        0.9,
        0.5,
      );
    }

    burst.count = card;
    // Blank the unused tail of the burst's block.
    for (let k = card; k < CARDS_PER_BURST; k += 1) {
      this.color[(first + k) * 4 + 3] = 0;
    }
    burst.active = true;
    burst.frames = 0;
    burst.age = 0;
    burst.intensity = 1;
    this.applyFrame(index, rand);
    return index;
  }

  /** Envelope for a burst `frames` rendered frames and `age` seconds old. */
  static envelope(frames: number, age: number): number {
    if (frames <= 0) return 1;
    if (frames === 1) return 0.34;
    return age < 0.05 ? 0.34 * (1 - age / 0.05) : 0;
  }

  /** The strongest burst this frame, for a light to follow. */
  peak(): number {
    let best = 0;
    for (const b of this.bursts) if (b.active && b.intensity > best) best = b.intensity;
    return best;
  }

  /** Re-jitter one burst for the frame about to render. */
  private applyFrame(index: number, rand: () => number): void {
    const burst = this.bursts[index]!;
    const first = index * CARDS_PER_BURST;
    const env = burst.intensity;
    // The ghost frame is larger and cooler: the gas keeps expanding as it burns.
    const grow = burst.frames === 0 ? 1 : 1.25 + burst.age * 3;
    const cool = burst.frames === 0 ? 1 : 0.55;
    for (let k = 0; k < burst.count; k += 1) {
      const i4 = (first + k) * 4;
      const kind = burst.kinds[k]!;
      const jitter = kind === FLASH_KIND.core ? 0.9 + rand() * 0.2 : 0.75 + rand() * 0.5;
      this.dir[i4 + 3] = burst.baseLen[k]! * jitter * grow;
      this.shape[i4] = burst.baseW0[k]! * (0.85 + rand() * 0.3) * grow;
      this.shape[i4 + 1] = burst.baseW1[k]! * grow;
      this.shape[i4 + 2] = rand() * 64;
      this.shape[i4 + 3] = burst.baseTemp[k]! * cool;
      // The core and prongs die first; the halo and the tongue linger.
      const keep =
        burst.frames === 0
          ? 1
          : kind === FLASH_KIND.glow || kind === FLASH_KIND.tongue
            ? 1
            : kind === FLASH_KIND.core
              ? 0.5
              : 0.6;
      this.color[i4 + 3] = burst.baseIntensity[k]! * env * keep;
    }
    this.dirty = true;
  }

  /**
   * Advance every burst by one rendered frame. Call once per frame, after
   * this frame's spawns: a burst spawned this frame is left at full strength.
   */
  update(dt: number, rand: () => number): void {
    for (let b = 0; b < this.bursts.length; b += 1) {
      const burst = this.bursts[b]!;
      if (!burst.active) continue;
      if (burst.frames === 0 && burst.age === 0) {
        // Spawned this frame: leave it at its first, full-strength frame.
        burst.age = 1e-6;
        continue;
      }
      burst.frames += 1;
      burst.age += dt;
      burst.intensity = MuzzleFlashRenderer.envelope(burst.frames, burst.age);
      if (burst.intensity <= 0.01) {
        burst.active = false;
        const first = b * CARDS_PER_BURST;
        for (let k = 0; k < CARDS_PER_BURST; k += 1) this.color[(first + k) * 4 + 3] = 0;
        this.dirty = true;
        continue;
      }
      this.applyFrame(b, rand);
    }
    if (this.dirty) {
      for (const name of ["aStart", "aDir", "aShape", "aColor"]) {
        this.geometry.getAttribute(name).needsUpdate = true;
      }
      this.dirty = false;
    }
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
