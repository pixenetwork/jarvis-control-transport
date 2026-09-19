// Jarvis receipt-journal sanitization validator.
//
// This module is the enforcement point for the public receipt journal's
// sanitization contract. It is intentionally zero-dependency and side-effect
// free so it can run anywhere (local, review, or an approved direct execution
// path) without pulling in a package tree.
//
// Contract (see receipts/README.md and receipts/schema/receipt-journal-entry.schema.json):
//   * A journal entry may contain ONLY the allowed fields:
//       schemaVersion, phase, nonce, rawHashRef, ttlSeconds, outcome.
//   * Every field is strictly format-checked (enum / hex / bounded integer).
//   * As defense-in-depth, the ENTIRE input (all keys and all string values,
//     recursively) is scanned for anything resembling commands, credentials,
//     tokens, environment data, Host Ops internals, or private artifacts.
//     Any hit is a hard rejection.
//
// The validator NEVER trusts the caller: unknown keys, wrong types, and
// forbidden content all fail closed with an explicit list of violations.

export const SCHEMA_VERSION = 1;

// The only keys permitted at the top level of a receipt-journal entry.
export const ALLOWED_KEYS = Object.freeze([
  "schemaVersion",
  "phase",
  "nonce",
  "rawHashRef",
  "ttlSeconds",
  "outcome",
]);

export const ALLOWED_PHASES = Object.freeze([
  "precheck",
  "dispatch",
  "execution-postcheck",
  "reconcile",
  "expiry",
]);

export const ALLOWED_OUTCOMES = Object.freeze([
  "success",
  "failure",
  "expired",
  "rejected",
  "timeout",
]);

export const NONCE_PATTERN = /^[0-9a-f]{32}$/;
export const RAW_HASH_REF_PATTERN = /^sha256:[0-9a-f]{64}$/;
export const TTL_MIN_SECONDS = 1;
export const TTL_MAX_SECONDS = 86400;

