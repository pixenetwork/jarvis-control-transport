import test from "node:test";
import assert from "node:assert/strict";

import { admitTransportBinding, MAX_SEEN_NONCES } from "../admit-binding.mjs";

const HEAD = "8368ef0c10fe35881a567282794e558144f23b53";
const NONCE = "0123456789abcdef0123456789abcdef";
const OTHER = "fedcba9876543210fedcba9876543210";

function candidate(overrides = {}) {
  return {
    controlRef: "refs/heads/jarvis-remote-control-v2",
    observedHead: HEAD,
    expectedHead: HEAD,
    actor: "pixenetwork",
    expectedActor: "pixenetwork",
    issuedAt: 1_780_000_000,
    ttlSeconds: 600,
    now: 1_780_000_100,
    nonce: NONCE,
    seenNonces: [OTHER],
    ...overrides,
  };
}

test("matching exact head, actor, window, and fresh nonce is admitted", () => {
  const result = admitTransportBinding(candidate());
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.binding, {
    controlRef: "refs/heads/jarvis-remote-control-v2",
    observedHead: HEAD,
    actor: "pixenetwork",
    nonce: NONCE,
    issuedAt: 1_780_000_000,
    ttlSeconds: 600,
    expiresAt: 1_780_000_600,
  });
});

test("non-canonical control refs fail closed", () => {
  for (const controlRef of [
    "refs/heads/jarvis-remote-control-v1",
    "refs/heads/jarvis-remote-control-v3",
    "refs/heads/jarvis-remote-control-v4",
    "refs/heads/probe/health",
    "refs/heads/control/canary",
    "jarvis-remote-control-v2",
    "refs/heads/jarvis-remote-control-v2 ",
  ]) {
    const result = admitTransportBinding(candidate({ controlRef }));
    assert.equal(result.valid, false, controlRef);
    assert.equal(result.binding, null);
    assert.ok(result.errors.includes("control-ref"), controlRef);
  }
});

test("moved or malformed heads are not admitted", () => {
  const moved = admitTransportBinding(candidate({
    observedHead: "307d6aa000000000000000000000000000000000",
  }));
  assert.equal(moved.valid, false);
  assert.deepEqual(moved.errors, ["exact-head"]);

  for (const observedHead of [HEAD.toUpperCase(), HEAD.slice(0, 39), `${HEAD}0`, ""]) {
    const result = admitTransportBinding(candidate({ observedHead, expectedHead: observedHead }));
    assert.equal(result.valid, false, observedHead);
    assert.ok(result.errors.includes("malformed"));
    assert.equal(result.errors.includes("exact-head"), false);
  }
});

test("actor mismatch or empty actor fails closed and does not mint approval", () => {
  const mismatch = admitTransportBinding(candidate({ actor: "other-writer" }));
  assert.equal(mismatch.valid, false);
  assert.deepEqual(mismatch.errors, ["actor"]);

  for (const actor of ["", " ", "pixenetwork ", "bad actor", "a".repeat(65)]) {
    const result = admitTransportBinding(candidate({ actor, expectedActor: actor }));
    assert.equal(result.valid, false, JSON.stringify(actor));
    assert.ok(result.errors.includes("malformed"));
  }
});

test("expiry is a half-open window and out-of-range ttl is malformed", () => {
  const lastInside = admitTransportBinding(candidate({ now: 1_780_000_599 }));
  assert.equal(lastInside.valid, true);

  const atExpiry = admitTransportBinding(candidate({ now: 1_780_000_600 }));
  assert.equal(atExpiry.valid, false);
  assert.deepEqual(atExpiry.errors, ["expiry"]);

  const beforeIssue = admitTransportBinding(candidate({ now: 1_779_999_999 }));
  assert.equal(beforeIssue.valid, false);
  assert.ok(beforeIssue.errors.includes("expiry"));

  for (const ttlSeconds of [0, -1, 86401, 12.5, "600"]) {
    const result = admitTransportBinding(candidate({ ttlSeconds }));
    assert.equal(result.valid, false, String(ttlSeconds));
    assert.ok(result.errors.includes("malformed"));
    assert.equal(result.errors.includes("expiry"), false);
  }
});

test("a seen nonce is a replay and an unseen nonce is not", () => {
  const replay = admitTransportBinding(candidate({ seenNonces: [NONCE] }));
  assert.equal(replay.valid, false);
  assert.deepEqual(replay.errors, ["replay"]);
  assert.equal(replay.binding, null);

  const fresh = admitTransportBinding(candidate({ seenNonces: [] }));
  assert.equal(fresh.valid, true);
});

