import { describe, expect, it } from "vitest";
import pose from "../scene/data/chrisw-reader.json";
import { groundHeight, READER_SEAT, READER_STANDING_HEIGHT } from "./layout.js";

describe("Christopher's garden scale", () => {
  it("scales the standing source mesh to 6 ft 1 in", () => {
    expect(READER_STANDING_HEIGHT).toBeCloseTo(1.8542, 6);
    expect(1.9171886 * READER_SEAT.scale).toBeCloseTo(1.8542, 6);
  });

  it("places the seated mesh's shoe soles at the soil surface", () => {
    const bytes = Uint8Array.from(atob(pose.position), (c) => c.charCodeAt(0));
    const vertices = new Int16Array(bytes.buffer);
    const [x, y, z] = READER_SEAT.position;
    const { yaw, scale } = READER_SEAT;
    let low = Infinity;
    for (let i = 0; i < vertices.length; i += 3) {
      const u = (vertices[i]! * scale) / 1000;
      const v = (vertices[i + 2]! * scale) / 1000;
      const h = groundHeight(
        x + u * Math.cos(yaw) + v * Math.sin(yaw),
        z - u * Math.sin(yaw) + v * Math.cos(yaw),
      );
      low = Math.min(low, y + (vertices[i + 1]! * scale) / 1000 - h);
    }
    expect(Math.abs(low)).toBeLessThan(0.01);
  });
});