// Forbidden-content signatures. These are a secondary, defense-in-depth guard:
// even though the allowed fields are so tightly format-constrained that private
// data cannot fit inside a valid one, we still deep-scan the raw input so that
// any attempt to smuggle sensitive material (including via unknown keys) is
// caught and named explicitly. Each rule has a category so violations are
// actionable.
export const FORBIDDEN_SIGNATURES = Object.freeze([
  // Credentials / tokens / secret material.
  { category: "credential-or-token", pattern: /\b(pass(word|wd)?|secret|token|credential|api[-_ ]?key|private[-_ ]?key|access[-_ ]?key)\b/i },
  { category: "credential-or-token", pattern: /\b(bearer|authorization)\b/i },
  { category: "credential-or-token", pattern: /\bghp_[A-Za-z0-9]{10,}\b/ },
  { category: "credential-or-token", pattern: /\bgithub_pat_[A-Za-z0-9_]{10,}\b/ },
  { category: "credential-or-token", pattern: /\bx-access-token\b/i },
  { category: "credential-or-token", pattern: /\bAKIA[0-9A-Z]{12,}\b/ },
  { category: "credential-or-token", pattern: /-----BEGIN[ A-Z]*PRIVATE KEY-----/ },
  // Shell / command / execution indicators.
  { category: "command-or-execution", pattern: /\b(cmd|powershell|pwsh|bash|sh|invoke-expression|invoke-webrequest|iex)\b/i },
  { category: "command-or-execution", pattern: /\b(curl|wget|rm|del|rmdir|format|shutdown|reg|schtasks|net user)\b/i },
  { category: "command-or-execution", pattern: /[;&|`]|\$\(|&&|\|\|/ },
  { category: "command-or-execution", pattern: /[A-Za-z]:\\|\\\\|\/(usr|bin|etc|home|root|var)\//i },
  // Environment / host data.
  { category: "environment-data", pattern: /\b(env|environment|dotenv)\b/i },
  { category: "environment-data", pattern: /\.env\b/i },
  { category: "environment-data", pattern: /%[A-Za-z_][A-Za-z0-9_]*%|\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/ },
  // Host Ops internals / envelope fields that must never surface publicly.
  { category: "host-ops-internal", pattern: /\b(hostops|host[-_. ]?ops|host\.system|workingdirectory|originworker|targethost|taskid|expectedmainsha|receiptpolicy)\b/i },
  { category: "host-ops-internal", pattern: /\bDESKTOP-[A-Z0-9]+\b/i },
  // Private source / artifact references.
  { category: "private-artifact", pattern: /\bai-orchestrator\b/i },
  { category: "private-artifact", pattern: /\b[A-Za-z0-9_.-]+\.(mjs|js|ts|ps1|bat|cmd|sh|env|pem|key|sql)\b/i },
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

function hasSafeOwnDataProperties(value) {
  try {
    if (Object.getOwnPropertySymbols(value).length) return false;
    for (const key of Object.getOwnPropertyNames(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.hasOwn(descriptor, "value")) return false;
    }
    return true;
  } catch {
    return false;
  }
}

// Recursively collect every string that appears anywhere in the input, both
// object keys and values, so the forbidden-content scan cannot be evaded by
// nesting or by hiding data in a key name.
function collectStrings(value, out) {
  if (typeof value === "string") {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out);
  } else if (isPlainObject(value)) {
    for (const [key, val] of Object.entries(value)) {
      out.push(key);
      collectStrings(val, out);
    }
  }
}

function scanForbidden(input) {
  const strings = [];
  collectStrings(input, strings);
  const violations = [];
  for (const text of strings) {
    for (const rule of FORBIDDEN_SIGNATURES) {
      if (rule.pattern.test(text)) {
        violations.push({
          category: rule.category,
          message: `forbidden ${rule.category} content detected`,
        });
      }
    }
  }
  return violations;
}

/**
 * Validate a single receipt-journal entry against the sanitization contract.
 *
 * Fails closed: any structural problem OR any forbidden-content hit makes the
 * entry invalid. Returns a structured result rather than throwing so callers
 * can log/redact deterministically.
 *
 * @param {unknown} input Parsed JSON value to validate.
 * @returns {{ valid: boolean, errors: string[], entry: object|null }}
 */
export function validateReceipt(input) {
  const errors = [];

  if (!isPlainObject(input)) {
    return { valid: false, errors: ["entry must be a plain JSON object"], entry: null };
  }
  if (!hasSafeOwnDataProperties(input)) {
    return { valid: false, errors: ["entry must contain only own JSON data properties"], entry: null };
  }

  // 1. Structural allow-list: reject any key that is not explicitly permitted.
  for (const key of Object.keys(input)) {
    if (!ALLOWED_KEYS.includes(key)) {
      errors.push(`unexpected field '${key}' is not part of the sanitized receipt contract`);
    }
  }

  // 2. Presence + per-field format checks.
  if (input.schemaVersion !== SCHEMA_VERSION) {
    errors.push(`schemaVersion must be the integer ${SCHEMA_VERSION}`);
  }
  if (!ALLOWED_PHASES.includes(input.phase)) {
    errors.push(`phase must be one of: ${ALLOWED_PHASES.join(", ")}`);
  }
  if (typeof input.nonce !== "string" || !NONCE_PATTERN.test(input.nonce)) {
    errors.push("nonce must be exactly 32 lowercase hex characters");
  }
  if (typeof input.rawHashRef !== "string" || !RAW_HASH_REF_PATTERN.test(input.rawHashRef)) {
    errors.push("rawHashRef must match 'sha256:' followed by 64 lowercase hex characters");
  }
  if (
    typeof input.ttlSeconds !== "number" ||
    !Number.isInteger(input.ttlSeconds) ||
    input.ttlSeconds < TTL_MIN_SECONDS ||
    input.ttlSeconds > TTL_MAX_SECONDS
  ) {
    errors.push(`ttlSeconds must be an integer between ${TTL_MIN_SECONDS} and ${TTL_MAX_SECONDS}`);
  }
  if (!ALLOWED_OUTCOMES.includes(input.outcome)) {
    errors.push(`outcome must be one of: ${ALLOWED_OUTCOMES.join(", ")}`);
  }

  // 3. Defense-in-depth forbidden-content scan over the whole raw input.
  // Hostile nested objects must fail closed rather than throwing from getters,
  // proxies, or cyclic/non-JSON structures.
  try {
    for (const violation of scanForbidden(input)) {
      errors.push(violation.message);
    }
  } catch {
    errors.push("entry contains unsafe or non-JSON nested content");
  }

  const valid = errors.length === 0;
  return {
    valid,
    errors,
    // Only hand back a normalized entry when it fully passed; never echo
    // untrusted/rejected content back to a caller.
    entry: valid
      ? {
          schemaVersion: input.schemaVersion,
          phase: input.phase,
          nonce: input.nonce,
          rawHashRef: input.rawHashRef,
          ttlSeconds: input.ttlSeconds,
          outcome: input.outcome,
        }
      : null,
  };
}

/**
 * Validate a whole journal: an array of entries.
 * @param {unknown} entries
 * @returns {{ valid: boolean, results: Array<{index:number, valid:boolean, errors:string[]}> }}
 */
export function validateJournal(entries) {
  if (!Array.isArray(entries)) {
    return { valid: false, results: [{ index: -1, valid: false, errors: ["journal must be a JSON array of entries"] }] };
  }
  const results = entries.map((entry, index) => {
    const { valid, errors } = validateReceipt(entry);
    return { index, valid, errors };
  });
  return { valid: results.every((r) => r.valid), results };
}
