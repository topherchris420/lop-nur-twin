/**
 * Rain and snow when Bethesda's reported weather has them: streaks the
 * length a falling drop travels while the shutter is open, in a box around
 * what the lens is looking at. Drops are placed by a seeded hash on a grid
 * fixed in the world, so they do not slide when the camera moves, and fall
 * by presented time, so a stop-motion frame shows them where they were at
 * that frame's instant. Nothing is simulated: the amount is the reported
 * precipitation, read as a picture.
 */
import * as THREE from "three";
import type { RGB } from "../core/sky.js";
import type { V3 } from "../core/vec.js";

const VERTEX = /* glsl */ `
attribute vec4 aSeed;
attribute float aEnd;
uniform vec3 uCenter, uHalf;
uniform float uTime, uSpeed, uLength, uDrift;
varying float vFade;
void main() {
  vec3 lo = uCenter - uHalf;
  vec3 size = uHalf * 2.0;
  // A fixed world lattice of drop columns, wrapped into the box.
  float x = lo.x + mod( aSeed.x * 37.0 - lo.x, size.x );
  float z = lo.z + mod( aSeed.z * 37.0 - lo.z, size.z );
  float y = lo.y + mod( aSeed.y * 23.0 - uTime * uSpeed * ( 0.85 + 0.3 * aSeed.w ) - lo.y, size.y );
  vec3 p = vec3( x + uDrift * ( y - lo.y ), y, z );
  p += vec3( uDrift, 1.0, 0.0 ) * uLength * aEnd;
  // Fade at the box's edges so it has no visible walls.
  vec3 e = abs( p - uCenter ) / uHalf;
  vFade = ( 1.0 - smoothstep( 0.7, 1.0, max( e.x, e.z ) ) ) * ( 1.0 - smoothstep( 0.8, 1.0, e.y ) ) * mix( 0.35, 1.0, aEnd );
  gl_Position = projectionMatrix * modelViewMatrix * vec4( p, 1.0 );
}`;

const FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vFade;
void main() { gl_FragColor = vec4( uColor, uOpacity * vFade ); }`;

export interface Precipitation {
  /** 0 none … 1 heavy. */
  amount: number;
  snow: boolean;
  /** Centre and half-size of the box (m). */
  center: V3;
  size: number;
  /** Presented time, reduced for float precision. */
  time: number;
  /** Colour of the sky light the drops catch (linear). */
  sky: RGB;
  wind: number;
}

export class Rain {
  readonly lines: THREE.LineSegments;
  private readonly material: THREE.ShaderMaterial;
  private readonly max: number;

  constructor(max: number) {
    this.max = max;
    const seeds = new Float32Array(max * 2 * 4);
    const ends = new Float32Array(max * 2);
    let s = 0x9e3779b9;
    const next = () => {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      return (s >>> 0) / 4294967296;
    };
    for (let i = 0; i < max; i++) {
      const v = [next(), next(), next(), next()];
      for (let e = 0; e < 2; e++) {
        seeds.set(v, (2 * i + e) * 4);
        ends[2 * i + e] = e;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(max * 2 * 3), 3),
    );
    g.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 4));
    g.setAttribute("aEnd", new THREE.BufferAttribute(ends, 1));
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uCenter: { value: new THREE.Vector3() },
        uHalf: { value: new THREE.Vector3(1, 1, 1) },
        uTime: { value: 0 },
        uSpeed: { value: 6.5 },
        uLength: { value: 0.12 },
        uDrift: { value: 0 },
        uColor: { value: new THREE.Color() },
        uOpacity: { value: 0.3 },
      },
      transparent: true,
      depthWrite: false,
    });
    this.lines = new THREE.LineSegments(g, this.material);
    this.lines.name = "rain";
    this.lines.frustumCulled = false;
    this.lines.visible = false;
  }

  update(p: Precipitation) {
    this.lines.visible = p.amount > 0.001;
    if (!this.lines.visible) return;
    const u = this.material.uniforms;
    const half = p.size;
    u.uCenter!.value.set(...p.center);
    u.uHalf!.value.set(half, half, half);
    u.uTime!.value = p.time;
    // Drops fall at about 6.5 m/s; a 1/50 s exposure draws 13 cm of it. Snow drifts down slowly.
    u.uSpeed!.value = p.snow ? 0.9 : 6.5;
    u.uLength!.value = Math.min(p.snow ? 0.006 : 0.13, half * 0.5);
    u.uDrift!.value = Math.min(0.35, p.wind / 60) * (p.snow ? 2 : 1);
    const k = p.snow ? 1.6 : 1.1;
    u.uColor!.value.setRGB(p.sky[0] * k, p.sky[1] * k, p.sky[2] * k);
    u.uOpacity!.value = p.snow ? 0.75 : 0.22 + 0.2 * p.amount;
    // About a hundred drops per cubic metre in light rain, a thousand in heavy; a macro lens's few
    // centimetres of air rarely hold one. Snowflakes are fewer and larger.
    const perM3 = (p.snow ? 40 : 100) + (p.snow ? 300 : 900) * p.amount;
    const count = Math.min(this.max, Math.round(perM3 * (2 * half) ** 3));
    this.lines.geometry.setDrawRange(0, count * 2);
  }

  dispose() {
    this.lines.removeFromParent();
    this.lines.geometry.dispose();
    this.material.dispose();
  }
}
