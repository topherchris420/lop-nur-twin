import * as THREE from "three";

const SIZE = 32;
const LEVELS = Math.log2(SIZE) + 1;
const sky = new THREE.Color(0.12, 0.21, 0.32);
const horizon = new THREE.Color(0.49, 0.49, 0.46);
const ground = new THREE.Color(0.26, 0.2, 0.135);

/** An analytic reflection of the sky, dust horizon and ground. Each mip
 * broadens the horizon for rougher materials. The directional light supplies
 * the sun separately. Building this small filtered cube has no GPU draw or
 * program link, so the normal scene warmup owns the first shader compilation. */
export function basinReflections() {
  const color = new THREE.Color();
  const faces = Array.from({ length: 6 }, (_, face) => {
    const mipmaps = Array.from({ length: LEVELS }, (_, level) => {
      const width = SIZE >> level;
      const data = new Uint8Array(width * width * 4);
      const roughness = 1 - Math.sqrt(1 - level / (LEVELS - 1));
      const spread = 0.018 + roughness * roughness * 1.2;
      for (let y = 0; y < width; y++)
        for (let x = 0; x < width; x++) {
          const s = (2 * (x + 0.5)) / width - 1,
            t = (2 * (y + 0.5)) / width - 1;
          const up = (face === 2 ? 1 : face === 3 ? -1 : -t) / Math.hypot(s, t, 1);
          const above = THREE.MathUtils.smoothstep(up, -spread, spread);
          color.lerpColors(ground, sky, above);
          // Smooth surfaces reflect a distinct luminous band. As roughness
          // spreads its energy across the lobe, its peak falls.
          const widthY = 0.21 + 0.65 * roughness;
          color.lerp(horizon, Math.exp(-Math.abs(up) / widthY) * (1 - 0.65 * roughness));
          const i = 4 * (y * width + x);
          data[i] = Math.round(255 * color.r);
          data[i + 1] = Math.round(255 * color.g);
          data[i + 2] = Math.round(255 * color.b);
          data[i + 3] = 255;
        }
      return { width, height: width, data };
    });
    return { width: SIZE, height: SIZE, mipmaps };
  });
  // Three's packed cube container accepts uncompressed RGBA mip chains.
  // Supplying a filtered chain keeps it out of the renderer's PMREM converter.
  const cube = new THREE.CompressedCubeTexture(faces);
  cube.colorSpace = THREE.LinearSRGBColorSpace;
  cube.isPMREMTexture = true;
  cube.minFilter = THREE.LinearMipmapLinearFilter;
  cube.magFilter = THREE.LinearFilter;
  cube.needsUpdate = true;
  return cube;
}
