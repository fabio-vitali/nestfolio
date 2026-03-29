# Code Review: generate-c4-sources.mjs Implementation Plan

**Reviewed:** `docs/superpowers/plans/2026-03-29-generate-c4-sources.md`
**Date:** 2026-03-29
**Verdict:** Approve with required fixes (2 Critical, 3 Important, 4 Suggestions)

---

## What Is Done Well

- The TDD approach (failing test -> implement -> verify -> commit) per task is exemplary and will catch regressions early.
- The 8 service patterns are correctly identified and cover all 33 services.
- The plan correctly copies the existing D2 global styles verbatim, avoiding subtle rendering regressions.
- The `toD2Id()` PascalCase-to-kebab-case helper is a clean abstraction for D2 identifiers.
- The construct-to-D2 resource mapping table accurately reflects the actual AWS resources in each CDK construct.

---

## Critical Issues (Must Fix)

### C1. `resolveBusArn` regex fails on multiline calls and `this.prefix`

**File:** Plan line 497, regex for `resolveBusArn`

The plan's regex:
```
resolveBusArn\s*\([^,]+,\s*['"][^'"]+['"]\s*,\s*\w+\s*,\s*['"](\w+)['"]/g
```

This assumes all arguments are on a single line and the 3rd argument is a simple `\w+` identifier. However, `advisory-adpt/src/service.stack.ts` uses multiline calls AND `this.prefix`:

```typescript
const advisoryBusArn = resolveBusArn(
  this,
  'AdvisoryBus',
  this.prefix,      // <-- not matched by \w+ (contains a dot)
  'advisory',
  domainAccounts,
);
```

Similarly `ledger-ctrl`, `ledger-bff`, and `reconciliation-ctrl` use `this.prefix`.

**Fix:** Change `\w+` to `[\w.]+` for the prefix arg, and add `[\s\S]*?` multiline support:

```js
for (const m of src.matchAll(
  /resolveBusArn\s*\([\s\S]*?['"](\w+)['"]\s*(?:,\s*\w+)?\s*\)/gs
)) { ... }
```

Or more reliably, use a simpler approach that just finds the domain string argument:
```js
for (const m of src.matchAll(/resolveBusArn\([^)]*['"](\w+)['"]\s*,\s*\w+\s*\)/gs)) {
  result.raw.resolvedBuses.push(m[1]);
}
```

**Impact:** Without this fix, advisory-adpt, ledger-adpt, execution-adpt, ledger-ctrl, ledger-bff, and reconciliation-ctrl will have empty `resolvedBuses` arrays, producing broken C2 adapter flows.

### C2. Ingress eventTypes regex fails for enum-referenced arrays

**File:** Plan lines 276-303

The Ingress parser extracts eventTypes from string literal arrays (`['EVT_A', 'EVT_B']`). When eventTypes reference enum constants like `BrokerSimEventTypes.SIM_ORDER_REQUESTED`, the string-literal regex correctly finds nothing, and the fallback tries to detect a const reference. However, the fallback regex:

```js
const refMatch = after.match(/eventTypes\s*:\s*(\w+)/);
```

This matches the first word after `eventTypes:`, but in `eventTypes: [BrokerSimEventTypes.SIM_ORDER_REQUESTED, ...]`, the first word would be the opening bracket `[` ... which actually does not match `\w+`, so `refMatch` would be null.

Looking more carefully, the regex `eventTypes\s*:\s*\[([\s\S]*?)\]` does extract the content between brackets. Then `[...etMatch[1].matchAll(/['"]([^'"]+)['"]/g)]` finds string literals. If those are enum refs without quotes, it finds nothing. But there's no subsequent fallback for inline enum references like `BrokerSimEventTypes.FOO`.

The second fallback (checking for a const name via `eventTypes\s*:\s*(\w+)`) only works when the entire eventTypes value is a variable, not an inline array of enums.

**Impact:** broker-sim-adpt, broker-ctrl (ModeIngress), alpha-vantage-adpt, and most services using enum-based eventTypes will show `[0 events]` in the Ingress D2 label. While this doesn't break the diagram structurally, it loses valuable information.

**Fix:** After the string literal extraction fails, add a regex for enum references:
```js
if (entry.eventTypes.length === 0 && etMatch) {
  // Try enum references: TypeName.MEMBER
  entry.eventTypes = [...etMatch[1].matchAll(/\.(\w+)/g)].map(x => x[1]);
}
```

