---
id: stale-memory-write-comments-phase-a-cleanup
status: parking
type: refactor
notes: "6 stale comments in decision-workflow-ctrl + cdk-constructs reference writeAgentOutput / BatchCreate / ListMemoryRecords"
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
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
