# Canonical branch ruleset requirement (repository-admin action)

Tracks: [#24](https://github.com/pixenetwork/jarvis-control-transport/issues/24) — "P1 admin gate: protect canonical v2 and remove unconditional bypass".

This document is the precise, checkable specification for the repository-level
ruleset change. It cannot be applied from a pull request: GitHub repository
rulesets are an admin-only, org/repo settings-level resource, not something a
committed file can change. A repository owner/admin with access to
**Settings → Rules → Rulesets** (or the equivalent `PUT
/repos/{owner}/{repo}/rulesets/{ruleset_id}` / `POST
.../rulesets` admin API call) must perform this change directly.

## Known-bad current state (evidence, recorded 2026-09-03 audit)

- Intended canonical control ref: `refs/heads/jarvis-remote-control-v2`.
- `jarvis-remote-control-v2` is protected only at the classic branch-protection
  endpoint; it is **not** covered by any repository ruleset.
- The only active repository ruleset is `21129233`
  (`jarvis-remote-control-v1-writer-gate`), and it targets
  `refs/heads/jarvis-remote-control-v1`, not v2.
- Ruleset `21129233` grants user `pixenetwork` `bypass_mode: always` —
  an unconditional, unaudited bypass of every rule it enforces.
- `jarvis-remote-control-v3`, `jarvis-remote-control-v4`, and assorted
  `probe/*` / `control/*` / `temp-*` branches are unprotected by any
  ruleset and must remain non-authoritative (see `README.md`).

## Required end state

1. **Retarget/create the canonical ruleset** so it applies to
   `refs/heads/jarvis-remote-control-v2` (by `ref_name.include`, not branch
   name pattern-matching that could also catch v1/v3/v4).
2. **Preserve or add these rules** on that ruleset, scoped to v2:
   - `deletion` — branch cannot be deleted.
   - `non_fast_forward` — no force-push / history rewrite; this is the rule
     that preserves fast-forward-only history.
   - Do **not** use GitHub's `update` ("Restrict updates") rule as a
     fast-forward guard. That rule blocks all ref updates for actors without a
     bypass. If an admin intentionally enables it, the bounded envelope writer
     must be a narrowly scoped, audited bypass actor and a post-change canary
     must prove that an authorized append still succeeds.
   - `required_signatures` (or equivalent identity/signing safeguard), if the
     repository's write path supports it.
   - `pull_request` / required-review rule for any writer other than the
     bounded command-envelope append path, if applicable.
3. **Remove the unconditional bypass.** No actor may hold
   `bypass_mode: always` on the canonical (v2) ruleset. If an emergency
   break-glass path is operationally required, it must be:
   - scoped to a named, individually accountable actor or team (never "always"
     for a broad principal),
   - logged/audited (the bypass event itself must be observable after the
     fact), and
   - narrower than full rule bypass where GitHub's ruleset model allows
     per-rule bypass instead of all-rule bypass.
4. **Confirm v1/v3/v4 and probe/control/temp branches stay non-authoritative**:
   they may keep their own (or no) ruleset for provenance, but nothing in
   this repository's automation or downstream consumers may treat them as
   the control branch. (Enforced today at the source/consumer level by
   the "Canonical control branch" section of `README.md`.)
5. **Record the result** in this file (or a follow-up commit to it) once
   applied:
   - exact `jarvis-remote-control-v2` head SHA at the time of the change,
   - the ruleset ID(s) now targeting v2,
   - confirmation (e.g. `gh api repos/pixenetwork/jarvis-control-transport/rulesets`)
     that no ruleset targeting the canonical branch grants an `always`
     bypass actor.

## Applied evidence (2026-09-20)

- Exact canonical head at application: `jarvis-remote-control-v2` =
  `2cdc255a0bdefa00046cb43f7c0b1734a1e2aa32`.
- Repository ruleset `21129234` is active as
  `jarvis-remote-control-v2-canonical-immutability`, targets exactly
  `refs/heads/jarvis-remote-control-v2`, has no bypass actors, and enforces
  `deletion`, `required_linear_history`, `non_fast_forward`, and
  `required_signatures`.
- The legacy v1 writer gate `21129233` is renamed
  `jarvis-remote-control-v1-writer-gate-retired`, disabled, and has no bypass
  actors. Its historical `update` rule is therefore not active on the
  canonical branch.
- The evaluated rules for the v2 branch return only the four canonical
  immutability/signing rules above; no `update` / Restrict-updates rule is
  active on v2.
- Consumer-side fail-closed behavior was revalidated at exact
  `pixenetwork/ai-orchestrator` main
  `a69616f959d1d3a5e74370ccc2e67facdd551460`: the targeted remote-control
  suite passed 24/24 tests, including v2-only configuration/ref validation and
  explicit rejection of v1 reintroduction.
- No command-envelope canary was written to the control branch. The admin
  correction did not add an `update` rule and therefore avoided introducing a
  new bypass requirement or a command-looking mutation solely for testing.

## Verification (run after the admin change, from an account with repo read access)

```sh
# List rulesets and confirm one targets refs/heads/jarvis-remote-control-v2
gh api repos/pixenetwork/jarvis-control-transport/rulesets

# Inspect that ruleset's target ref and bypass_actors; bypass_actors must not
# contain an entry with bypass_mode "always"
gh api repos/pixenetwork/jarvis-control-transport/rulesets/<ruleset_id>

# Record the exact v2 head at time of verification
gh api repos/pixenetwork/jarvis-control-transport/git/ref/heads/jarvis-remote-control-v2
```

The repository-admin ruleset gate in issue #24 is satisfied by the evidence
recorded above. This does not waive any separate Host Ops runtime, receipt,
identity, or deployment gate.
