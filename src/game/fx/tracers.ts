import * as THREE from "three";

/**
 * Tracers: a thin HDR streak with a white-hot head.
 *
 * The quad stays a hairline on screen at any range (its width grows with
 * distance only as far as one pixel needs), the body fades toward the tail,
 * and the last few percent toward the head widen slightly and go white so the
 * round itself reads as the brightest point and blooms. When the head arrives
 * the streak drains into the impact point instead of blinking out.
 *
 * The clock is offset by a sliver of a frame: on the frame a round is fired
 * its head is already a few metres out, so a tracer is seen at least once even
 * when a frame takes longer than its whole flight.
 */

const TRACER_VERTEX = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec3 aOrigin;
attribute vec4 aDir;    // xyz + total distance
attribute vec4 aParams; // spawnTime, speed, length, width
attribute vec4 aColor;  // rgb + near fade distance
uniform float uTime;
varying vec3 vColor;
varying vec2 vUv;
varying float vFade;
void main() {
  float age = uTime - aParams.x + 0.012;
  float speed = max(1.0, aParams.y);
  float total = aDir.w;
  float len = aParams.z;
  float life = (total + len) / speed + 0.02;
  if (age < 0.0 || age > life) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vColor = vec3(0.0);
    vUv = vec2(0.0);
    vFade = 0.0;
    return;
  }
  float travelled = age * speed;
  float head = min(travelled, total);
  float tail = clamp(travelled - len, 0.0, total);
  vec3 headPos = aOrigin + aDir.xyz * head;
  vec3 tailPos = aOrigin + aDir.xyz * tail;

  // Fade in over the first metres so the shooter is not blinded, and drain
  // into the impact point as the tail catches up with the head.
  float nearFade = smoothstep(0.0, aColor.w, head);
  float drain = smoothstep(0.0, len * 0.5, total - tail);

  vec3 world = mix(tailPos, headPos, uv.y);
  vec3 viewDir = normalize(cameraPosition - world);
  vec3 side = normalize(cross(aDir.xyz, viewDir));
  float dist = max(0.5, length(cameraPosition - world));
  // Authored width is about a centimetre. The distance term holds a
  // hairline on screen instead of growing a world-space ribbon.
  float width = max(aParams.w, dist * 0.0011);
  width *= 1.0 + smoothstep(0.82, 1.0, uv.y) * 0.9;
  world += side * (uv.x - 0.5) * width;

  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  vUv = uv;
  vColor = aColor.rgb;
  vFade = nearFade * drain;
  #include <logdepthbuf_vertex>
}
`;

const TRACER_FRAGMENT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
varying vec3 vColor;
varying vec2 vUv;
varying float vFade;
void main() {
  #include <logdepthbuf_fragment>
  float across = clamp(1.0 - abs(vUv.x - 0.5) * 2.0, 0.0, 1.0);
  float core = smoothstep(0.0, 0.5, across);
  float y = vUv.y;
  float body = smoothstep(0.0, 0.25, y) * pow(max(y, 0.0001), 1.7);
  float headZone = smoothstep(0.84, 0.97, y) * (1.0 - smoothstep(0.985, 1.0, y) * 0.6);
  float hot = core * core;
  vec3 rgb = vColor * body * core + vec3(1.0, 0.92, 0.78) * headZone * hot * 3.2 * length(vColor);
  rgb *= vFade;
  if (max(rgb.r, max(rgb.g, rgb.b)) < 0.01) discard;
  gl_FragColor = vec4(rgb, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const _dir = new THREE.Vector3();
const _color = new THREE.Color();

export class TracerRenderer {
  readonly mesh: THREE.Mesh;
  private readonly capacity: number;
  private cursor = 0;
  private time = 0;
  private readonly origin: Float32Array;
  private readonly dir: Float32Array;
  private readonly params: Float32Array;
  private readonly color: Float32Array;
  private readonly geometry: THREE.InstancedBufferGeometry;
  private readonly material: THREE.ShaderMaterial;
  private dirty = false;

  constructor(capacity = 256) {
    this.capacity = capacity;
    const base = new THREE.PlaneGeometry(1, 1);
    base.translate(0, 0.5, 0);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = base.index;
    geometry.attributes["position"] = base.attributes["position"]!;
    geometry.attributes["uv"] = base.attributes["uv"]!;
    geometry.instanceCount = capacity;
    this.origin = new Float32Array(capacity * 3);
    this.dir = new Float32Array(capacity * 4);
    this.params = new Float32Array(capacity * 4);
    this.color = new Float32Array(capacity * 4);
    for (let i = 0; i < capacity; i += 1) this.params[i * 4] = -1000;
    const add = (name: string, array: Float32Array, size: number): void => {
      const attribute = new THREE.InstancedBufferAttribute(array, size);
      attribute.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute(name, attribute);
    };
    add("aOrigin", this.origin, 3);
    add("aDir", this.dir, 4);
    add("aParams", this.params, 4);
    add("aColor", this.color, 4);

    this.material = new THREE.ShaderMaterial({
      name: "fx-tracers",
      vertexShader: TRACER_VERTEX,
      fragmentShader: TRACER_FRAGMENT,
      uniforms: { uTime: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
      toneMapped: true,
    });
    this.geometry = geometry;
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 11;
    this.mesh.name = "fx-tracers";
    this.mesh.userData["noCollide"] = true;
    base.dispose();
  }

  /**
   * `nearFade` is how far the streak travels before it reaches full strength:
   * short when it starts at a muzzle the camera can see, longer from an eye.
   */
  add(
    from: THREE.Vector3,
    to: THREE.Vector3,
    speed: number,
    color: number,
    local: boolean,
    nearFade = 2.4,
  ): void {
    _dir.copy(to).sub(from);
    const distance = _dir.length();
    if (distance < 0.05) return;
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    _dir.multiplyScalar(1 / distance);
    const i3 = i * 3;
    const i4 = i * 4;
    this.origin[i3] = from.x;
    this.origin[i3 + 1] = from.y;
    this.origin[i3 + 2] = from.z;
    this.dir[i4] = _dir.x;
    this.dir[i4 + 1] = _dir.y;
    this.dir[i4 + 2] = _dir.z;
    this.dir[i4 + 3] = distance;
    this.params[i4] = this.time;
    this.params[i4 + 1] = speed;
    // A round covers 15 m in a 60 Hz frame; the eye integrates a few metres
    // of that into a streak.
    this.params[i4 + 2] = local ? 3.6 : 2.8;
    this.params[i4 + 3] = local ? 0.012 : 0.009;
    _color.setHex(color);
    // HDR so the hairline still blooms. The quad itself stays thin.
    const gain = local ? 5.5 : 4.4;
    this.color[i4] = _color.r * gain;
    this.color[i4 + 1] = _color.g * gain;
    this.color[i4 + 2] = _color.b * gain;
    this.color[i4 + 3] = nearFade;
    this.dirty = true;
  }

  /** Move the clock before this frame's tracers are added. */
  advance(dt: number): void {
    this.time += dt;
    this.material.uniforms["uTime"]!.value = this.time;
  }

  flush(): void {
    if (!this.dirty) return;
    for (const name of ["aOrigin", "aDir", "aParams", "aColor"]) {
      this.geometry.getAttribute(name).needsUpdate = true;
    }
    this.dirty = false;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
