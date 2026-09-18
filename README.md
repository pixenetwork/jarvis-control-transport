# Jarvis Control Transport

Public, non-executable transport for bounded Jarvis Host Ops command envelopes.

## Security boundary

- No Jarvis source code.
- No credentials, tokens, secrets, environment files, private configuration, or private receipts.
- No GitHub Actions or runners.
- The Windows host never executes code from this repository.
- Only JSON command envelopes under `control/remote/commands/` may be appended after the protected control-branch genesis.
- Private source authority, policy, and the authoritative raw receipts remain in `pixenetwork/ai-orchestrator`.

## Receipt journal

This repository hosts a **public, sanitized** receipt journal for the Jarvis
remote-control transport. It records only non-sensitive receipt *metadata* so
that command outcomes are publicly auditable without ever exposing private
material.

- The control branch is `jarvis-remote-control-v1` (protected).
- A journal entry may contain **only** these sanitized fields: `phase`,
  `nonce`, a raw-hash reference (`rawHashRef`), TTL (`ttlSeconds`), and
  `outcome`. Nothing else is permitted.
- **Never** post commands, credentials, tokens, environment data, Host Ops
  internals, or any other private artifact to this journal. The authoritative
  raw receipt is held privately in `pixenetwork/ai-orchestrator` and is
  referenced here only by a one-way hash.
- Format, schema, the enforcing validator, and the hard constraints are
  documented in [`receipts/README.md`](receipts/README.md).
- This repository does not depend on `pixenetwork/ai-orchestrator` being
  present; the validator is fully self-contained.