This is partially addressed for Orchestration triggers (line 333-335) but not for Ingress eventTypes.

Also add a fallback for spread syntax like `[...TRIGGER_EVENT_TYPES]` (used by `decision-workflow-ctrl` line 119):
```js
// Spread variable references: [...VAR_NAME]
const spreadMatch = etMatch[1].match(/\.\.\.(\w+)/);
if (spreadMatch) { /* resolve from const declaration */ }
```

---

## Important Issues (Should Fix)

### I1. `agentcore.Memory` construct not detected

**File:** `decision-workflow-ctrl/src/service.stack.ts` line 29

The plan detects `AgentRuntime` and `KnowledgeBase` extensions but not `agentcore.Memory`, which is a significant infrastructure component in `decision-workflow-ctrl`. This service creates an AgentCore Memory with 5 strategies and exports the memoryId via SSM.

**Recommendation:** Add detection for `agentcore.Memory` (or more generically `new agentcore.Memory(`) and render it as a Bedrock-colored node in the C3 diagram. Alternatively, document it as an intentional omission.

### I2. C2 generator renders data adapters as regular services

**File:** Plan lines 1164-1176

The current hand-maintained `nestfolio.d2` groups the 5 market data adapters (alpha-vantage-adpt, fred-adpt, yahoo-finance-adpt, sec-edgar-adpt, marketwatch-adpt) under a single "Market Data Adapters" external system node at C2 (line 448 of nestfolio.d2). The plan's C2 generator classifies them as `regular` services because they use State + Ingress + Egress.

This means the generated C2 advisory diagram will show 10+ individual service boxes instead of the current clean grouped view. The advisory domain has 15 services; showing all of them flatly will make the C2 diagram very crowded.

**Recommendation:** Add a classification for `data-adapter` pattern (services with `AdapterSchedule` or matching `*-adpt` naming while having high-level constructs) and optionally group them at C2 level. At minimum, use the `adapter` CSS class instead of `service` for these.

### I3. Cross-domain adapter C2 shows only one target bus

**File:** Plan line 1223: `break; // Show one target bus at C2 level`

The `execution-adpt` forwards to **3** target domains (investor, ledger, advisory). The plan breaks after showing one target bus. Similarly, `advisory-adpt` and `ledger-adpt` each forward to 2 target domains. This loses important architectural information at the C2 level.

**Recommendation:** Remove the `break` and show all target buses at C2 level, matching the current hand-maintained diagram behavior.

---

## Suggestions (Nice to Have)

### S1. `aws-cloudfront` class referenced but not in current classes

The plan adds `aws-cloudfront` to the generated global styles (line 1554-1558) and references `docs/architecture/icons/cloudfront.svg`, but the icon doesn't exist yet (confirmed via glob). Task 9 addresses this, but if that task is skipped or fails, the `d2` compile will break. Consider adding a guard in `generateC3` that falls back to a generic rectangle if the CloudFront icon is missing.

### S2. Standalone Lambda detection may over-match

The regex `(?:const|let)\s+(\w+)\s*=\s*new\s+NodejsFunction\s*\(\s*this\s*,\s*['"](\w+)['"]` will also match Lambdas created inside construct callbacks or nested scopes. In `investor-web`, this correctly finds `PostConfirmation` and `PostAuthentication`. But in `broker-ctrl`, it will also find `routeOrderFn` and `emitHealthCheckFn`, which are standalone Lambdas that _should_ be shown. However, in services that only use high-level constructs, the Ingress/Egress handlers are internal to those constructs and won't be matched (correct behavior, since `new NodejsFunction` is inside the construct code, not in `service.stack.ts`). This seems fine for the actual codebase; just noting the assumption.

### S3. Test file location

The plan puts tests at `test/tools/generate-c4-sources.test.mjs`. The project convention states "Tests live in `test/` directory, NOT `src/__tests__/`". This is a top-level tool, not a service, so `test/tools/` is a reasonable location. Just confirm this is an intentional pattern for tool tests.

### S4. Task step sizing

Most steps are well-sized at 2-5 minutes. However, Task 7 Step 3 (implementing `generateGlobalStyles` and `generateC1`) contains a ~200-line static template string. This is essentially copy-paste but should be verified character-by-character against the current `nestfolio.d2`. Consider splitting the static template into a separate template file that gets read at runtime, reducing the maintenance burden.

---

## Service Pattern Coverage Audit

