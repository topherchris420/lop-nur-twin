/**
 * Beyond the garden: the neighbour's shrubs over the fence, two clay houses
 * and autumn trees down the street, and the painted sky. The sky is a dome
 * drawn by one shader from the same light state as the garden: its colours
 * from the hour and weather, the sun's disc and halo where the sun really
 * is, the moon at its real position and phase (lit from the sun's true
 * direction, so its terminator is right), stars when it is dark and clear,
 * and soft painted clouds that drift with presented time.
 *
 * None of it is a map of a real street: the houses are generic set
 * dressing, out of focus at every lens.
 */
import * as THREE from "three";
import type { Light } from "../core/sky.js";
import type { V3 } from "../core/vec.js";
import type { ClayLibrary } from "./clay.js";
import { blob, clayColor, merge, rng, tint, tube } from "./geometry.js";
import { paintedSky } from "./textures.js";

const SKY_VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize( position );
  vec4 p = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  gl_Position = p.xyww;
}`;

const SKY_FRAGMENT = /* glsl */ `
uniform vec3 uZenith, uHorizon, uSunDir, uSunColor, uMoonDir;
uniform float uSunIntensity, uMoonGlow, uDaylight, uGolden, uCloud, uTime, uFog, uFrame;
uniform sampler2D uClouds;
varying vec3 vDir;
float sHash( vec2 p ) { return fract( sin( dot( p, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ); }
void main() {
  vec3 d = normalize( vDir );
  float e = d.y;
  float up = clamp( e, 0.0, 1.0 );
  vec3 sky = mix( uHorizon, uZenith, pow( up, 0.45 ) );
  // Warm glow along the horizon toward the sun at golden hour.
  float toward = max( dot( normalize( vec3( d.x, 0.0, d.z ) ), normalize( vec3( uSunDir.x, 0.0, uSunDir.z ) + 1e-5 ) ), 0.0 );
  sky += uSunColor * uGolden * pow( toward, 6.0 ) * exp( -up * 9.0 ) * 0.9;
  float cosSun = dot( d, uSunDir );
  // Sun: disc, a tight aureole and a broad halo; no lens glare.
  float sunUp = smoothstep( -0.02, 0.01, uSunDir.y );
  sky += uSunColor * sunUp * uSunIntensity * ( smoothstep( 0.99996, 0.99999, cosSun ) * 60.0 + pow( max( cosSun, 0.0 ), 900.0 ) * 1.2 + pow( max( cosSun, 0.0 ), 12.0 ) * 0.12 ) * ( 1.0 - 0.85 * uCloud );
  // Stars, when dark and clear; a few twinkle from frame to frame.
  float dark = ( 1.0 - uDaylight ) * ( 1.0 - uCloud ) * smoothstep( 0.02, 0.2, e );
  if ( dark > 0.0 ) {
    vec2 sc = vec2( atan( d.z, d.x ), asin( clamp( e, -1.0, 1.0 ) ) ) * 180.0;
    vec2 cell = floor( sc );
    float h = sHash( cell );
    if ( h > 0.985 ) {
      vec2 c = cell + vec2( sHash( cell + 1.7 ), sHash( cell + 3.1 ) );
      float s = smoothstep( 0.55, 0.0, length( sc - c ) );
      float tw = 0.7 + 0.3 * sHash( cell + uFrame );
      sky += vec3( 0.85, 0.9, 1.0 ) * s * ( h - 0.985 ) * 60.0 * tw * dark;
    }
  }
  // The moon: a sphere lit from the sun's direction.
  float cosMoon = dot( d, uMoonDir );
  float moonR = 0.0068;
  if ( cosMoon > cos( moonR * 1.6 ) && uMoonDir.y > -0.02 ) {
    vec3 mx = normalize( cross( vec3( 0.0, 1.0, 0.0 ), uMoonDir ) );
    vec3 my = cross( uMoonDir, mx );
    vec2 q = vec2( dot( d, mx ), dot( d, my ) ) / moonR;
    float rr = dot( q, q );
    if ( rr < 1.0 ) {
      vec3 n = normalize( mx * q.x + my * q.y - uMoonDir * sqrt( 1.0 - rr ) );
      float lit = smoothstep( -0.05, 0.08, dot( n, uSunDir ) );
      float maria = 0.82 + 0.18 * sHash( floor( q * 5.0 ) );
      vec3 moon = vec3( 0.92, 0.93, 0.98 ) * maria * ( lit * uMoonGlow + 0.02 * uMoonGlow );
      sky = mix( sky, moon + sky * 0.3, smoothstep( 1.0, 0.92, rr ) * ( 1.0 - 0.8 * uCloud ) );
    }
    sky += vec3( 0.75, 0.8, 1.0 ) * uMoonGlow * 0.08 * pow( max( cosMoon, 0.0 ), 3000.0 ) * ( 1.0 - uCloud );
  }
  // Painted clouds in a band above the horizon, drifting.
  float v = 1.0 - clamp( e / 0.55, 0.0, 1.0 );
  float u = atan( d.z, d.x ) / 6.2831853 + uTime * 0.0004;
  float a = texture2D( uClouds, vec2( u, v ) ).a;
  float cover = clamp( 0.25 + 1.2 * uCloud, 0.0, 1.0 );
  a = clamp( a * ( 0.8 + 2.2 * cover ), 0.0, 1.0 ) * smoothstep( 0.0, 0.04, e );
  vec3 cloudLit = mix( uHorizon * 1.25 + vec3( 0.05 ), uSunColor * 1.6, uGolden * 0.6 ) * ( 0.25 + 0.75 * uDaylight );
  vec3 cloudShade = mix( uHorizon, uZenith, 0.5 ) * 0.75;
  float side = 0.5 + 0.5 * dot( normalize( vec3( d.x, 0.0, d.z ) ), normalize( vec3( uSunDir.x, 0.0, uSunDir.z ) + 1e-5 ) );
  sky = mix( sky, mix( cloudShade, cloudLit, side ), a );
  // Overcast flattens everything toward the haze.
  sky = mix( sky, uHorizon * ( 0.9 + 0.2 * up ), uFog * 0.7 );
  gl_FragColor = vec4( sky, 1.0 );
}`;

/** A mound of foliage: where it stands, how big, its shape, its colour (sRGB). */
interface Crown {
  centre: V3;
  radius: number;
  squash: V3;
  color: number;
}

/**
 * Foliage as a sculptor builds it: a mound of rounded leaf clusters pressed
 * together, each its own shade, darker underneath and lighter where the sky
 * reaches. One instanced clump shape serves every cluster.
 */
function foliage(
  lib: ClayLibrary,
  name: string,
  crowns: Crown[],
  r: () => number,
  o: {
    clump: [number, number];
    perRadius: number;
    detail: number;
    scale: number;
    scatter: number;
  },
): THREE.InstancedMesh {
  const unit = blob(1, { detail: o.detail, seed: 0xbac7, lumps: 0.16, frequency: 1.7 });
  const counts = crowns.map((c) => Math.max(8, Math.round(c.radius * o.perRadius)));
  const mesh = new THREE.InstancedMesh(
    unit,
    lib.get(name, {
      color: 0xffffff,
      roughness: 0.85,
      scale: o.scale,
      relief: 0.1,
      smudge: 0.2,
      wrap: 0.6,
      scatter: o.scatter,
    }),
    counts.reduce((a, b) => a + b, 0),
  );
  const m = new THREE.Matrix4(),
    q = new THREE.Quaternion(),
    e = new THREE.Euler(),
    p = new THREE.Vector3(),
    s = new THREE.Vector3(),
    col = new THREE.Color();
  let k = 0;
  crowns.forEach((c, ci) => {
    const base = clayColor(c.color);
    for (let i = 0; i < counts[ci]!; i++) {
      // Over the mound, thinning underneath where it meets the ground.
      const y = -0.35 + 1.35 * Math.sqrt(r());
      const a = r() * Math.PI * 2,
        h = Math.sqrt(Math.max(0, 1 - y * y));
      const reach = c.radius * (0.68 + 0.26 * r());
      p.set(
        c.centre[0] + Math.cos(a) * h * reach * c.squash[0],
        c.centre[1] + y * reach * c.squash[1],
        c.centre[2] + Math.sin(a) * h * reach * c.squash[2],
      );
      const size = c.radius * (o.clump[0] + (o.clump[1] - o.clump[0]) * r());
      s.set(
        size * (0.9 + 0.25 * r()),
        size * (0.75 + 0.2 * r()),
        size * (0.9 + 0.25 * r()),
      );
      q.setFromEuler(e.set(r() * 0.6, r() * Math.PI * 2, r() * 0.6));
      mesh.setMatrixAt(k, m.compose(p, q, s));
      col
        .copy(base)
        .offsetHSL((r() - 0.5) * 0.04, (r() - 0.5) * 0.12, (r() - 0.5) * 0.08);
      col.multiplyScalar(0.62 + 0.45 * (0.5 + 0.5 * y));
      mesh.setColorAt(k, col);
      k++;
    }
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.name = name;
  return mesh;
}

export interface Backdrop {
  group: THREE.Group;
  sky: THREE.ShaderMaterial;
  /** Emissive house windows, lit in the evening. */
  windows: THREE.MeshStandardMaterial;
  update(light: Light, t: number, frame: number): void;
  dispose(): void;
}

export function buildBackdrop(lib: ClayLibrary, textureSize: number): Backdrop {
  const group = new THREE.Group();
  group.name = "backdrop";
  const clouds = paintedSky(textureSize * 2);
  const sky = new THREE.ShaderMaterial({
    vertexShader: SKY_VERTEX,
    fragmentShader: SKY_FRAGMENT,
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uZenith: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color() },
      uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
      uSunIntensity: { value: 0 },
      uMoonGlow: { value: 0 },
      uDaylight: { value: 1 },
      uGolden: { value: 0 },
      uCloud: { value: 0 },
      uFog: { value: 0 },
      uTime: { value: 0 },
      uFrame: { value: 0 },
      uClouds: { value: clouds },
    },
  });
  lib.keep(sky);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(60, 48, 24), sky);
  dome.name = "sky";
  dome.frustumCulled = false;
  dome.renderOrder = -10;
  group.add(dome);

  const r = rng(0xbac0);
  // The neighbours' lawn, so nothing shows the void through the fence gaps.
  const beyond = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 30, 2, 2)
      .rotateX(-Math.PI / 2)
      .translate(0, -0.03, -16.4),
    lib.get("far-lawn", {
      color: 0x4f5a2c,
      roughness: 0.95,
      scale: 1,
      relief: 0.03,
      smudge: 0.15,
    }),
  );
  beyond.receiveShadow = true;
  group.add(beyond);
  // Shrubs over the fence.
  const shrubColors = [0x3f5a2c, 0x5d6d30, 0x8a8a34, 0x7a3a26, 0x4c6430, 0x9a7a2c];
  const shrubs: Crown[] = [];
  for (let k = 0; k < 9; k++) {
    const x = -3.3 + k * 0.52 + (r() - 0.5) * 0.2;
    if (x > 1.0) break;
    const rad = 0.38 + r() * 0.32;
    shrubs.push({
      centre: [x, 0.75 + rad * 0.9 + r() * 0.35, -1.75 - r() * 0.6],
      radius: rad,
      squash: [1.2, 1, 0.9],
      color: shrubColors[k % shrubColors.length]!,
    });
  }
  group.add(
    foliage(lib, "shrubs", shrubs, r, {
      clump: [0.2, 0.34],
      perRadius: 70,
      detail: 2,
      scale: 0.18,
      scatter: 0x5a4a10,
    }),
  );
  // Two houses down the street.
  const windows = lib.keep(
    new THREE.MeshStandardMaterial({
      color: 0x2b2a28,
      roughness: 0.3,
      emissive: new THREE.Color(1, 0.66, 0.34),
      emissiveIntensity: 0,
    }),
  );
  const houses: THREE.BufferGeometry[] = [];
  const panes: THREE.BufferGeometry[] = [];
  const roofs: THREE.BufferGeometry[] = [];
  const specs = [
    { x: -2.6, w: 5.2, h: 3.1, ridge: 1.7, color: 0x8f9a88, z: -7.6 },
    { x: 3.4, w: 5.6, h: 3.5, ridge: 1.9, color: 0xc9bea6, z: -8.4 },
  ];
  for (const s of specs) {
    const body = new THREE.BoxGeometry(s.w, s.h, 4, 6, 4, 2);
    const col = clayColor(s.color);
    tint(body, () => col);
    body.translate(s.x, s.h / 2 - 0.1, s.z - 2);
    houses.push(body);
    const gable = new THREE.Shape();
    gable.moveTo(-s.w / 2 - 0.25, 0);
    gable.lineTo(s.w / 2 + 0.25, 0);
    gable.lineTo(0, s.ridge);
    gable.closePath();
    const roof = new THREE.ExtrudeGeometry(gable, { depth: 4.4, bevelEnabled: false });
    roof.translate(s.x, s.h - 0.1, s.z - 4.2);
    roofs.push(roof);
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 2; j++) {
        const p = new THREE.PlaneGeometry(0.62, 0.9);
        p.translate(s.x - s.w / 3 + (i * s.w) / 3, 0.9 + j * 1.35, s.z + 0.02);
        panes.push(p);
      }
  }
  const houseMesh = new THREE.Mesh(
    merge(houses),
    lib.get("houses", {
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.8,
      scale: 0.9,
      relief: 0.04,
      smudge: 0.1,
    }),
  );
  const roofMesh = new THREE.Mesh(
    merge(roofs),
    lib.get("roofs", { color: 0x4a4542, roughness: 0.85, scale: 0.8, relief: 0.05 }),
  );
  const paneMesh = new THREE.Mesh(merge(panes), windows);
  group.add(houseMesh, roofMesh, paneMesh);
  // Autumn trees down the street.
  const treeColors = [0xc0742e, 0xd2a43a, 0x9e3e2a, 0x6f7a34, 0xb85a2c];
  const crowns: Crown[] = [];
  const trunks: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 6; k++) {
    const x = -7 + k * 2.9 + (r() - 0.5) * 1.2,
      z = -10.5 - r() * 3;
    const h = 5.5 + r() * 3;
    trunks.push(
      tube(
        [
          [x, -0.1, z],
          [x + 0.1, h * 0.5, z],
          [x, h * 0.75, z],
        ],
        [0.22, 0.16, 0.1],
        { radial: 8, density: 3, seed: 0xbad0 + k },
      ),
    );
    crowns.push({
      centre: [x, h, z],
      radius: 1.6 + r() * 1.2,
      squash: [1, 1.15, 1],
      color: treeColors[k % treeColors.length]!,
    });
  }
  const trunkMesh = new THREE.Mesh(
    merge(trunks),
    lib.get("far-bark", { color: 0x4e4640, roughness: 0.85, scale: 0.6, relief: 0.06 }),
  );
  group.add(
    foliage(lib, "far-trees", crowns, r, {
      clump: [0.24, 0.4],
      perRadius: 14,
      detail: 2,
      scale: 1.2,
      scatter: 0x8a4a10,
    }),
    trunkMesh,
  );

  const u = sky.uniforms;
  return {
    group,
    sky,
    windows,
    update(light, t, frame) {
      u.uZenith!.value.setRGB(...light.zenith);
      u.uHorizon!.value.setRGB(...light.horizon);
      u.uSunDir!.value.set(...light.sun.direction);
      u.uSunColor!.value.setRGB(...light.sun.color);
      u.uMoonDir!.value.set(...light.moon.direction);
      u.uSunIntensity!.value = light.daylight > 0 ? 1 : 0;
      u.uMoonGlow!.value =
        light.moon.altitudeDeg > -1 ? 1.4 * (1 - light.daylight * 0.85) : 0;
      u.uDaylight!.value = light.daylight;
      u.uGolden!.value = light.golden;
      u.uCloud!.value = light.cloud;
      u.uFog!.value = light.fog;
      u.uTime!.value = t % 100000;
      u.uFrame!.value = frame % 997;
      // Lamplight in rooms down the street: warm, but under the night exposure (about eight) never white.
      windows.emissiveIntensity = 0.2 * light.windowGlow;
    },
    dispose() {
      clouds.dispose();
      group.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
        if (o instanceof THREE.InstancedMesh) o.dispose();
      });
    },
  };
}
