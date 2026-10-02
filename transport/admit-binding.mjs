// Fail-closed admission for a public transport candidate.
//
// This module does not mint actor approval, execution authority, validation
// authority, reviewer quorum, receipt authority, or Host Ops authority.
// It only compares a candidate with caller-supplied expectations and the
// sanitized receipt primitives (nonce shape, TTL bounds). Anything missing,
// ambiguous, or mismatched is rejected.

import {
  NONCE_PATTERN,
  TTL_MAX_SECONDS,
  TTL_MIN_SECONDS,
} from "../receipts/validate-receipt.mjs";

export const CANONICAL_CONTROL_REF = "refs/heads/jarvis-remote-control-v2";
export const HEAD_PATTERN = /^[0-9a-f]{40}$/;
export const ACTOR_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const MAX_SEEN_NONCES = 4096;
export const ISSUED_AT_MIN = 1577836800;
export const ISSUED_AT_MAX = 4102444800;

const ALLOWED_KEYS = Object.freeze([
  "controlRef",
  "observedHead",
  "expectedHead",
  "actor",
  "expectedActor",
  "issuedAt",
  "ttlSeconds",
  "now",
  "nonce",
  "seenNonces",
]);

function isPlainObject(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function snapshotSafeOwnDataProperties(value) {
  try {
    if (Object.getOwnPropertySymbols(value).length) return null;
    const snapshot = Object.create(null);
    const keys = Object.getOwnPropertyNames(value);
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.hasOwn(descriptor, "value")) return null;
      snapshot[key] = descriptor.value;
    }
    return { snapshot, keys };
  } catch {
    return null;
  }
}

function isWholeTime(value) {
  return Number.isSafeInteger(value) && value >= ISSUED_AT_MIN && value <= ISSUED_AT_MAX;
}

/**
 * Admit a transport candidate only when control ref, exact head, actor,
 * expiry window, and nonce replay set all match.
 *
 * @param {unknown} input
 * @returns {{ valid: boolean, errors: string[], binding: object|null }}
 */
export function admitTransportBinding(input) {
  if (!isPlainObject(input)) {
    return { valid: false, errors: ["malformed"], binding: null };
  }
  const safe = snapshotSafeOwnDataProperties(input);
  if (!safe) {
    return { valid: false, errors: ["malformed"], binding: null };
  }
  const candidate = safe.snapshot;
  for (const key of safe.keys) {
    if (!ALLOWED_KEYS.includes(key)) {
      return { valid: false, errors: ["malformed"], binding: null };
    }
  }
  for (const key of ALLOWED_KEYS) {
    if (!Object.hasOwn(candidate, key)) {
      return { valid: false, errors: ["malformed"], binding: null };
    }
  }

  const errors = [];

  if (candidate.controlRef !== CANONICAL_CONTROL_REF) {
    errors.push("control-ref");
  }

  const headsWellFormed =
    typeof candidate.observedHead === "string" &&
    HEAD_PATTERN.test(candidate.observedHead) &&
    typeof candidate.expectedHead === "string" &&
    HEAD_PATTERN.test(candidate.expectedHead);
  if (!headsWellFormed) {
    errors.push("malformed");
  } else if (candidate.observedHead !== candidate.expectedHead) {
    errors.push("exact-head");
  }

  const actorsWellFormed =
    typeof candidate.actor === "string" &&
    ACTOR_PATTERN.test(candidate.actor) &&
    typeof candidate.expectedActor === "string" &&
    ACTOR_PATTERN.test(candidate.expectedActor);
  if (!actorsWellFormed) {
    errors.push("malformed");
  } else if (candidate.actor !== candidate.expectedActor) {
    errors.push("actor");
  }

  const ttlWellFormed =
    typeof candidate.ttlSeconds === "number" &&
    Number.isInteger(candidate.ttlSeconds) &&
    candidate.ttlSeconds >= TTL_MIN_SECONDS &&
    candidate.ttlSeconds <= TTL_MAX_SECONDS;
  const timesWellFormed = isWholeTime(candidate.issuedAt) && isWholeTime(candidate.now);
  if (!ttlWellFormed || !timesWellFormed) {
    errors.push("malformed");
  } else {
    const expiresAt = candidate.issuedAt + candidate.ttlSeconds;
    if (!Number.isSafeInteger(expiresAt) || candidate.now < candidate.issuedAt || candidate.now >= expiresAt) {
      errors.push("expiry");
    }
  }

  const nonceWellFormed = typeof candidate.nonce === "string" && NONCE_PATTERN.test(candidate.nonce);
  const seen = candidate.seenNonces;
  let seenWellFormed = Array.isArray(seen) && seen.length <= MAX_SEEN_NONCES;
  if (seenWellFormed) {
    for (const prior of seen) {
      if (typeof prior !== "string" || !NONCE_PATTERN.test(prior)) {
        seenWellFormed = false;
        break;
      }
    }
  }
  if (!nonceWellFormed || !seenWellFormed) {
    errors.push("malformed");
  } else if (seen.includes(candidate.nonce)) {
    errors.push("replay");
  }

  const valid = errors.length === 0;
  return {
    valid,
    errors,
    binding: valid
      ? {
          controlRef: candidate.controlRef,
          observedHead: candidate.observedHead,
          actor: candidate.actor,
          nonce: candidate.nonce,
          issuedAt: candidate.issuedAt,
          ttlSeconds: candidate.ttlSeconds,
          expiresAt: candidate.issuedAt + candidate.ttlSeconds,
        }
      : null,
  };
}