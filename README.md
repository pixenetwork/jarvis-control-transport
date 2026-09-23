# Jarvis Control Transport

Public, non-executable transport for bounded Jarvis Host Ops command envelopes.

## Canonical control branch

`jarvis-remote-control-v2` is the **only canonical operational control branch**.

All other branches, including `jarvis-remote-control-v1`, `jarvis-remote-control-v3`, `jarvis-remote-control-v4`, `control/*`, `probe/*`, `phase0*`, `temp-*`, and one-off health/proof branches, are non-authoritative historical/probe state. Their existence, protection status, commits, or successful command-looking payloads must never be interpreted as permission to execute work.

A consumer must fail closed unless its configured control ref is exactly `refs/heads/jarvis-remote-control-v2`. No automatic fallback to v1/v3/v4 or a probe branch is permitted.

## Security boundary

- No Jarvis source code.
- No credentials, tokens, secrets, environment files, private configuration, or private receipts.
- No GitHub Actions or runners.
- The Windows host never executes code from this repository.
- Only JSON command envelopes under `control/remote/commands/` may be appended after the protected v2 control-branch genesis.
- Private source authority, policy, and the authoritative raw receipts remain in `pixenetwork/ai-orchestrator`.
- This repository is transport only; it cannot mint actor approval, execution authority, validation authority, reviewer quorum, or receipt authority.

## Ruleset requirement (repository-admin action)

The canonical v2 repository-admin ruleset gate is **satisfied**. The active jarvis-remote-control-v2-canonical-immutability ruleset targets exactly refs/heads/jarvis-remote-control-v2, has no bypass actors, and enforces deletion protection, linear history, non-fast-forward protection, and required signatures. See .zzzops/RULESET_REQUIREMENT.md for the recorded application evidence and verification steps.

Consumers must still fail closed if canonical-v2 enforcement is later missing or mismatched; this repository does not gain execution or Host Ops authority from the ruleset.

## Receipt journal

This repository hosts a **public, sanitized** receipt journal for the Jarvis
remote-control transport. It records only non-sensitive receipt *metadata* so
that command outcomes are publicly auditable without ever exposing private
material.

- The canonical control branch is `jarvis-remote-control-v2`; consumers must fail closed on any other control ref.
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
