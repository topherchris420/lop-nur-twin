import * as THREE from "three";
import { mulberry32, SITE_SEED } from "@/lib/noise";

/** Canvas space on the apron is in metres. The map contains only the paint and
 * rubber, so the concrete's existing roughness, joints and aggregate show through. */
export function makeStandMarkings(width: number, depth: number, pixels: number) {
  const canvas = document.createElement("canvas");
  canvas.width = pixels;
  canvas.height = Math.round((pixels * depth) / width);
  const c = canvas.getContext("2d")!;
  const scale = pixels / width;
  c.scale(scale, scale);
  const random = mulberry32(SITE_SEED + 1840);
  const roadY = depth * 0.17;
  c.lineCap = "round";

  // Service traffic polishes a pair of broad, irregular lanes. Individual
  // tyre paths peel off the lane and finish at the painted stop bars.
  for (let i = 0; i < 84; i++) {
    const start = random() * width * 0.55;
    const y = roadY + (random() - 0.5) * 5.2;
    c.strokeStyle = `rgba(46,40,36,${0.015 + random() * 0.034})`;
    c.lineWidth = 0.12 + random() * 0.35;
    c.beginPath();
    c.moveTo(start, y);
    c.bezierCurveTo(start + 23, y + 0.23, width * 0.83, y - 0.39, width, y + 0.3);
    c.stroke();
  }
  c.lineCap = "butt";
  c.fillStyle = "#bc924bcc";
  c.fillRect(0, roadY - 0.12, width, 0.24);
  for (const [index, fraction] of [0.17, 0.39, 0.64, 0.85].entries()) {
    const x = width * fraction;
    const stopY = depth * (index % 2 ? 0.72 : 0.66);
    for (let pass = 0; pass < 22; pass++) {
      const drift = (random() - 0.5) * 1.4;
      const wheel = pass % 2 ? 1.15 : -1.15;
      c.strokeStyle = `rgba(38,34,32,${0.034 + random() * 0.033})`;
      c.lineWidth = 0.22 + random() * 0.18;
      c.beginPath();
      c.moveTo(x - 25, roadY + wheel + drift);
      c.quadraticCurveTo(x + wheel + drift, roadY + wheel, x + wheel + drift, roadY + 19);
      c.lineTo(x + wheel + drift, stopY - random() * 5);
      c.stroke();
    }
    c.strokeStyle = "#ba914bc9";
    c.lineWidth = 0.24;
    c.beginPath();
    c.moveTo(x - 22, roadY);
    c.quadraticCurveTo(x, roadY, x, roadY + 20);
    c.lineTo(x, stopY);
    c.stroke();
    c.fillStyle = "#dacda9ce";
    c.fillRect(x - 2.8, stopY, 5.6, 0.34);
    // Hatch the service strip beside the stand, inside a painted box.
    c.save();
    c.translate(x + 7, stopY - 6);
    c.strokeStyle = "#c6b898aa";
    c.lineWidth = 0.17;
    c.strokeRect(0, 0, 7, 4);
    c.beginPath();
    c.rect(0, 0, 7, 4);
    c.clip();
    for (let j = -4; j < 8; j += 1.32) {
      c.beginPath();
      c.moveTo(j, 0);
      c.lineTo(j + 4, 4);
      c.stroke();
    }
    c.restore();
  }

  // Chips remove pigment instead of drawing sand-coloured dots over the slab.
  c.globalCompositeOperation = "destination-out";
  c.fillStyle = "#000";
  for (let i = 0; i < 9000; i++) {
    c.globalAlpha = 0.25 + random() * 0.65;
    c.fillRect(
      random() * width,
      random() * depth,
      0.1 + random() * 1.6,
      0.09 + random() * 0.24,
    );
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 16;
  return texture;
}

/** One coating atlas per hall. Each leaf has its own paint batch, top-down
 * runoff, boot-height wear, and a continuous painted identifier across it. */
export function makeDoorCoating(number: string, pixels: number) {
  const canvas = document.createElement("canvas");
  canvas.width = pixels;
  canvas.height = pixels / 4;
  const c = canvas.getContext("2d")!;
  c.scale(pixels / 1024, pixels / 1024);
  const random = mulberry32(SITE_SEED + 1824 + Number(number));
  const paints = ["#69766e", "#758078", "#65746e", "#747c71", "#707d75", "#697871"];
  paints.forEach((paint, i) => {
    c.fillStyle = paint;
    c.fillRect((1024 * i) / 6, 0, 172, 256);
  });
  c.fillStyle = "#b5a06b";
  c.fillRect(0, 191, 1024, 4);
  c.fillStyle = "#424b47";
  c.fillRect(0, 227, 1024, 29);
  c.fillStyle = "#c9c6af";
  c.font = "bold 96px sans-serif";
  c.fillText(number, 756, 175);
  // Narrow breaks through the numerals read as stencil bridges.
  c.fillStyle = paints[4]!;
  c.fillRect(788, 102, 3, 77);
  c.fillStyle = paints[5]!;
  c.fillRect(844, 102, 3, 77);
  for (let i = 0; i < 190; i++) {
    const x = random() * 1024;
    const height = 8 + random() ** 2 * 140;
    const stain = c.createLinearGradient(0, 0, 0, height);
    stain.addColorStop(0, "rgba(40,36,28,.26)");
    stain.addColorStop(1, "rgba(40,36,28,0)");
    c.fillStyle = stain;
    c.fillRect(x, 0, 1 + random() ** 2 * 6, height);
  }
  const dust = c.createLinearGradient(0, 189, 0, 256);
  dust.addColorStop(0, "rgba(168,151,122,0)");
  dust.addColorStop(1, "rgba(168,151,122,.57)");
  c.fillStyle = dust;
  c.fillRect(0, 189, 1024, 67);
  c.fillStyle = "#483e31";
  for (let i = 0; i < 2100; i++) {
    c.globalAlpha = 0.15 + random() * 0.36;
    c.fillRect(
      random() * 1024,
      256 * (1 - random() ** 2),
      0.5 + random() * 3,
      0.5 + random() * 1.3,
    );
  }
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  return map;
}
