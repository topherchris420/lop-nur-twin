import * as THREE from "three";
import { seededNoise2D } from "../lib/noise";
import { SUN } from "./furniture";

const cloudNoise = seededNoise2D(0x62736b79);
const sunlight = new THREE.Vector3(SUN.offset.x, SUN.offset.y, SUN.offset.z).normalize();
const horizon = { clear: [195, 209, 215], storm: [132, 145, 151] } as const;

/** A painted-in-light local sky probe. The panorama and its glossy reflections
 * share the same cloud shapes and the simulation's direction of sunlight. */
export function citySky(storm: boolean): THREE.DataTexture {
  const width = 512,
    height = 256;
  const data = new Uint8Array(width * height * 4);
  const rim = storm ? horizon.storm : horizon.clear;
  const top = storm ? [79, 92, 111] : [72, 120, 165];
  const ground = storm ? [69, 70, 66] : [107, 99, 80];
  const cloud = storm ? [155, 164, 170] : [242, 238, 224];
  const azimuths = Array.from({ length: width }, (_, x) => {
    const a = ((x + 0.5) / width - 0.5) * Math.PI * 2;
    return [Math.cos(a), Math.sin(a)] as const;
  });
  for (let y = 0; y < height; y++) {
    const latitude = ((y + 0.5) / height - 0.5) * Math.PI;
    const up = Math.sin(latitude),
      horizontal = Math.cos(latitude);
    const gradient = Math.pow(Math.abs(up), up > 0 ? 0.55 : 0.24);
    for (let x = 0; x < width; x++) {
      const [east, south] = azimuths[x]!;
      const dx = east * horizontal,
        dz = south * horizontal;
      let cover = 0,
        shading = 1,
        glow = 0;
      if (up > 0) {
        // Looking through a horizontal cloud layer foreshortens its shapes
        // at the horizon. Haze there also hides detail below a texel.
        const scale = 1 / (up + 0.075);
        const u = dx * scale,
          v = dz * scale;
        const broad = cloudNoise(u * 1.1, v * 1.65);
        const density =
          broad * 0.56 +
          0.28 * cloudNoise(u * 3.1, v * 4.4) +
          0.12 * cloudNoise(u * 8.4, v * 10.8) +
          0.04 * cloudNoise(u * 21, v * 27);
        cover =
          THREE.MathUtils.smoothstep(density, storm ? -0.54 : 0.12, storm ? 0.15 : 0.53) *
          THREE.MathUtils.smoothstep(up, 0.012, 0.14);
        const towardSun = Math.max(
          0,
          dx * sunlight.x + up * sunlight.y + dz * sunlight.z,
        );
        shading = (storm ? 0.92 : 0.99) - Math.max(0, density) * (storm ? 0.32 : 0.16);
        glow =
          Math.pow(towardSun, 12) * (storm ? 7 : 37) +
          Math.pow(towardSun, 450) * (storm ? 4 : 64);
      }
      const i = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        const clear = rim[c]! + ((up < 0 ? ground : top)[c]! - rim[c]!) * gradient + glow;
        data[i + c] = Math.round(
          Math.min(255, clear + (cloud[c]! * shading - clear) * cover),
        );
      }
      data[i + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, width, height);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

export const SKY_HORIZON = { clear: "#c3d1d7", storm: "#849197" } as const;
