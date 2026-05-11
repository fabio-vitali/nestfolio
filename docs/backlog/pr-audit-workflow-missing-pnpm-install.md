---
id: pr-audit-workflow-missing-pnpm-install
status: shipped
rank: null
type: bug
notes: "pr-audit.yml fails at 'Install dependencies' step — pnpm not on runner. Compare with pr-deploy.yml's pnpm/action-setup."
references: []
out_of_scope:
  - "Installing the Claude Code CLI (required by the 'Run CI audit' step). That step is continue-on-error and the Post-results step has a fallback message — Claude-CLI absence does not fail the workflow. Separate concern."
  - "Triggering an actual workflow run to validate. Blocked on the parking-lot pr-pipeline-required-status-check workstream (which itself is blocked on ci-pipeline-bring-up). YAML-parse validation + a side-by-side diff with pr-deploy.yml's canonical setup is the local validation gate."
  - "Refactoring the shared setup block into a composite action across all workflows. Future tidy, not in this dossier."
spec: null
plan: null
topic_memory: []
validation_gate: "YAML parses (`node -e require('yaml').parse(...)` reports 7 steps in the audit job). Step sequence now matches the canonical block from pr-deploy.yml (checkout → pnpm/action-setup → setup-node@24+cache → pnpm install). Real workflow validation deferred — blocked on ci-pipeline-bring-up green run; see out_of_scope."
---

# `pr-audit.yml` workflow missing `pnpm/action-setup` step

Surfaced 2026-05-08 on `chore/pr-pipeline-rehearsal` PR #1 (the throwaway PR for the `pr-pipeline-required-status-check` workstream). The PR Audit workflow fails fast at `.github/workflows/pr-audit.yml:28-29`:

```
audit  Install dependencies  pnpm install --frozen-lockfile
audit  Install dependencies  /home/runner/work/_temp/.../script.sh: line 1: pnpm: command not found
audit  Install dependencies  ##[error]Process completed with exit code 127.
```

Run: https://github.com/fabio-vitali/nestfolio/actions/runs/25543485674/job/74974311930

`pr-audit.yml` does `actions/setup-node@v4` (line 24-26) but never installs pnpm. `pr-deploy.yml` and the other working workflows use `pnpm/action-setup` (or equivalent) before `pnpm install`. Fix: add a `pnpm/action-setup@v4` step (or copy the canonical block from `pr-deploy.yml`) between the Node setup and the `pnpm install` step.

Independent of the active rehearsal: PR Audit runs Claude-API-driven audit-comment-on-PR; failure here just means no audit comment is posted. Does NOT affect `pr-deploy.yml` → `sandbox-integration-test`, which is what the active workstream validates.

Promote when next time a PR gets merged without an audit comment and someone notices, or batch with the next CI workflow cleanup.

## Ship 2026-05-11

Replaced the broken `setup-node@v4 (node-version: 20)` + bare `pnpm install` pair in `.github/workflows/pr-audit.yml:19-29` with the canonical 3-step block from `pr-deploy.yml`:

```yaml
- uses: actions/checkout@v4
  with: { fetch-depth: 0 }
- uses: pnpm/action-setup@v4
- uses: actions/setup-node@v4
  with: { node-version: 24, cache: pnpm }
- run: pnpm install --frozen-lockfile
```

Two changes beyond pure pnpm-install fix:
1. **Node 20 → 24** for consistency with `pr-deploy.yml` (build-and-test, security-scan, sandbox-deploy, sandbox-integration-test all use 24). Drift between PR Audit and the rest of the pipeline would risk subtle resolution mismatches.
2. **`cache: pnpm`** enabled — same canonical block; speeds up the audit job.

Local validation only: YAML parses cleanly (7 steps in `jobs.audit.steps`). Next-PR-run validation is blocked on `ci-pipeline-bring-up` workstream (parking lot); separate concern.
