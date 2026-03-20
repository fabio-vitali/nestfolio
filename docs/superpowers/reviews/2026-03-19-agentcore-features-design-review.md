# Review: AgentCore Features Adoption — Design Spec

**Spec:** `docs/superpowers/specs/2026-03-19-agentcore-features-design.md`
**Reviewer:** Claude Opus 4.6 (automated)
**Date:** 2026-03-19

---

## Status: Issues Found

---

## Issues

### Critical

**1. Track A — Wrong prop name for CodeInterpreter name**
The spec uses `interpreterName` in `AgentCodeInterpreterProps`. The actual CDK class `CodeInterpreterCustom` uses `codeInterpreterCustomName`.
**Fix:** Rename `interpreterName` to `codeInterpreterCustomName` in the wrapper props, or document the mapping clearly in the construct implementation.

**2. Track A — `networkMode` is not a string enum on the CDK class**
The spec proposes `networkMode?: 'PUBLIC' | 'SANDBOX'` as a string. The actual API uses `networkConfiguration?: CodeInterpreterNetworkConfiguration`, which is set via factory methods like `CodeInterpreterNetworkConfiguration.usingPublicNetwork()` or `CodeInterpreterNetworkConfiguration.usingVpc(...)`. There is no `SANDBOX` mode — it is `PUBLIC` (default) or `VPC`.
**Fix:** Replace the `networkMode` string prop with `networkConfiguration?: CodeInterpreterNetworkConfiguration`, or abstract it as `useVpc?: VpcConfigProps` and default to `usingPublicNetwork()`. Remove the non-existent `SANDBOX` option.

**3. Track A — `grantInvoke()` does not exist on CodeInterpreterCustom**
The spec says `codeInterpreter.grantInvoke(this.agentRuntime.runtime)`. The actual class exposes `grantUse()` (which grants Invoke + Start + Stop) and `grantRead()`. There is no standalone `grantInvoke`.
**Fix:** Use `grantUse()` instead of `grantInvoke()`.

**4. Track B — Wrong prop name for Browser name**
The spec uses `browserName` in `AgentBrowserProps`. The actual CDK class uses `browserCustomName`.
**Fix:** Rename to `browserCustomName`, or document the mapping.

**5. Track B — `signing` prop uses wrong type and wrong default**
The spec proposes `signing?: 'ENABLED' | 'DISABLED'` with default `ENABLED`. The actual CDK prop is `browserSigning?: BrowserSigning` (an enum), and the **default is `DISABLED`** (not ENABLED). The spec's choice of ENABLED-by-default is a valid design decision, but the wrapper must explicitly set `BrowserSigning.ENABLED` — this needs to be documented as an intentional override of the CDK default.
**Fix:** Use `BrowserSigning` enum type. Add a comment clarifying the intentional default override.

**6. Track B — `recordingBucket` prop shape mismatch**
The spec passes `recordingBucket?: IBucket`. The actual CDK prop is `recordingConfig?: RecordingConfig` which has `{ enabled?: boolean; s3Location?: Location }`. The wrapper needs to translate from `IBucket` to `RecordingConfig`.
**Fix:** Spec should show the translation: `recordingConfig: { enabled: true, s3Location: { bucket: props.recordingBucket } }` (verify `Location` shape from CDK).

**7. Track C — `Interceptor.fromLambdaFunction()` does not exist**
The spec references `agentcore.Interceptor.fromLambdaFunction()`. The actual class is `LambdaInterceptor` with static methods `LambdaInterceptor.forRequest(fn, options?)` and `LambdaInterceptor.forResponse(fn, options?)`.
**Fix:** Replace all `Interceptor.fromLambdaFunction()` references with `LambdaInterceptor.forRequest()` / `LambdaInterceptor.forResponse()`.

**8. Track C — Gateway supports max 1 REQUEST + 1 RESPONSE interceptor**
The spec defines 4 interceptors (tenantScope, inputValidation, rateLimiting, auditTrail) with tenantScope + inputValidation + rateLimiting as REQUEST and auditTrail as RESPONSE. But the Gateway enforces **at most one REQUEST interceptor and one RESPONSE interceptor**. Three REQUEST interceptors cannot be attached.
**Fix:** Consolidate all REQUEST-side logic (tenant scope, input validation, rate limiting) into a **single composite REQUEST interceptor Lambda** that runs all three checks sequentially. Keep auditTrail as the single RESPONSE interceptor. This is a significant architectural change.

**9. Track D — Wrong KMS prop name on Memory**
The spec uses `encryptionKmsKey`. The actual CDK prop is `kmsKey`.
**Fix:** Replace `encryptionKmsKey: memoryKey` with `kmsKey: memoryKey`.

**10. Track D — `OverrideConfig.model` is required but spec omits it**
The spec says "Uses the default model provided by AgentCore. No need to override with a specific model." But `OverrideConfig` requires both `model: IBedrockInvokable` and `appendToPrompt: string` — neither is optional. You cannot provide a custom prompt without also specifying a model.
**Fix:** Each strategy with a custom extraction/consolidation prompt must also specify a model (e.g., `BedrockFoundationModel.ANTHROPIC_CLAUDE_SONNET_V3_5`). Update the spec to include model selection for all 6 `OverrideConfig` instances.

### Minor

**11. Track A — Spec says "Tags to apply" as `Record<string, string>` but CDK uses `{ [key: string]: string }`**
These are structurally identical in TypeScript, so no runtime issue. But the existing `KnowledgeBase` construct uses CDK `Tags.of()` + `applyStandardTags()` rather than passing tags as props. The spec should clarify whether it uses the CDK-native `tags` prop or the existing `applyStandardTags()` pattern.
**Fix:** Align with existing construct tagging pattern.

**12. Track C — Interceptor Lambda handler event shape not specified**
The spec mentions "mock Gateway event shape" for testing but never defines the actual request/response event payload shape that interceptor Lambdas receive.
**Fix:** Add a section documenting the Gateway interceptor Lambda event schema (or reference the AgentCore docs).

**13. Track C — `passRequestHeaders` option not mentioned**
The `InterceptorOptions` interface has a `passRequestHeaders` boolean (defaults to `false` for security). The tenant-scope interceptor likely needs headers to extract tenant context. This is not addressed.
**Fix:** Specify which interceptors need `passRequestHeaders: true`.

**14. Track D — Spec references "5 strategies" but doesn't list all 5 names**
The 3 with custom prompts are listed plus 2 "unchanged" ones, but the mapping to `ManagedStrategy` vs `SelfManagedStrategy` CDK types is not specified.
**Fix:** Add a table showing each strategy's CDK type (`ManagedStrategy`) and `strategyType` enum value.

---

## Strengths

- **Clear track independence** — each track is self-contained with its own files, tests, and integration points
- **Good design decision on Track C** — extending `AgentRuntime` rather than creating standalone interceptor constructs follows the existing pattern well
- **Comprehensive file summary table** — makes implementation planning straightforward
- **Track D prompt design** — domain-specific extraction/consolidation prompts are well-thought-out with clear rationale for which strategies get overrides
- **Consistent construct pattern** — new constructs (A, B) follow the same shape as existing `KnowledgeBase` and `AgentRuntime`
- **Security considerations** — browser signing default, KMS rotation, tenant isolation are all appropriate for a financial platform