| # | Service | Pattern in Plan | Actual Pattern | Match? |
|---|---------|----------------|----------------|--------|
| 1 | investor-ctrl | Standard ctrl | State + Ingress + Egress | Yes |
| 2 | investor-bff | BFF | State + Ingress + Egress + Facade | Yes |
| 3 | dashboard-bff | BFF | State + Ingress + Facade (no Egress) | Yes |
| 4 | onboarding-bff | Agent BFF | State + Egress + AgentRuntime + KB | Yes |
| 5 | investor-hub | Hub | EventBus + Archive | Yes |
| 6 | investor-adpt | Cross-domain | resolveBusArn + Rule + EventBusTarget | Yes |
| 7 | investor-web | Web frontend | Cognito + S3 + CloudFront | Yes |
| 8 | advisory-ctrl | Standard ctrl | State + Ingress + Egress | Yes |
| 9 | advisory-bff | BFF | State + Ingress + Facade | Verify |
| 10 | advisory-hub | Hub | EventBus + Archive | Yes |
| 11 | advisory-adpt | Cross-domain | resolveBusArn + Rule + EventBusTarget | Yes* |
| 12 | decision-workflow-ctrl | Orchestrated ctrl | State + multi-Ingress + Egress + Orchestration + Memory | Partial** |
| 13 | investor-profile-ctrl | Standard ctrl | State + Ingress + Egress | Yes |
| 14 | market-intelligence-ctrl | Standard ctrl | State + Ingress + Egress | Yes |
| 15 | portfolio-engine-ctrl | Standard ctrl | State + Ingress + Egress | Yes |
| 16 | compliance-ctrl | Standard ctrl | State + Ingress + Egress | Yes |
| 17 | advisory-narrative-ctrl | Standard ctrl | State + Ingress + Egress | Yes |
| 18 | alpha-vantage-adpt | Data adapter | State + Ingress + Egress + AdapterSchedule | Yes |
| 19 | fred-adpt | Data adapter | State + Ingress + Egress + AdapterSchedule | Yes |
| 20 | yahoo-finance-adpt | Data adapter | State + Ingress + Egress + AdapterSchedule | Yes |
| 21 | sec-edgar-adpt | Data adapter | State + Ingress + Egress + AdapterSchedule | Yes |
| 22 | marketwatch-adpt | Data adapter | State + Ingress + Egress + AdapterSchedule | Yes |
| 23 | execution-ctrl | Standard ctrl | State + Ingress + Egress | Yes |
| 24 | execution-hub | Hub | EventBus + Archive | Yes |
| 25 | execution-adpt | Cross-domain | resolveBusArn + Rule + EventBusTarget | Yes* |
| 26 | broker-ctrl | Orchestrated ctrl | State + multi-Ingress + Egress + multi-Orchestration | Yes |
| 27 | broker-sim-adpt | Standard ctrl | State + Ingress + Egress | Yes |
| 28 | broker-alpaca-adpt | Standard ctrl | State + Ingress + Egress | Yes |
| 29 | ledger-ctrl | Standard ctrl | State + Ingress + Egress | Yes |
| 30 | ledger-bff | BFF | State + Ingress + Facade | Verify |
| 31 | ledger-hub | Hub | EventBus + Archive | Yes |
| 32 | ledger-adpt | Cross-domain | resolveBusArn + Rule + EventBusTarget | Yes* |
| 33 | reconciliation-ctrl | Standard ctrl | State + Ingress + Egress | Yes |

`*` = affected by C1 regex bug (multiline `resolveBusArn` / `this.prefix`)
`**` = `agentcore.Memory` not detected (I1)

**All 33 services are covered by the plan's discovery mechanism.** Pattern detection is correct for 30/33 services; 3 cross-domain adapters and decision-workflow-ctrl have the issues documented above.

---

## File Paths Verified

| Path | Status |
|------|--------|
| `tools/generate-c4-sources.mjs` | Will be created (correct location) |
| `test/tools/generate-c4-sources.test.mjs` | Will be created (follows convention) |
| `docs/architecture/nestfolio.d2` | Exists, will be overwritten |
| `docs/architecture/c3/*.d2` | 27 exist, 6 new will be created |
| `docs/architecture/icons/cloudfront.svg` | Does NOT exist, Task 9 creates it |
| `libs/cdk-constructs/src/core/` | All 6 constructs verified |
| `libs/cdk-constructs/src/extensions/agent-runtime.ts` | Verified |
