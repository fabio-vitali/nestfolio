# AgentCore Features Adoption — Plan Review

**Plan:** `docs/superpowers/plans/2026-03-19-agentcore-features.md`
**Spec:** `docs/superpowers/specs/2026-03-19-agentcore-features-design.md`
**Status:** Issues Found

---

## Issues

### Critical

**1. Task 3/6 — Incorrect `this.agentRuntime` reference pattern**
The plan says `this.agentRuntime.runtime` but the actual stacks do NOT store AgentRuntime as `this.agentRuntime`. Looking at the 5 service stacks (`advisory-ctrl`, `advisory-narrative-ctrl`, `investor-profile-ctrl`, `market-intelligence-ctrl`, `portfolio-engine-ctrl`), they all use `new AgentRuntime(this, 'AgentRuntime', {...})` without storing the reference. The plan correctly notes this for Task 3 ("You'll need to store the reference") but Task 6 silently assumes `agentRuntime` is already available. Similarly, Task 10 adds interceptors to the `AgentRuntime` constructor call but does not address the fact that CodeInterpreter/Browser (from earlier chunks) also need the stored reference.
**Fix:** Make Tasks 3 and 6 consistent — both must show the variable assignment `const agentRuntime = new AgentRuntime(...)`. Task 10 must also reference this stored variable.

**2. Task 10 — Plan lists 5 agent service stacks but misses `decision-workflow-ctrl`**
The spec says "all agent service stacks" for interceptors. `decision-workflow-ctrl` has no `AgentRuntime` (it uses `agentcore.Memory` directly + Step Functions), so it is correctly excluded. However, the plan lists `advisory-ctrl` which DOES have `AgentRuntime`. Verify: does `advisory-narrative-ctrl` actually have an `AgentRuntime`? Looking at the stack, it does. All 5 listed stacks are correct. No issue here — retracted.

**3. Task 1 — Missing `applyStandardTags()` call in construct implementation**
The spec explicitly says "Standard tags via `applyStandardTags()` (follows existing construct pattern)" for both `AgentCodeInterpreter` and `AgentBrowser`. The plan's Task 1 construct code does NOT call `applyStandardTags()`. Same issue in Task 4 for `AgentBrowser`.
**Fix:** Add `applyStandardTags(this, {})` call in both construct constructors, and add the import from `./tagging`.

**4. Task 12 — Incorrect model reference approach**
The spec says: "use `BedrockFoundationModel.fromFoundationModelId()` with the SSM-resolved model ID." The plan instead uses `BedrockFoundationModel.ANTHROPIC_CLAUDE_SONNET_V3_5` (a static constant) and adds a note saying "Check the actual class for the correct static field name." SSM-resolved values are deploy-time strings, not synth-time — `fromFoundationModelId()` is the correct approach per the spec. The static constant approach may work but diverges from the spec's intent to use the same SSM-resolved model ID used elsewhere in the advisory domain.
**Fix:** Use `BedrockFoundationModel.fromFoundationModelId(scope, 'SonnetModel', modelSonnetId)` where `modelSonnetId` comes from SSM `valueForStringParameter`, consistent with how all other stacks resolve model IDs.

**5. Task 12 — Missing test for custom extraction/consolidation prompts**
The spec explicitly requires: "Custom extraction/consolidation prompts are set on the correct 3 strategies" and "Remaining 2 strategies have no custom overrides." The plan's Task 12 only adds 2 KMS tests but no tests for the custom prompts.
**Fix:** Add CDK assertion tests verifying that 3 of the 5 strategies have `OverrideConfiguration` properties and 2 do not.

### Minor

**6. Task 1 — Test asserts `Name` property but CDK L2 constructs may use `CodeInterpreterCustomName`**
The CloudFormation resource property name for the code interpreter name may differ from `Name`. Since this is an alpha CDK construct (`@aws-cdk/aws-bedrock-agentcore-alpha`), the CFN property mapping may be `CodeInterpreterCustomName` not `Name`.
**Fix:** Verify the actual CFN property name from the alpha construct source or use `Match.objectLike` with a broader assertion initially.

**7. Task 4 — Test does not verify `BrowserSigning` default override to `ENABLED`**
The spec emphasizes that signing defaults to ENABLED (overriding CDK default of DISABLED). The test in Task 4 should assert this.
**Fix:** Add a test: `it('enables browser signing by default', ...)`.

**8. Task 6 — Missing `signing` prop in wiring code**
The spec's wiring pattern includes `signing: 'ENABLED'` but Task 6 omits it. The construct defaults signing to ENABLED, so the behavior is correct, but the plan diverges from the spec's example.
**Fix:** Either add `signing: 'ENABLED'` for explicitness or add a comment noting the default.

**9. Task 9 — Interceptor Lambda bundling path**
The plan uses `join(__dirname, '..', 'src', 'interceptors', 'request-guard.ts')` for the NodejsFunction entry point. Since the construct is in `libs/cdk-constructs/src/agent-runtime.ts`, the relative path to `interceptors/request-guard.ts` should be `join(__dirname, 'interceptors', 'request-guard.ts')` (same directory level).
**Fix:** Use `join(__dirname, 'interceptors', 'request-guard.ts')` for the entry path.

**10. Task 11 — Version pinning concern**
The plan specifies `pnpm add -D @aws-cdk/aws-bedrock-alpha@2.243.0-alpha.0`. This should match the version of `@aws-cdk/aws-bedrock-agentcore-alpha` already installed. Version mismatch between alpha CDK packages causes build failures.
**Fix:** Add a note to check the installed `@aws-cdk/aws-bedrock-agentcore-alpha` version first and match it.

---

## Spec Coverage Check

| Spec Section | Plan Tasks | Covered? |
|---|---|---|
| Track A: CodeInterpreter construct | Task 1 (construct + tests) | Yes (missing `applyStandardTags`) |
| Track A: CodeInterpreter export | Task 2 (index export) | Yes |
| Track A: Service integration (portfolio-engine, market-intelligence) | Task 3 (wiring) | Yes |
| Track B: Browser construct | Task 4 (construct + tests) | Yes (missing `applyStandardTags`, signing test) |
| Track B: Browser export | Task 5 (index export) | Yes |
| Track B: Service integration (market-intelligence only) | Task 6 (wiring) | Yes |
| Track C: Request guard interceptor | Task 7 (handler + tests) | Yes |
| Track C: Audit trail interceptor | Task 8 (handler + tests) | Yes |
| Track C: Extend AgentRuntime with interceptor support | Task 9 (construct + tests) | Yes |
| Track C: Wire interceptors into 5 stacks | Task 10 (wiring) | Yes |
| Track D: KMS encryption | Task 12 (KMS key + wiring) | Yes (model ref incorrect) |
| Track D: Custom extraction/consolidation prompts | Task 12 (prompts) | Partial (no tests for prompts) |
| Track D: `@aws-cdk/aws-bedrock-alpha` dependency | Task 11 (install) | Yes |
| Cross-cutting: construct exports | Tasks 2, 5 | Yes |
| Cross-cutting: track independence | Plan chunks 1-4 | Yes |
| Verification | Task 13 | Yes |

---

## Summary

5 critical issues, 5 minor issues. The most impactful are: missing `applyStandardTags()` (breaks convention), incorrect model reference approach in Task 12, and missing prompt tests. All are fixable without restructuring the plan. Task granularity and chunk independence are good.
