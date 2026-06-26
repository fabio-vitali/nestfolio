---
id: stale-memory-write-comments-phase-a-cleanup
status: active
type: refactor
notes: "6 stale comments in decision-workflow-ctrl + cdk-constructs reference writeAgentOutput / BatchCreate / ListMemoryRecords. Verification (2026-06-26) narrowed this: only ~3 are genuinely stale; the eventual-consistency comments are correct (explain why code AVOIDS ListMemoryRecords), the BatchCreateMemoryRecords hits are live IAM test assertions, and writeAgentOutput has zero refs."
references: []
out_of_scope:
  - "The decision-state-machine.ts + service.stack.test.ts eventual-consistency comments — verified CURRENT/correct (they explain the avoid-ListMemoryRecords design), not stale; leaving them"
  - "The .not.toContain('bedrock-agentcore:BatchCreateMemoryRecords') IAM test assertions — live, asserting the grant correctly excludes those actions"
  - "The externalModules:[] agent-profile bundling config itself — behavioral, unchanged; only its stale example command reference is generalized"
spec: null
plan: null
topic_memory: []
validation_gate: null
epic: dead-code-cleanup
epic_role: core
---

# Stale Memory-write comments — Phase A leftover cleanup

After Phase A landed (Tasks 7-9), 6 stale comment locations still reference deleted methods/commands. All are comment-only (no code dependency); none block functionality.

References to clean up:
- `services/advisory/decision-workflow-ctrl/src/service.stack.ts:26` — comment references the dropped IAM grants.
- `services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts:39, 232` — comment references the eventual-consistency window.
- `services/advisory/decision-workflow-ctrl/test/unit/service.stack.test.ts:232` — comment references `ListMemoryRecords`.
- `libs/cdk-constructs/src/utils/lambda-profiles.ts:170, 173, 174` — bundling rationale references `BatchCreateMemoryRecordsCommand`. The class is still bundled transitively via `@aws-sdk/client-bedrock-agentcore`; no `externalModules`/`keepNames` references it. esbuild will tree-shake it now that no caller exists.
- `libs/cdk-constructs/test/utils/lambda-profiles.test.ts:148` — corresponding test comment.

Cheapest next step: one PR that grep-replaces these references with current-state factual one-liners. ~10 minutes.

Defer until Phase A behavior is observed in dev for a few days — bundling the comment-cleanup PR with any other small advisory tidy is also fine.
