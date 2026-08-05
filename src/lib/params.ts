/**
 * Validated URL query parameters.
 *
 * Every parameter this application reads is attacker-controlled: a link can
 * be handed to anyone, and the app is a public demo with no login. Nothing
 * here is privileged — the parameters pick a quality tier or place a camera —
 * but unchecked numbers still reach a renderer, a physics world and a spawn
 * placer, where `?quality=1e9`, `?at=1e308,0` or `?near=-0` turn into hangs,
 * NaN-poisoned matrices and a black screen.
 *
 * So all parsing goes through this module, and it obeys three rules:
 *
 * 1. **Reject before clamp.** A malformed value falls back to the default
 *    rather than being coerced (`Number("")` is 0, which is exactly the sort
 *    of accidental "valid" input that places a player at the origin).
 * 2. **Bound every number.** Finite, in range, and clamped to limits derived
 *    from the model itself where one exists.
 * 3. **Never throw.** A bad parameter must degrade to the default, because
 *    the alternative is a blank page for a reviewer who mistyped a link.
 *
 * Developer and capture parameters (`?near=`, `?stage=`, `?ao=`) keep working
 * exactly as documented in AGENTS.md — they are bounded, not removed.
 */

import { SITE_SIZE } from "./layout";

/** Longest raw parameter value considered at all. */
const MAX_VALUE_LENGTH = 64;

/** Ids are model slugs: lowercase, digits, hyphens. */
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

function rawParam(name: string): string | null {
  if (typeof window === "undefined") return null;
  let value: string | null = null;
  try {
    value = new URLSearchParams(window.location.search).get(name);
  } catch {
    return null;
  }
  if (value === null) return null;
  if (value.length > MAX_VALUE_LENGTH) return null;
  return value;
}

/** A finite number, or null. Empty and whitespace-only strings are *not* zero. */
function finiteNumber(raw: string | null): number | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * `?flag=1` / `?flag=true` — anything else, including a missing parameter, is
 * false. Deliberately strict so a typo cannot silently enable a mode.
 */
export function readFlag(name: string): boolean {
  const raw = rawParam(name);
  return raw === "1" || raw === "true";
}

/** An integer parameter, clamped into `[min, max]`. Non-integers are rejected. */
export function readIntParam(
  name: string,
  min: number,
  max: number,
): number | null {
  const value = finiteNumber(rawParam(name));
  if (value === null || !Number.isInteger(value)) return null;
  return clamp(value, min, max);
}

/** A floating-point parameter, clamped into `[min, max]`. */
export function readFloatParam(
  name: string,
  min: number,
  max: number,
): number | null {
  const value = finiteNumber(rawParam(name));
  if (value === null) return null;
  return clamp(value, min, max);
}

/** One of a fixed set of strings, or null. */
export function readEnumParam<T extends string>(
  name: string,
  allowed: readonly T[],
): T | null {
  const raw = rawParam(name);
  if (raw === null) return null;
  return (allowed as readonly string[]).includes(raw) ? (raw as T) : null;
}

/** A model id (structure, source, zone). Shape-checked, existence is the caller's job. */
export function readIdParam(name: string): string | null {
  const raw = rawParam(name);
  if (raw === null) return null;
  return ID_PATTERN.test(raw) ? raw : null;
}

/**
 * `?at=<x>,<z>` in local metres, clamped to the modeled site. Both components
 * must be present and finite; `?at=`, `?at=1`, `?at=,` and `?at=1,foo` are all
 * rejected rather than being read as the origin.
 */
export function readSitePointParam(name: string): [number, number] | null {
  const raw = rawParam(name);
  if (raw === null) return null;
  const parts = raw.split(",");
  if (parts.length !== 2) return null;
  const x = finiteNumber(parts[0] ?? null);
  const z = finiteNumber(parts[1] ?? null);
  if (x === null || z === null) return null;
  const limit = SITE_SIZE / 2;
  return [clamp(x, -limit, limit), clamp(z, -limit, limit)];
}

/**
 * `?look=<deg>` as a heading, wrapped into `[0, 360)`. Returns null when the
 * parameter is absent or malformed so callers keep their own default heading.
 */
export function readHeadingParam(name: string): number | null {
  const value = finiteNumber(rawParam(name));
  if (value === null) return null;
  return ((value % 360) + 360) % 360;
}
