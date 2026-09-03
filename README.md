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
- Private source authority and sanitized receipt journal remain in `pixenetwork/ai-orchestrator`.
- This repository is transport only; it cannot mint actor approval, execution authority, validation authority, reviewer quorum, or receipt authority.

## Ruleset requirement

Before this transport may be treated as production-ready, repository administration must enforce the canonical branch directly:

1. protection/rulesets target `refs/heads/jarvis-remote-control-v2`;
2. non-fast-forward/history rewrite and deletion protections remain enabled;
3. required signing/identity constraints remain enabled where supported;
4. no unconditional `always` bypass actor may mutate the canonical control branch;
5. v1/v3/v4 and probe branches must not be accepted by consumers even if they remain in Git for provenance.

Current repository rulesets that target v1 do **not** satisfy this gate. Missing or mismatched v2 enforcement is a fail-closed condition.
