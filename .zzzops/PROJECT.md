# Project success charter

**Status:** complete
**Last reviewed:** 2026-09-06

## Overall goal
- Outcome: Maintain a public, non-executable transport for bounded Jarvis Host Ops command envelopes while preserving strict separation from private source, credentials, receipts, and execution authority.
- Primary beneficiaries: Jarvis Host Ops operators, Pixel Network control-plane maintainers
- Why it matters: The transport must carry bounded command envelopes without becoming a source or code-execution channel.
- Time horizon: Ongoing repository operation; review whenever canonical ownership, execution authority, security boundaries, or release governance materially changes.

## Success metrics
| KPI | Why it matters | Baseline | Target / threshold | Evidence source | Review cadence |
| --- | --- | --- | --- | --- | --- |
| Exact-head change integrity | Stale evidence must not authorize moved source. | Quantitative historical rate not yet measured. | 100% of promoted source changes bind review/verification to the exact candidate head and current target state. | PR metadata, local verification receipts, exact-head comparison records. | Per promotion. |
| Verified completion integrity | Process start or agent prose is not completion proof. | Quantitative historical coverage not yet measured. | 100% of completed substantial goals carry artifact-appropriate observable evidence. | ZzzOps goal records, local test/runtime outputs, review receipts. | Per goal completion. |

## Project acceptance criteria
- [x] Substantial repository-changing work uses Managed ZzzOps workflow except explicit scoped exemptions.
- [x] Each coherent source/resource surface has one writer at a time and parallel lanes are non-overlapping.
- [x] Exact candidate head and current target are re-fetched before promotion; stale reviews do not authorize moved heads.
- [x] GitHub Actions/runners are not Jarvis execution, validation, deployment, recovery, HostOps, or reviewer-quorum authority.
- [x] Completed goals require observable verification evidence appropriate to the changed artifact.

## Value rubric
- `critical`: required for project acceptance, safety, or a binding deadline.
- `high`: materially moves a priority KPI or unlocks critical/high-value work.
- `medium`: useful measurable contribution with limited leverage.
- `low`: weak, speculative, cosmetic, or currently unmeasured contribution.

When KPIs conflict, prefer: Safety and authorization first; correctness and evidence integrity second; repository outcome and throughput third; convenience and cost last.

## Constraints and non-goals
### Constraints
- No Jarvis source code, credentials, tokens, secrets, environment files, private configuration, or private receipts.
- No GitHub Actions/runners and no execution of code from this repository on Windows hosts.
- Only bounded JSON command envelopes may use the protected control-branch contract.
- Preserve one-writer ownership, exact-head validation, local/approved validation, receipts/auditability, and fail-closed handling.

### Non-goals
- Hosting private Jarvis source or receipts.
- Executing commands or scripts from repository content.

### Unacceptable tradeoffs
- Any convenience path that turns transport content into executable authority.
- Weakening protected branch/genesis or envelope validation.

## Assumptions and open questions
- None recorded at initialization; add evidence-backed changes with history.

## Operating policy

- `[policy:backend]` **Canonical goal backend**: github_issues (customized from a ZzzOps default)
- `[policy:git_review_release]` **Git, review, and release**: Follow repository rules: one draft PR per source-changing writer lane; preserve exact-head discipline; re-fetch candidate head and current main before promotion; use human_at_exhaustion review without bypassing required PR, merge, or release authority. (customized from a ZzzOps default)
- `[policy:execution_continuation]` **Execution and work continuation**: Continue across actionable goals under reviewed dependency and resource policy, and incorporate newly captured goals at the next safe checkpoint. (customized from a ZzzOps default)
- `[policy:verification_testing]` **Verification and testing**: Require artifact-appropriate observable evidence on the exact candidate head using approved local/direct execution; GitHub Actions results are provenance only and never authoritative Jarvis validation. (customized from a ZzzOps default)
- `[policy:code_quality]` **Code-quality and refactoring boundaries**: Preserve behavior unless a goal explicitly authorizes a behavior change. (customized from a ZzzOps default)
- `[policy:dependencies_tooling]` **Dependencies, tooling, and generated artifacts**: Use project-native tooling; do not hand-edit generated or dependency-owned files. (customized from a ZzzOps default)
- `[policy:security_privacy_compliance]` **Security, privacy, secrets, and compliance**: Repository policy may tighten but never weaken ZzzOps safety and authority boundaries. (customized from a ZzzOps default)
- `[policy:documentation_style]` **Documentation and style**: Follow evidenced repository documentation, style, and user-communication conventions. (customized from a ZzzOps default)
- `[policy:deployment_resources]` **Deployment, environment, and resources**: Do not deploy without explicit authority; authoritative execution and validation use approved local/direct paths, never GitHub Actions runners. (customized from a ZzzOps default)
- `[policy:engineering_rigor]` **Engineering rigor**: agentic (customized from a ZzzOps default)
- `[policy:workflow_adherence]` **ZzzOps workflow adherence**: managed (customized from a ZzzOps default)
- `[policy:automated_design]` **Automated design authority**: enabled (customized from a ZzzOps default)
- `[policy:autonomy_approval_parallelism]` **Autonomy, approvals, and parallelism**: Interview thoroughly during goal capture; execute unattended within reviewed authority; allow multiple writer lanes only when their file/resource scopes are explicitly non-overlapping; keep one writer per coherent surface; use up to three size-aware worktree workers. (customized from a ZzzOps default)

Detailed rationale and review history: [PROJECT_AUDIT.md](PROJECT_AUDIT.md). Canonical policy state: [POLICY.json](POLICY.json).
