---
id: pr-audit-workflow-missing-pnpm-install
status: parking
type: bug
notes: "pr-audit.yml fails at 'Install dependencies' step — pnpm not on runner. Compare with pr-deploy.yml's pnpm/action-setup."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
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
