# Jarvis Control Transport

Public, non-executable transport for bounded Jarvis Host Ops command envelopes.

## Security boundary

- No Jarvis source code.
- No credentials, tokens, secrets, environment files, private configuration, or private receipts.
- No GitHub Actions or runners.
- The Windows host never executes code from this repository.
- Only JSON command envelopes under `control/remote/commands/` may be appended after the protected control-branch genesis.
- Private source authority and sanitized receipt journal remain in `pixenetwork/ai-orchestrator`.
