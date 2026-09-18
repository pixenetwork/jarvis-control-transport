import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { validateReceipt, validateJournal } from "../validate-receipt.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoReceipts = join(here, "..");

// A minimal, clearly-fake, fully-sanitized entry used as the happy-path base.
function baseEntry() {
  return {
    schemaVersion: 1,
    phase: "execution-postcheck",
    nonce: "0123456789abcdef0123456789abcdef",
    rawHashRef: "sha256:" + "a".repeat(64),
    ttlSeconds: 600,
    outcome: "success",
  };
}

test("valid sanitized entry passes and is normalized", () => {
  const result = validateReceipt(baseEntry());
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.entry, baseEntry());
});

test("shipped example entry conforms to the contract", () => {
  const raw = readFileSync(join(repoReceipts, "examples", "receipt-journal-entry.example.json"), "utf8");
  const result = validateReceipt(JSON.parse(raw));
  assert.equal(result.valid, true, result.errors.join("; "));
});

test("every allowed phase and outcome is accepted", () => {
  for (const phase of ["precheck", "dispatch", "execution-postcheck", "reconcile", "expiry"]) {
    const r = validateReceipt({ ...baseEntry(), phase });
    assert.equal(r.valid, true, `${phase}: ${r.errors.join("; ")}`);
  }
  for (const outcome of ["success", "failure", "expired", "rejected", "timeout"]) {
    const r = validateReceipt({ ...baseEntry(), outcome });
    assert.equal(r.valid, true, `${outcome}: ${r.errors.join("; ")}`);
  }
});

test("non-object input is rejected", () => {
  for (const bad of [null, undefined, 42, "string", ["array"], true]) {
    const r = validateReceipt(bad);
    assert.equal(r.valid, false);
    assert.equal(r.entry, null);
  }
});

test("unknown top-level field is rejected", () => {
  const r = validateReceipt({ ...baseEntry(), commandId: "jarvis-remote-20260821-4028ec32" });
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => e.includes("commandId")));
});

test("missing required fields are rejected", () => {
  const entry = baseEntry();
  delete entry.nonce;
  const r = validateReceipt(entry);
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => e.includes("nonce")));
});

test("malformed nonce is rejected", () => {
  assert.equal(validateReceipt({ ...baseEntry(), nonce: "TOO-SHORT" }).valid, false);
  assert.equal(validateReceipt({ ...baseEntry(), nonce: "0123456789ABCDEF0123456789ABCDEF" }).valid, false); // uppercase
  assert.equal(validateReceipt({ ...baseEntry(), nonce: "0".repeat(31) }).valid, false);
});

test("malformed rawHashRef is rejected", () => {
  assert.equal(validateReceipt({ ...baseEntry(), rawHashRef: "a".repeat(64) }).valid, false); // missing prefix
  assert.equal(validateReceipt({ ...baseEntry(), rawHashRef: "md5:" + "a".repeat(32) }).valid, false);
  assert.equal(validateReceipt({ ...baseEntry(), rawHashRef: "sha256:" + "a".repeat(63) }).valid, false);
});

test("ttlSeconds out of range or non-integer is rejected", () => {
  assert.equal(validateReceipt({ ...baseEntry(), ttlSeconds: 0 }).valid, false);
  assert.equal(validateReceipt({ ...baseEntry(), ttlSeconds: -1 }).valid, false);
  assert.equal(validateReceipt({ ...baseEntry(), ttlSeconds: 86401 }).valid, false);
  assert.equal(validateReceipt({ ...baseEntry(), ttlSeconds: 12.5 }).valid, false);
  assert.equal(validateReceipt({ ...baseEntry(), ttlSeconds: "600" }).valid, false);
});

test("invalid phase / outcome enums are rejected", () => {
  assert.equal(validateReceipt({ ...baseEntry(), phase: "arbitrary" }).valid, false);
  assert.equal(validateReceipt({ ...baseEntry(), outcome: "maybe" }).valid, false);
});

// --- Defense-in-depth: forbidden-content scan ------------------------------
// These prove that even if a producer tries to smuggle sensitive material, the
// entry is rejected AND the offending category is named.

test("smuggled shell command is rejected as command-or-execution", () => {
  const r = validateReceipt({ ...baseEntry(), note: "powershell -c Invoke-Expression $(rm -rf C:\\\\temp)" });
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => e.includes("command-or-execution")));
});

test("smuggled credential/token is rejected as credential-or-token", () => {
  const r = validateReceipt({ ...baseEntry(), meta: "password=hunter2 token=ghp_ABCDEFGHIJ1234567890" });
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => e.includes("credential-or-token")));
});

test("smuggled environment data is rejected as environment-data", () => {
  const r = validateReceipt({ ...baseEntry(), extra: "loaded from .env with %USERPROFILE%" });
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => e.includes("environment-data")));
});

test("smuggled Host Ops internals are rejected as host-ops-internal", () => {
  const r = validateReceipt({ ...baseEntry(), detail: "hostOps action host.system.health on DESKTOP-7CM41S6" });
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => e.includes("host-ops-internal")));
});

test("smuggled private-artifact reference is rejected as private-artifact", () => {
  const r = validateReceipt({ ...baseEntry(), ref: "see ai-orchestrator/src/policy.mjs" });
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => e.includes("private-artifact")));
});

test("forbidden content hidden in a KEY name is also caught", () => {
  const entry = baseEntry();
  entry["authorization"] = "x";
  const r = validateReceipt(entry);
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => e.includes("credential-or-token")));
});

test("rejected entries never echo content back", () => {
  const r = validateReceipt({ ...baseEntry(), token: "ghp_SECRETSECRET123456" });
  assert.equal(r.valid, false);
  assert.equal(r.entry, null);
});

// --- Journal-level validation ----------------------------------------------

test("validateJournal accepts an array of valid entries", () => {
  const journal = [baseEntry(), { ...baseEntry(), phase: "dispatch", outcome: "expired" }];
  const r = validateJournal(journal);
  assert.equal(r.valid, true);
  assert.equal(r.results.length, 2);
});

test("validateJournal flags the offending index", () => {
  const journal = [baseEntry(), { ...baseEntry(), nonce: "bad" }];
  const r = validateJournal(journal);
  assert.equal(r.valid, false);
  assert.equal(r.results[0].valid, true);
  assert.equal(r.results[1].valid, false);
  assert.equal(r.results[1].index, 1);
});

test("validateJournal rejects a non-array", () => {
  const r = validateJournal({ not: "an array" });
  assert.equal(r.valid, false);
});
