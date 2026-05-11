---
id: vestigial-memorystrategy-decision-workflow-ctrl
status: shipped
rank: null
type: refactor
references: []
out_of_scope:
  - "Repurposing the strategies (aligning namespaces with runtime write paths and re-introducing cross-decision learning) — that would be a design workstream, not a vestigial-cleanup."
  - "Updating docs/superpowers/specs/2026-03-18-agentcore-memory-design.md or the 2026-05-03 plan reference. Historical specs/plans are records-of-decision; out of scope for a code cleanup."
  - "Deploying the change. CDK diff will drop the 5 strategies from the deployed Memory resource; deferring to the next normal deploy cycle."
spec: null
plan: null
topic_memory: []
validation_gate: "pnpm nx run decision-workflow-ctrl:test — 6 suites, 47 tests pass (including new negative assertion that MemoryStrategies is empty/absent); pnpm nx run decision-workflow-ctrl:lint — 0 errors."
notes: "5 MemoryStrategy entries in service.stack.ts that are no longer fed."
---

# Vestigial MemoryStrategy declarations in decision-workflow-ctrl

`services/advisory/decision-workflow-ctrl/src/service.stack.ts:36-78` declares 5 `MemoryStrategy` entries (`/portfolio-engine/{actorId}/rationale`, `/advisory-narrative/{actorId}/preferences`, etc.) that are no longer fed. Spec 2 (2026-04-30) replaced the `CreateEvent` + `RetrieveMemoryRecords` path that strategies process events for; the current `libs/agent-orchestrator/src/memory/memory-client.ts:43,60` uses `BatchCreateMemoryRecordsCommand` + `ListMemoryRecordsCommand` directly against `/{upstreamService}/{tenantId}/decisions/{decisionId}`. Strategies are provisioned but never receive input. Either remove or repurpose. Low priority — misleading-but-functional.

## Ship 2026-05-11

Removed the 5 `MemoryStrategy` declarations + their supporting scaffolding from `service.stack.ts`:
- Dropped `agentcore.MemoryStrategy.usingUserPreference/usingSemantic/usingSummarization` block (lines 34–79).
- Dropped `BedrockFoundationModel` model wrapper + `hubNaming` lookup + `modelSonnetId` SSM read — those only served the strategy custom-extraction/consolidation prompts.
- Dropped the `memory.executionRole.addToPrincipalPolicy({ bedrock:InvokeModel … })` block — the Memory resource no longer needs Bedrock model access (no strategies invoking models). The execution role is not created at all when `memoryStrategies` is absent.
- Pruned 4 now-unused imports: `Stack`, `PolicyStatement`, `BedrockFoundationModel`, `NamingService`.
- Replaced the descriptive comment with "Per-decision short-term agent memory (no long-term strategies)" + a paragraph explaining the runtime write path vs. the strategy-namespace mismatch.

Tests: replaced the 5 strategy-specific assertions in `test/unit/service.stack.test.ts` with one negative assertion ("declares no MemoryStrategies — runtime path writes to /{service}/{tenantId}/decisions/{decisionId}, none of the legacy strategy namespaces overlap").

Note on deployment: the next `deploy.sh` will produce a CloudFormation diff that drops the 5 strategies from the `AWS::BedrockAgentCore::Memory` resource. Since the strategies were never fed, this has no runtime impact (no in-flight extraction/consolidation work to interrupt; no records under the legacy namespaces to lose).
