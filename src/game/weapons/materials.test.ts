import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { getWeaponMaterials } from "./materials";

describe("weapon materials", () => {
  // three.js multiplies `roughness` by the roughness map's green channel. The
  // maps here encode absolute roughness, so any factor below 1 renders the
  // surface glossier than it was authored: the receiver, authored at 0.5 over
  // a 0.52 map, rendered at 0.26 and turned its micro-normal into a speckle of
  // sky reflections. A factor of exactly 1 is the only correct value.
  it("lets every roughness map carry absolute roughness", () => {
    const materials = Object.values(getWeaponMaterials()).filter(
      (m): m is THREE.MeshStandardMaterial => m instanceof THREE.MeshStandardMaterial,
    );
    const mapped = materials.filter((m) => m.roughnessMap !== null);
    expect(mapped.length).toBeGreaterThan(0);
    for (const m of mapped) {
      expect({ name: m.name, roughness: m.roughness }).toEqual({
        name: m.name,
        roughness: 1,
      });
    }
  });
});