test("missing fields, unknown fields, and non-objects fail closed", () => {
  const missing = candidate();
  delete missing.expectedHead;
  assert.deepEqual(admitTransportBinding(missing).errors, ["malformed"]);

  const extra = candidate();
  extra.command = "ignored";
  const extraResult = admitTransportBinding(extra);
  assert.equal(extraResult.valid, false);
  assert.equal(extraResult.binding, null);

  for (const bad of [null, undefined, 42, "string", [], true]) {
    const result = admitTransportBinding(bad);
    assert.equal(result.valid, false);
    assert.equal(result.binding, null);
  }
});

test("corrupt or unbounded replay sets fail closed", () => {
  const corrupt = admitTransportBinding(candidate({ seenNonces: [NONCE.toUpperCase()] }));
  assert.equal(corrupt.valid, false);
  assert.ok(corrupt.errors.includes("malformed"));
  assert.equal(corrupt.errors.includes("replay"), false);

  const bounded = admitTransportBinding(candidate({
    seenNonces: Array.from({ length: MAX_SEEN_NONCES + 1 }, () => OTHER),
  }));
  assert.equal(bounded.valid, false);
  assert.ok(bounded.errors.includes("malformed"));
});

test("hostile getters and symbol keys do not escape admission", () => {
  const accessor = candidate();
  Object.defineProperty(accessor, "nonce", {
    enumerable: true,
    get() {
      throw new Error("getter must never execute");
    },
  });
  assert.doesNotThrow(() => admitTransportBinding(accessor));
  assert.equal(admitTransportBinding(accessor).valid, false);

  const symbolKeyed = candidate();
  symbolKeyed[Symbol("token")] = "secret";
  assert.doesNotThrow(() => admitTransportBinding(symbolKeyed));
  assert.equal(admitTransportBinding(symbolKeyed).valid, false);
});

test("replay detection ignores an overridden array includes method", () => {
  const seenNonces = [NONCE];
  seenNonces.includes = () => false;

  const result = admitTransportBinding(candidate({ seenNonces }));
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("replay"));
});

test("replay-set accessors and proxies fail closed without throwing", () => {
  const accessor = [OTHER];
  Object.defineProperty(accessor, "0", {
    enumerable: true,
    get() {
      throw new Error("replay getter must never execute");
    },
  });
  assert.doesNotThrow(() => admitTransportBinding(candidate({ seenNonces: accessor })));
  assert.ok(admitTransportBinding(candidate({ seenNonces: accessor })).errors.includes("malformed"));

  const proxied = new Proxy([OTHER], {
    getOwnPropertyDescriptor() {
      throw new Error("descriptor trap");
    },
  });
  assert.doesNotThrow(() => admitTransportBinding(candidate({ seenNonces: proxied })));
  assert.ok(admitTransportBinding(candidate({ seenNonces: proxied })).errors.includes("malformed"));
});
test("proxy replay sets cannot underreport length", () => {
  const replaySet = new Proxy([NONCE], {
    getOwnPropertyDescriptor(target, property) {
      if (property === "length") {
        return { value: 0, writable: true, enumerable: false, configurable: false };
      }
      return Reflect.getOwnPropertyDescriptor(target, property);
    },
  });
  const result = admitTransportBinding(candidate({ seenNonces: replaySet }));
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("malformed"));
});

test("revoked proxy inputs fail closed without throwing", () => {
  const { proxy, revoke } = Proxy.revocable(candidate(), {});
  revoke();
  assert.doesNotThrow(() => admitTransportBinding(proxy));
  assert.deepEqual(admitTransportBinding(proxy), { valid: false, errors: ["malformed"], binding: null });
});
test("top-level proxy candidates fail closed before descriptor snapshotting", () => {
  const target = candidate({ seenNonces: [NONCE] });
  const proxy = new Proxy(target, {
    getOwnPropertyDescriptor(object, property) {
      if (property === "seenNonces") {
        return { value: [], writable: true, enumerable: true, configurable: true };
      }
      return Reflect.getOwnPropertyDescriptor(object, property);
    },
  });
  const result = admitTransportBinding(proxy);
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("malformed"));
});
test("rejected candidates never echo the replay set", () => {
  const result = admitTransportBinding(candidate({ seenNonces: [NONCE], actor: "someone-else" }));
  assert.equal(result.valid, false);
  assert.equal(result.binding, null);
  assert.equal(JSON.stringify(result).includes(NONCE), false);
});
