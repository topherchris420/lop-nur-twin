import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { WeaponClass } from "../core/types";
import { getWeapon } from "../weapons/arsenal";

/**
 * The weapon a bot is holding.
 *
 * This is deliberately *not* the viewmodel from `weapons/model.ts`. That model
 * carries 90–180 chamfered solids because it sits 40 cm from the camera; on a
 * soldier thirty metres away every one of those details is sub-pixel, and
 * twenty-four copies of it would cost more than the soldiers themselves. What
 * actually reads at that range is the silhouette: overall length, the
 * magazine hanging below the receiver, an optic breaking the top line, and the
 * dark value against camouflage. So this builds that silhouette from a dozen
 * boxes, per weapon class, and shares one geometry between every bot carrying
 * the same class.
 */

export interface HeldWeaponModel {
  mesh: THREE.Mesh;
  dispose(): void;
}

interface ClassProfile {
  /** Overall length in metres, muzzle to butt. */
  length: number;
  receiverDepth: number;
  magLength: number;
  hasOptic: boolean;
  hasStock: boolean;
  barrelRadius: number;
}

function profileFor(weaponClass: WeaponClass): ClassProfile {
  switch (weaponClass) {
    case "smg":
      return { length: 0.62, receiverDepth: 0.072, magLength: 0.17, hasOptic: true, hasStock: true, barrelRadius: 0.009 };
    case "lmg":
      return { length: 1.02, receiverDepth: 0.095, magLength: 0.15, hasOptic: false, hasStock: true, barrelRadius: 0.013 };
    case "sniper":
    case "marksman":
      return { length: 1.08, receiverDepth: 0.082, magLength: 0.11, hasOptic: true, hasStock: true, barrelRadius: 0.012 };
    case "shotgun":
      return { length: 0.92, receiverDepth: 0.078, magLength: 0, hasOptic: false, hasStock: true, barrelRadius: 0.016 };
    case "pistol":
      return { length: 0.21, receiverDepth: 0.055, magLength: 0.1, hasOptic: false, hasStock: false, barrelRadius: 0.008 };
    default:
      return { length: 0.84, receiverDepth: 0.078, magLength: 0.19, hasOptic: true, hasStock: true, barrelRadius: 0.01 };
  }
}

function box(w: number, h: number, d: number, x: number, y: number, z: number): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(w, h, d);
  geometry.translate(x, y, z);
  return geometry;
}

function buildGeometry(weaponClass: WeaponClass): THREE.BufferGeometry {
  const p = profileFor(weaponClass);
  const parts: THREE.BufferGeometry[] = [];
  // Local frame matches the viewmodel's: muzzle toward −Z, grip at the origin.
  const front = -p.length * 0.62;
  const back = p.length * 0.38;

  // Receiver and handguard as one tapered spine.
  parts.push(box(0.05, p.receiverDepth, p.length * 0.42, 0, 0.03, -p.length * 0.1));
  parts.push(box(0.044, p.receiverDepth * 0.78, p.length * 0.3, 0, 0.028, -p.length * 0.34));

  // Barrel past the handguard.
  const barrel = new THREE.CylinderGeometry(p.barrelRadius, p.barrelRadius, p.length * 0.24, 8);
  barrel.rotateX(Math.PI / 2);
  barrel.translate(0, 0.03, front + p.length * 0.1);
  parts.push(barrel);

  // Magazine: the single strongest silhouette cue that this is a rifle.
  if (p.magLength > 0) {
    parts.push(box(0.028, p.magLength, 0.06, 0, -p.magLength / 2 - 0.01, -0.04));
  }

  // Pistol grip.
  parts.push(box(0.032, 0.1, 0.045, 0, -0.055, 0.03));

  if (p.hasStock) {
    parts.push(box(0.03, 0.04, p.length * 0.2, 0, 0.022, back - p.length * 0.1));
    parts.push(box(0.036, 0.075, 0.03, 0, 0.012, back));
  }
  if (p.hasOptic) {
    parts.push(box(0.03, 0.036, 0.075, 0, p.receiverDepth * 0.5 + 0.028, -p.length * 0.08));
  }

  const merged = mergeGeometries(parts, false)!;
  for (const part of parts) part.dispose();
  merged.computeVertexNormals();
  return merged;
}

const geometryCache = new Map<WeaponClass, { geometry: THREE.BufferGeometry; refs: number }>();
let sharedMaterial: THREE.MeshStandardMaterial | null = null;

function getMaterial(): THREE.MeshStandardMaterial {
  if (!sharedMaterial) {
    sharedMaterial = new THREE.MeshStandardMaterial({
      name: "held-weapon-metal",
      color: 0x1d1e21,
      metalness: 0.85,
      roughness: 0.62,
      envMapIntensity: 0.5,
    });
  }
  return sharedMaterial;
}

/** Build (or share) the held weapon for a given weapon id. */
export function buildHeldWeapon(weaponId: string): HeldWeaponModel {
  const weaponClass = getWeapon(weaponId).weaponClass;
  let cached = geometryCache.get(weaponClass);
  if (!cached) {
    cached = { geometry: buildGeometry(weaponClass), refs: 0 };
    geometryCache.set(weaponClass, cached);
  }
  cached.refs += 1;

  const mesh = new THREE.Mesh(cached.geometry, getMaterial());
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  mesh.userData["noCollide"] = true;
  // Seat the weapon in the right hand: the rig's `weapon` bone already sits at
  // the grip, so the model only needs the small rotation that puts the muzzle
  // forward rather than along the forearm.
  mesh.rotation.set(0.18, 0, 0);
  mesh.position.set(0.02, -0.02, -0.06);

  return {
    mesh,
    dispose() {
      const entry = geometryCache.get(weaponClass);
      if (!entry) return;
      entry.refs -= 1;
      if (entry.refs <= 0) {
        entry.geometry.dispose();
        geometryCache.delete(weaponClass);
      }
    },
  };
}

export function disposeHeldWeaponCache(): void {
  for (const entry of geometryCache.values()) entry.geometry.dispose();
  geometryCache.clear();
  sharedMaterial?.dispose();
  sharedMaterial = null;
}
