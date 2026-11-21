import { useEffect, useRef } from "react";
import { Color } from "three";
import { lakebedColor } from "@/gfx/lakebed";
import { LENS_PALETTE } from "@/lib/evidenceLens";
import { RUNWAYS, SITE_SIZE, STRIPS } from "@/lib/layout";
import { useSubjectDrawState, useSubjectLensClassification } from "@/lib/sceneVisibility";
import { rawHeight } from "@/lib/terrain";

/** A 2D plate for browsers that cannot draw the 3D scene. Surface pigment
 * and relief come from the same fields as the mesh. Work is split into rows
 * so a phone can follow either evidence link while the illustration paints. */
export function LakebedPlate() {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawState = useSubjectDrawState();
  const lensOf = useSubjectLensClassification();

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    let frame = 0;
    function render(maxSide: number) {
      if (!canvas || !ctx) return;
      cancelAnimationFrame(frame);
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const scale = Math.min(1.5, maxSide / Math.max(rect.width, rect.height));
      const w = Math.max(1, Math.round(rect.width * scale));
      const h = Math.max(1, Math.round(rect.height * scale));
      const portrait = rect.width < 700;
      const px =
        Math.min(w * (portrait ? 0.91 : 0.62), h * (portrait ? 0.51 : 0.87)) / SITE_SIZE;
      const cx = w * (portrait ? 0.5 : 0.69),
        cy = h * (portrait ? 0.29 : 0.49);
      const pixels = ctx.createImageData(w, h);
      const previousRow = new Float32Array(w);
      const color = new Color();
      let row = 0;
      function paint() {
        if (!canvas || !ctx) return;
        const deadline = performance.now() + 7;
        do {
          const z = (row - cy) / px;
          let west = rawHeight((-1 - cx) / px, z);
          for (let x = 0; x < w; x++) {
            const east = (x - cx) / px;
            const height = rawHeight(east, z);
            const north = row ? previousRow[x]! : height;
            // Raking light brings out small relief in this overhead illustration.
            const light =
              1 + Math.max(-0.28, Math.min(0.28, (west + north - 2 * height) * px * 19));
            lakebedColor(color, east, z, height, 1)
              .multiplyScalar(light)
              .convertLinearToSRGB();
            const i = 4 * (row * w + x);
            pixels.data[i] = 255 * color.r;
            pixels.data[i + 1] = 255 * color.g;
            pixels.data[i + 2] = 255 * color.b;
            pixels.data[i + 3] = 255;
            previousRow[x] = height;
            west = height;
          }
          row++;
        } while (row < h && performance.now() < deadline);
        if (row < h) {
          frame = requestAnimationFrame(paint);
          return;
        }
        canvas.width = w;
        canvas.height = h;
        ctx.putImageData(pixels, 0, 0);
        for (const segment of [...STRIPS, ...RUNWAYS]) {
          const state = drawState(segment.id);
          if (state === "hidden") continue;
          const lens = lensOf(segment.id);
          const style = lens ? LENS_PALETTE[lens] : undefined;
          ctx.setLineDash(state === "ghost" ? [2, 4] : [...(style?.dash ?? [])]);
          ctx.strokeStyle =
            state === "ghost"
              ? "#a9bfd3"
              : (style?.color ?? (segment.kind === "runway" ? "#ece1c9" : "#857767"));
          ctx.lineWidth = state === "ghost" ? 1 : Math.max(1, segment.width * px);
          ctx.beginPath();
          ctx.moveTo(cx + segment.from[0] * px, cy + segment.from[1] * px);
          ctx.lineTo(cx + segment.to[0] * px, cy + segment.to[1] * px);
          ctx.stroke();
        }
        // Give even a slow phone a complete, legible plate before refining it.
        if (maxSide === 256 && Math.max(rect.width, rect.height) > 256)
          frame = requestAnimationFrame(() => render(1100));
      }
      frame = requestAnimationFrame(paint);
    }
    const observer = new ResizeObserver(() => render(256));
    observer.observe(canvas);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [drawState, lensOf]);

  return <canvas ref={ref} aria-hidden="true" className="lakebed-plate" />;
}
