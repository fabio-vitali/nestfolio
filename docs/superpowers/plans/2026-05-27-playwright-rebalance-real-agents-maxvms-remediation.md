# Playwright rebalance — real-agents path & maxVms remediation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remediate AgentCore maxVms saturation so the two Playwright journeys (`new-investor-happy-path`, `deposit-reload-mid-flight`) pass 2× consecutively against deployed dev, measurement-first per [[feedback-measure-before-proposing]], with the speculative rebalance scenario deleted and two follow-up dossiers filed.

**Architecture:** Measurement-driven. Phase 1 collects M1–M6 from deployed dev. Phase 2 derives the mechanism from §4 of the spec's decision tree. Phase 3 deletes the speculative scenario + fixture. Phase 4 files follow-up dossiers. Phase 5 rewrites the active dossier. Phase 6 deploys + validates. Phase 7 ships + closes the worktree via `finishing-a-development-branch`.

**Tech Stack:** AWS CLI (Service Quotas, CloudWatch Logs Insights, CloudWatch Metrics, Cost Explorer, Bedrock AgentCore control + data planes), AWS CDK (Duration), Jest snapshot tests, Playwright, `pnpm nx`, the project's `backlog-add` / `backlog-lint` / `audit-service` skills.

**Spec:** `docs/superpowers/specs/2026-05-27-playwright-rebalance-real-agents-maxvms-remediation-design.md` — read first; this plan implements §3 → §9 of that spec.

---

## Phase 1 — Measurement pass (§3 of spec)

### Task 1: M1 — collect dev maxVms quota

**Files:**
- Modify: `docs/superpowers/specs/2026-05-27-playwright-rebalance-real-agents-maxvms-remediation-design.md` (populate one row of §6 table)

- [ ] **Step 1: List Bedrock AgentCore service quotas**

```bash
aws service-quotas list-service-quotas \
  --service-code bedrock-agentcore \
  --query 'Quotas[?contains(QuotaName, `vm`) || contains(QuotaName, `concurrent`) || contains(QuotaName, `session`)].[QuotaCode,QuotaName,Value,Adjustable]' \
  --output table 2>&1 | tee /tmp/m1-quotas.txt
```

Expected: a table listing quotas. The relevant row is named something like "Maximum concurrent micro-VMs per runtime" or "Concurrent sessions per agent runtime". Record the QuotaCode + Value.

- [ ] **Step 2: If the catalog filter returns empty, list all quotas and grep**

Only run if Step 1 returned no rows:

```bash
aws service-quotas list-service-quotas --service-code bedrock-agentcore --output table 2>&1 | tee /tmp/m1-quotas-full.txt
grep -iE "vm|concurrent|session|runtime" /tmp/m1-quotas-full.txt
```

Expected: identify the right quota by name. Record QuotaCode + Value.

- [ ] **Step 3: If service-code `bedrock-agentcore` is not recognized, try alternative service codes**

```bash
aws service-quotas list-services --output text | grep -i agent
```

Expected: alternative service codes (likely `bedrock-agentcore-control` or similar). Re-run Step 1 with the correct code.

- [ ] **Step 4: Populate §6 of the spec**

Replace the `_TBD_` value in the "M1 dev maxVms quota" row of the §6 table with the measured value (format: `<N> sessions per runtime (QuotaCode=<code>, Adjustable=<bool>)`). Leave the §6 section heading + the other M2–M6 rows unchanged for now.

- [ ] **Step 5: Do not commit yet**

§6 will be committed as a single unit after all measurements complete (Task 7).

---

### Task 2: M2 — peak concurrent active sessions per runtime during a journey

**Files:**
- Modify: `docs/superpowers/specs/2026-05-27-playwright-rebalance-real-agents-maxvms-remediation-design.md` (populate 5 rows of §6 table + memory-strategy tertiary row)
- Create (transient): `/tmp/m2-poll.sh`, `/tmp/m2-poll-output.txt`

- [ ] **Step 1: Discover the 5 AgentCore runtime IDs from SSM**

```bash
for svc in onboarding-bff portfolio-engine-ctrl advisory-narrative-ctrl investor-profile-ctrl market-intelligence-ctrl; do
  echo "=== $svc ==="
  aws ssm get-parameters-by-path --path "/nestfolio/dev-${svc}" --recursive \
    --query 'Parameters[?contains(Name, `runtime`)].[Name,Value]' --output table
done 2>&1 | tee /tmp/m2-runtimes.txt
```

Expected: an SSM parameter per service giving the runtime URL or ID. Note which parameter naming convention each service uses (e.g., `agent/runtimeUrl` vs `agentRuntime/id`).

- [ ] **Step 2: Resolve runtime IDs from URLs**

If SSM exports URLs but the AgentCore API needs IDs, derive the ID from the URL (the path segment after `runtimes/`) OR call `aws bedrock-agentcore-control list-agent-runtimes` and match by name prefix:

```bash
aws bedrock-agentcore-control list-agent-runtimes \
  --query 'agentRuntimes[?starts_with(name, `dev-`)].[name,agentRuntimeId]' --output table 2>&1 | tee /tmp/m2-runtime-ids.txt
```

Expected: 5 runtime IDs corresponding to the 5 services. Record each.

- [ ] **Step 3: Write the polling script**

Create `/tmp/m2-poll.sh`:

```bash
#!/usr/bin/env bash
set -uo pipefail
RUNTIME_IDS=(
  "ID_onboarding_bff"
  "ID_portfolio_engine_ctrl"
  "ID_advisory_narrative_ctrl"
  "ID_investor_profile_ctrl"
  "ID_market_intelligence_ctrl"
)
NAMES=(onboarding-bff portfolio-engine-ctrl advisory-narrative-ctrl investor-profile-ctrl market-intelligence-ctrl)
echo "timestamp,$(IFS=,; echo "${NAMES[*]}")"
for i in {1..120}; do
  TS=$(date -u +%H:%M:%S)
  COUNTS=()
  for id in "${RUNTIME_IDS[@]}"; do
    n=$(aws bedrock-agentcore list-agent-runtime-sessions --agent-runtime-id "$id" --query 'length(sessionSummaries)' --output text 2>/dev/null || echo "ERR")
    COUNTS+=("$n")
  done
  echo "$TS,$(IFS=,; echo "${COUNTS[*]}")"
  sleep 5
done
```

Replace the `ID_*` placeholders with the actual IDs from Step 2. Make executable: `chmod +x /tmp/m2-poll.sh`.

- [ ] **Step 4: Verify the polling script works (1 sample, then abort)**

```bash
timeout 10 /tmp/m2-poll.sh 2>&1 | head -3
```

Expected: the header line + at least 1 data row with 5 integers (likely all zero if no journey is running). If `ERR` appears in any column, the AgentCore CLI call shape is wrong — drop into `aws bedrock-agentcore help` and `aws bedrock-agentcore-control help` to find the right subcommand (the API split may differ from the CLI naming; alternatives include `aws bedrock-agent-runtime` and `aws bedrock-agentcore-data`).

- [ ] **Step 5: Start polling in background, run the journey in foreground**

Terminal A (background poller):

```bash
/tmp/m2-poll.sh > /tmp/m2-poll-output.txt &
POLL_PID=$!
echo "Poller PID: $POLL_PID"
```

Terminal B (journey under measurement):

```bash
pnpm nx run nestfolio-e2e:e2e -- --grep "new-investor-happy-path" --reporter=list 2>&1 | tee /tmp/m2-journey.log
```

When the journey completes (pass or fail), stop the poller:

```bash
kill $POLL_PID 2>/dev/null
echo "--- Poll output summary ---"
cat /tmp/m2-poll-output.txt
```

- [ ] **Step 6: Compute peak per runtime**

```bash
awk -F, 'NR==1{for(i=2;i<=NF;i++) header[i]=$i; next} {for(i=2;i<=NF;i++) if($i+0>peak[i]) peak[i]=$i+0} END {for(i=2;i<=length(peak)+1;i++) printf "%s: %d\n", header[i], peak[i]}' /tmp/m2-poll-output.txt
```

Expected: one line per runtime showing the peak concurrent count.

- [ ] **Step 7: Collect tertiary-branch memory strategy activity**

```bash
aws bedrock-agentcore-control list-memories --output table 2>&1 | tee /tmp/m2-memories.txt
```

For each memory ID listed, query active strategy executions:

```bash
for mem in $(awk '/memoryId/{print $4}' /tmp/m2-memories.txt); do
  aws bedrock-agentcore-control list-memory-strategy-executions --memory-id "$mem" --query 'length(executions)' --output text
done
```

Expected: a count of active or recent strategy executions per memory. Record.

- [ ] **Step 8: Populate the 5 M2 rows + the memory-strategy tertiary row in §6**

Replace each `_TBD_` with the measured peak. For the memory-strategy row, record format: `<total active executions> (across <N> memories during journey window)`.

- [ ] **Step 9: Do not commit yet**

Continue to Task 3.

---

### Task 3: M3 — ServiceQuotaExceeded retry rate over last 30 days

**Files:**
- Modify: `docs/superpowers/specs/2026-05-27-playwright-rebalance-real-agents-maxvms-remediation-design.md` (populate M3 row of §6)

- [ ] **Step 1: Identify the relevant Lambda log group names**

```bash
aws logs describe-log-groups --log-group-name-prefix "/aws/lambda/dev-" \
  --query 'logGroups[?contains(logGroupName, `portfolio-engine-ctrl`) || contains(logGroupName, `advisory-narrative-ctrl`) || contains(logGroupName, `onboarding-bff`)].logGroupName' \
  --output text 2>&1 | tee /tmp/m3-log-groups.txt
```

Expected: 3+ log group names (PE may have several — ingress + agent + egress; record all).

- [ ] **Step 2: Start the Logs Insights query**

```bash
QUERY_ID=$(aws logs start-query \
  --log-group-names $(cat /tmp/m3-log-groups.txt | tr '\n' ' ') \
  --start-time $(($(date +%s) - 2592000)) --end-time $(date +%s) \
  --query-string 'fields @timestamp, @log, @message | filter @message like /ServiceQuotaExceeded/ | stats count() by bin(1h), @log' \
  --query 'queryId' --output text)
echo "QUERY_ID=$QUERY_ID"
```

Expected: a query ID string. Save it.

- [ ] **Step 3: Poll for query completion**

```bash
while true; do
  STATUS=$(aws logs get-query-results --query-id "$QUERY_ID" --query 'status' --output text)
  echo "Status: $STATUS"
  [ "$STATUS" = "Complete" ] && break
  [ "$STATUS" = "Failed" ] && { echo "Query failed"; break; }
  sleep 5
done
aws logs get-query-results --query-id "$QUERY_ID" --output table 2>&1 | tee /tmp/m3-results.txt
```

Expected: query completes within 1-3 min. Table shows hourly counts of ServiceQuotaExceeded, grouped by log group (showing which Lambda dominates).

- [ ] **Step 4: Populate M3 row in §6**

Format: `<total count> over 30d, dominated by <log-group-name> (<count> events). Hourly distribution: <clustered|smeared>`.

---

### Task 4: M4 — DWC SF `TaskTimedOut` count over last 30 days

**Files:**
- Modify: `docs/superpowers/specs/2026-05-27-playwright-rebalance-real-agents-maxvms-remediation-design.md` (populate M4 row of §6)

- [ ] **Step 1: Resolve the DWC SF ARN**

```bash
SF_ARN=$(aws ssm get-parameter --name /nestfolio/dev-decision-workflow-ctrl/state-machine/arn --query Parameter.Value --output text)
echo "SF_ARN=$SF_ARN"
```

If that SSM path doesn't exist, list candidate parameters:

```bash
aws ssm get-parameters-by-path --path "/nestfolio/dev-decision-workflow-ctrl" --recursive --query 'Parameters[?contains(Name, `state-machine`) || contains(Name, `stateMachine`)].[Name,Value]' --output table
```

- [ ] **Step 2: Get the ExecutionsTimedOut metric**

```bash
aws cloudwatch get-metric-statistics \
  --namespace AWS/States --metric-name ExecutionsTimedOut \
  --dimensions Name=StateMachineArn,Value=$SF_ARN \
  --start-time $(date -u -v-30d +%Y-%m-%dT%H:%M:%SZ) --end-time $(date -u +%Y-%m-%dT%H:%M:%SZ) \
  --period 86400 --statistics Sum --output table 2>&1 | tee /tmp/m4-metric.txt
```

Expected: per-day counts of state-machine-level timeouts. Sum them.

- [ ] **Step 3: Use Logs Insights for per-Resource breakdown (which agent state)**

```bash
SF_LOG_GROUP="/aws/vendedlogs/states/dev-decision-workflow-ctrl"
QUERY_ID=$(aws logs start-query \
  --log-group-name "$SF_LOG_GROUP" \
  --start-time $(($(date +%s) - 2592000)) --end-time $(date +%s) \
  --query-string 'fields @timestamp, type, details.resource | filter type = "TaskTimedOut" | stats count() by details.resource' \
  --query 'queryId' --output text)
while true; do
  STATUS=$(aws logs get-query-results --query-id "$QUERY_ID" --query 'status' --output text)
  [ "$STATUS" = "Complete" ] && break
  sleep 5
done
aws logs get-query-results --query-id "$QUERY_ID" --output table 2>&1 | tee /tmp/m4-by-resource.txt
```

If the SF log group name differs from `/aws/vendedlogs/states/dev-decision-workflow-ctrl`, find it:

```bash
aws logs describe-log-groups --log-group-name-prefix "/aws/vendedlogs/states/dev-decision-workflow-ctrl" --query 'logGroups[].logGroupName' --output text
```

- [ ] **Step 4: Populate M4 row in §6**

Format: `<total count over 30d>, dominated by <Resource ARN suffix> (<count> timeouts). State-machine-level: <metric-sum>`.

---

### Task 5: M5 — wall-clock per phase of the journey baseline

**Files:**
- Modify: `docs/superpowers/specs/2026-05-27-playwright-rebalance-real-agents-maxvms-remediation-design.md` (populate M5 row of §6)

The M2 journey run from Task 2 already captured per-step timing in the Playwright `--reporter=list` output. Reuse `/tmp/m2-journey.log`.

- [ ] **Step 1: Extract per-step durations from Playwright output**

```bash
awk '/^[[:space:]]+✓|^[[:space:]]+✗/ {print}' /tmp/m2-journey.log | tee /tmp/m5-steps.txt
```

Expected: one line per test.step with status + duration. Identify the four heaviest phases.

- [ ] **Step 2: Compute totals**

```bash
awk '/^Test:|^Running/ {next} /[0-9]ms\)$/ {match($0, /\(([0-9]+)ms\)$/, a); total += a[1]; print $0} END {printf "TOTAL: %d ms (%.1f s)\n", total, total/1000}' /tmp/m5-steps.txt
```

- [ ] **Step 3: Populate M5 row in §6**

Format: `<total>s total. Top phases: onboarding-wizard=<N>s, deposit=<N>s, decision-pipeline=<N>s, confirm=<N>s`.

---

### Task 6: M6 — cost attribution from saturation churn (last 30 days)

**Files:**
- Modify: `docs/superpowers/specs/2026-05-27-playwright-rebalance-real-agents-maxvms-remediation-design.md` (populate M6 row of §6)

- [ ] **Step 1: Pull Bedrock cost by usage type**

```bash
aws ce get-cost-and-usage \
  --time-period Start=$(date -u -v-30d +%Y-%m-%d),End=$(date -u +%Y-%m-%d) \
  --granularity DAILY --metrics UnblendedCost \
  --filter '{"Dimensions":{"Key":"SERVICE","Values":["Amazon Bedrock"]}}' \
  --group-by Type=DIMENSION,Key=USAGE_TYPE \
  --output json > /tmp/m6-bedrock.json
jq -r '.ResultsByTime[].Groups[] | "\(.Keys[0]): $\(.Metrics.UnblendedCost.Amount)"' /tmp/m6-bedrock.json | sort | uniq -c | sort -rn | head -20
```

Expected: a list of usage types with daily cost. AgentCore-related usage types should be visible.

- [ ] **Step 2: Pull Lambda cost for the advisory domain**

```bash
aws ce get-cost-and-usage \
  --time-period Start=$(date -u -v-30d +%Y-%m-%d),End=$(date -u +%Y-%m-%d) \
  --granularity MONTHLY --metrics UnblendedCost \
  --filter '{"And":[{"Dimensions":{"Key":"SERVICE","Values":["AWS Lambda"]}},{"Tags":{"Key":"nestfolio-domain","Values":["advisory"]}}]}' \
  --output table 2>&1 | tee /tmp/m6-lambda.txt
```

If the tag filter returns nothing, the resources may not be tagged. Fall back to grouping by usage type without the tag filter and note in the spec that attribution is approximate.

- [ ] **Step 3: Populate M6 row in §6**

Format: `Bedrock 30d total: $<N>. Dominant usage type: <type> ($<N>). Lambda advisory 30d: $<N> (or "untaggable").`

---

### Task 7: Commit the populated §6

**Files:**
- Modify: `docs/superpowers/specs/2026-05-27-playwright-rebalance-real-agents-maxvms-remediation-design.md`

- [ ] **Step 1: Re-read §6 of the spec and verify all _TBD_ markers are replaced**

```bash
grep "_TBD_" docs/superpowers/specs/2026-05-27-playwright-rebalance-real-agents-maxvms-remediation-design.md
```

Expected: only matches in §7 (mechanism selected) and §8 (validation gate) remain — §6 should have zero `_TBD_` strings.

- [ ] **Step 2: Add a timestamp to the §6 heading**

Change line `## 6. Baseline measurements` to `## 6. Baseline measurements (YYYY-MM-DD HH:MM UTC)` with the actual current timestamp.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-05-27-playwright-rebalance-real-agents-maxvms-remediation-design.md
git commit -m "$(cat <<'EOF'
docs(spec): populate §6 baseline maxVms measurements

M1-M6 collected against deployed dev. Numbers feed the §4 decision tree
for mechanism selection in the next commit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 2 — Mechanism selection + implementation (§4 of spec)

### Task 8: Evaluate decision tree + record selected Case in spec §7

**Files:**
- Modify: `docs/superpowers/specs/2026-05-27-playwright-rebalance-real-agents-maxvms-remediation-design.md` (populate §7)

- [ ] **Step 1: Run the primary-branch check**

Manually compute: `M1_value` vs `SUM(M2 peak counts × 1.2)`.

If `M1 > SUM × 1.2`: jump to Step 5 (no-op mechanism — re-scope workstream).

Otherwise: continue to Step 2.

- [ ] **Step 2: Identify the dominant runtime in M2**

From §6 measurements, compute each runtime's share of total peak. Apply the case thresholds:

- onboarding-bff ≥ 60% of total → Case A.
- (portfolio-engine-ctrl + advisory-narrative-ctrl) ≥ 50% of total → Case B.
- (investor-profile-ctrl + market-intelligence-ctrl) ≥ 30% of total → Case C (regression — STOP).
- If two cases tie, select both (Case A+B; Case A+C does not happen because Case C is a stop condition).

- [ ] **Step 3: Check the tertiary branch (memory strategies)**

From the M2 memory-strategy row: if active executions are non-trivial AND consume the same micro-VM pool (verify in `aws bedrock-agentcore-control help` for the pool-attribution semantics; if undocumented, default to "yes, same pool"), add them to the selection rationale. Memory-strategy peak does NOT trigger an additional mechanism — there's no knob for it short of disabling the strategies, which is outside this workstream's scope.

- [ ] **Step 4: Write §7 of the spec**

Replace the "_To be populated after §6_" placeholder with a section like:

```markdown
## 7. Mechanism selected

**Selected case:** <A | B | A+B | C (stop) | NO-OP>

**Rationale:** From §6, M2 peak distribution was:
- onboarding-bff: <N> sessions (<X>% of total)
- PE: <N> (<X>%)
- AN: <N> (<X>%)
- IP: <N> (<X>%)
- MI: <N> (<X>%)

Total peak: <N>. Dev maxVms quota (M1): <N>. Headroom ratio: <total / quota>.

Primary-branch outcome: <saturation possible | saturation impossible>.
Secondary-branch selection: <Case A | Case B | ...>.
Tertiary-branch factor: <memory-strategy contribution recorded | n/a>.

**Implementation:** <one paragraph describing the exact files + lines + values to change, copied from §4 of this spec for the selected case>.
```

- [ ] **Step 5: If Case C or NO-OP, STOP and re-brainstorm**

If the decision tree selected Case C (IP/MI regression) or NO-OP (saturation impossible — flakes have another cause): the original workstream's premise is wrong. Skip Phase 2 implementation entirely, jump straight to Phase 3 (deletion is still valid), Phase 4 (still file follow-up dossiers), Phase 5 (rewrite dossier — but the Done Definition needs amending to reflect the shipped-as-no-op vs new-workstream-needed outcome). Surface to the user via AskUserQuestion before proceeding past Task 14.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-05-27-playwright-rebalance-real-agents-maxvms-remediation-design.md
git commit -m "docs(spec): record selected mechanism in §7 from §6 decision tree

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Implement Case A — onboarding-bff idleTimeout tightening

**SKIP this task** if Case A was not selected. Skip to Task 10 (if Case B selected) or Task 12 (otherwise).

**Files:**
- Modify: `services/investor/onboarding-bff/src/service.stack.ts:83` (and optionally :84)
- Modify: `services/investor/onboarding-bff/test/unit/service.stack.test.ts` (add assertion for idleTimeout)

- [ ] **Step 1: Add a failing CDK assertion test**

Open `services/investor/onboarding-bff/test/unit/service.stack.test.ts` and add this `it()` block before the closing `})` of the outer `describe`:

```typescript
  it('configures onboarding-bff AgentRuntime with idleTimeout=30s for sandbox maxVms friendliness', () => {
    template.hasResourceProperties('AWS::BedrockAgentCore::Runtime', {
      NetworkConfiguration: Match.anyValue(),
    });
    // Resolve the runtime resource and assert the idle-timeout property.
    const runtimes = template.findResources('AWS::BedrockAgentCore::Runtime');
    const runtime = Object.values(runtimes)[0] as { Properties: { IdleSessionTimeout?: number } };
    // CDK serialises Duration.seconds(30) to the seconds integer 30 on this property.
    expect(runtime.Properties.IdleSessionTimeout).toBe(30);
  });
```

Note: the exact CloudFormation property name (`IdleSessionTimeout` vs `IdleTimeout` vs `MaxIdleTime`) depends on the `@aws-cdk/aws-bedrock-agentcore-alpha` schema. If the assertion fails because the property is named differently, inspect `template.toJSON()` output to find the right key:

```bash
pnpm nx run onboarding-bff:test -- --testNamePattern="idleTimeout" 2>&1 | tail -40
```

- [ ] **Step 2: Run the test to verify it FAILS**

```bash
pnpm nx run onboarding-bff:test -- --testNamePattern="idleTimeout=30s for sandbox" 2>&1 | tail -20
```

Expected: FAIL — current stack sets `Duration.minutes(5)` which serialises to `300`, not `30`.

- [ ] **Step 3: Make the stack change**

In `services/investor/onboarding-bff/src/service.stack.ts` line 83, change:

```typescript
      idleTimeout: Duration.minutes(5),
```

to:

```typescript
      idleTimeout: Duration.seconds(30),
```

Leave line 84 (`maxLifetime: Duration.hours(1)`) unchanged unless §7 explicitly noted that M2 evidence justified the companion adjustment.

- [ ] **Step 4: Run the test to verify it PASSES**

```bash
pnpm nx run onboarding-bff:test -- --testNamePattern="idleTimeout=30s for sandbox" 2>&1 | tail -10
```

Expected: PASS.

- [ ] **Step 5: Run the full onboarding-bff unit suite to catch regressions**

```bash
pnpm nx run onboarding-bff:test 2>&1 | tail -30
```

Expected: all tests pass. If a snapshot test breaks because it captured the old `IdleSessionTimeout`, regenerate with `pnpm nx run onboarding-bff:test -- -u`.

- [ ] **Step 6: Commit**

```bash
git add services/investor/onboarding-bff/src/service.stack.ts services/investor/onboarding-bff/test/unit/service.stack.test.ts
git commit -m "$(cat <<'EOF'
fix(onboarding-bff): tighten AgentRuntime idleTimeout 5min → 30s for dev maxVms friendliness

Per Case A of playwright-rebalance-real-agents-maxvms-remediation spec
§4. M2 measurement (see §6 of the spec) showed onboarding-bff dominated
the journey's peak concurrent sessions; tightening the idle window
releases micro-VMs faster between wizard phases without affecting the
user's per-phase warm-session experience (each phase completes in
5-15s, well under 30s).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Implement Case B (part 1) — portfolio-engine-ctrl expectedBurstSize cap

**SKIP this task** if Case B was not selected. Continue to Task 11 if Case B; otherwise Task 12.

**Files:**
- Modify: `services/advisory/portfolio-engine-ctrl/src/service.stack.ts:45`
- Modify: `services/advisory/portfolio-engine-ctrl/test/unit/service.stack.test.ts`

- [ ] **Step 1: Add a failing CDK assertion test**

Append to `services/advisory/portfolio-engine-ctrl/test/unit/service.stack.test.ts` inside the outer `describe`:

```typescript
  it('caps PE ingress sqsMaxConcurrency to 1 in sandbox via expectedBurstSize=4', () => {
    const sources = template.findResources('AWS::Lambda::EventSourceMapping');
    const sqsMapping = Object.values(sources).find((m: any) =>
      m.Properties?.EventSourceArn && String(m.Properties.FunctionName).match(/Ingress|ingress/i),
    ) as { Properties: { ScalingConfig?: { MaximumConcurrency?: number } } } | undefined;
    expect(sqsMapping).toBeDefined();
    expect(sqsMapping!.Properties.ScalingConfig?.MaximumConcurrency).toBe(1);
  });
```

- [ ] **Step 2: Run the test to verify it FAILS**

```bash
pnpm nx run portfolio-engine-ctrl:test -- --testNamePattern="caps PE ingress sqsMaxConcurrency" 2>&1 | tail -20
```

Expected: FAIL — current `expectedBurstSize=40` derives `MaximumConcurrency=10`.

- [ ] **Step 3: Make the stack change**

In `services/advisory/portfolio-engine-ctrl/src/service.stack.ts` line 45, change:

```typescript
        expectedBurstSize: 40,
```

to:

```typescript
        expectedBurstSize: 4,
```

The `agentProfile()` invariant at synth time will re-derive `sqsMaxConcurrency = ceil(4 × 29000/1000 / 120) = ceil(0.967) = 1`. Visibility timeout invariant: `visibilitySec = (ceil(29 × 1.5) + 5) × 4 = 49 × 4 = 196 ≤ uxBudgetSeconds × 2 = 240`. PASSES.

- [ ] **Step 4: Run the test to verify it PASSES**

```bash
pnpm nx run portfolio-engine-ctrl:test -- --testNamePattern="caps PE ingress sqsMaxConcurrency" 2>&1 | tail -10
```

Expected: PASS.

- [ ] **Step 5: Run the full PE unit suite to catch regressions**

```bash
pnpm nx run portfolio-engine-ctrl:test 2>&1 | tail -30
```

Expected: all tests pass. Update snapshots if any drift via `-u`.

- [ ] **Step 6: Commit**

```bash
git add services/advisory/portfolio-engine-ctrl/src/service.stack.ts services/advisory/portfolio-engine-ctrl/test/unit/service.stack.test.ts
git commit -m "$(cat <<'EOF'
fix(portfolio-engine-ctrl): cap sandbox expectedBurstSize 40→4 to serialize agent invocations

Per Case B of playwright-rebalance-real-agents-maxvms-remediation spec
§4. M2 measurement showed PE+AN dominated the journey's peak concurrent
sessions; lowering expectedBurstSize re-derives the SQS ESM
sqsMaxConcurrency from 10 → 1 via the agentProfile() helper invariant.
Forces serial agent invocation across the whole sandbox account. NOT
to ship to prod — sandbox-only adjustment.

Three-knob invariant still holds: visibilityTimeoutSec = 196 ≤
uxBudgetSeconds × 2 = 240.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Implement Case B (part 2) — advisory-narrative-ctrl expectedBurstSize cap

**SKIP this task** if Case B was not selected.

**Files:**
- Modify: `services/advisory/advisory-narrative-ctrl/src/service.stack.ts:36`
- Modify: `services/advisory/advisory-narrative-ctrl/test/unit/service.stack.test.ts`

- [ ] **Step 1: Add a failing CDK assertion test**

Append to `services/advisory/advisory-narrative-ctrl/test/unit/service.stack.test.ts` inside the outer `describe`:

```typescript
  it('caps AN ingress sqsMaxConcurrency to 2 in sandbox via expectedBurstSize=4', () => {
    const sources = template.findResources('AWS::Lambda::EventSourceMapping');
    const sqsMapping = Object.values(sources).find((m: any) =>
      m.Properties?.EventSourceArn && String(m.Properties.FunctionName).match(/Ingress|ingress/i),
    ) as { Properties: { ScalingConfig?: { MaximumConcurrency?: number } } } | undefined;
    expect(sqsMapping).toBeDefined();
    expect(sqsMapping!.Properties.ScalingConfig?.MaximumConcurrency).toBe(2);
  });
```

- [ ] **Step 2: Run the test to verify it FAILS**

```bash
pnpm nx run advisory-narrative-ctrl:test -- --testNamePattern="caps AN ingress sqsMaxConcurrency" 2>&1 | tail -20
```

Expected: FAIL — current `expectedBurstSize=40` derives `MaximumConcurrency=12`.

- [ ] **Step 3: Make the stack change**

In `services/advisory/advisory-narrative-ctrl/src/service.stack.ts` line 36, change:

```typescript
        expectedBurstSize: 40,
```

to:

```typescript
        expectedBurstSize: 4,
```

`agentProfile()` re-derives `sqsMaxConcurrency = ceil(4 × 35/120) = ceil(1.167) = 2`. Visibility: `(ceil(35 × 1.5) + 5) × 4 = 58 × 4 = 232 ≤ 240`. PASSES.

- [ ] **Step 4: Run the test to verify it PASSES**

```bash
pnpm nx run advisory-narrative-ctrl:test -- --testNamePattern="caps AN ingress sqsMaxConcurrency" 2>&1 | tail -10
```

Expected: PASS.

- [ ] **Step 5: Run the full AN unit suite**

```bash
pnpm nx run advisory-narrative-ctrl:test 2>&1 | tail -30
```

- [ ] **Step 6: If §7 of the spec called for AN sqsMaxConcurrency=1 (not 2)**

Only if §7's selected mechanism explicitly said "lower AN to expectedBurstSize=3 to reach maxConcurrency=1": redo Steps 1-5 with `3` instead of `4` and `1` instead of `2`. `agentProfile()` re-derives `ceil(3 × 35/120) = ceil(0.875) = 1`. Visibility unchanged.

- [ ] **Step 7: Commit**

```bash
git add services/advisory/advisory-narrative-ctrl/src/service.stack.ts services/advisory/advisory-narrative-ctrl/test/unit/service.stack.test.ts
git commit -m "$(cat <<'EOF'
fix(advisory-narrative-ctrl): cap sandbox expectedBurstSize 40→4 to serialize agent invocations

Companion to portfolio-engine-ctrl ship — Case B of
playwright-rebalance-real-agents-maxvms-remediation spec §4. Re-derives
sqsMaxConcurrency 12 → 2 via agentProfile() helper. NOT to ship to
prod — sandbox-only.

Three-knob invariant still holds: visibilityTimeoutSec = 232 ≤
uxBudgetSeconds × 2 = 240.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 3 — Speculative test deletion

### Task 12: Verify and delete the speculative rebalance scenario + fixture

**Files:**
- Delete: `apps/nestfolio-e2e/src/scenarios/rebalance-trades-on-drift.spec.ts`
- Delete: `apps/nestfolio-e2e/src/fixtures/inject-portfolio-updated.ts`

- [ ] **Step 1: Verify the fixture has no other consumer**

```bash
grep -rn "inject-portfolio-updated\|injectPortfolioUpdated" apps/ services/ libs/ --include="*.ts" --include="*.tsx" 2>&1
```

Expected: only `apps/nestfolio-e2e/src/scenarios/rebalance-trades-on-drift.spec.ts:4` (the import) and `apps/nestfolio-e2e/src/fixtures/inject-portfolio-updated.ts` itself. If any third file appears, STOP and surface to user — the deletion would break another test.

- [ ] **Step 2: Verify the scenario has no other importer**

```bash
grep -rn "rebalance-trades-on-drift" apps/ services/ libs/ docs/ --include="*.ts" --include="*.tsx" --include="*.json" --include="*.md" 2>&1
```

Expected: only the file itself + dossier references in `docs/backlog/`. If a Playwright config or sharding manifest references it explicitly, note that for the deletion commit.

- [ ] **Step 3: Capture the file SHA for the parking dossier**

```bash
git log -1 --format="%H" -- apps/nestfolio-e2e/src/scenarios/rebalance-trades-on-drift.spec.ts
```

Expected: a SHA. Save it — needed in Task 14 for the parking dossier body.

- [ ] **Step 4: Delete both files**

```bash
git rm apps/nestfolio-e2e/src/scenarios/rebalance-trades-on-drift.spec.ts apps/nestfolio-e2e/src/fixtures/inject-portfolio-updated.ts
```

- [ ] **Step 5: Run the nestfolio-e2e build to ensure no broken imports**

```bash
pnpm nx run nestfolio-e2e:lint 2>&1 | tail -10
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git commit -m "$(cat <<'EOF'
chore(nestfolio-e2e): delete speculative rebalance scenario — no production weight-drift trigger

Per playwright-rebalance-real-agents-maxvms-remediation spec §1+§5.
reconciliation-ctrl only detects Intent-vs-Settlement drift (broker
partial-fill/error), NOT weight-vs-target drift — so PORTFOLIO_DRIFT_DETECTED
has no production emitter on the user-driven path. The scenario was
testing speculative infrastructure via synthetic injection.

The DWC reactive code path (SF starts on PORTFOLIO_DRIFT_DETECTED,
PE+AN produce a rebalance decision) is already covered by unit +
integration tests for decision-workflow-ctrl. The Playwright coverage
will be re-instated by the parking dossier
playwright-rebalance-after-weight-drift-detector once the production
detector ships (filed in next commit).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 4 — Follow-up dossiers (§5 of spec)

### Task 13: File `weight-drift-detector` dossier (queued)

**Files:**
- Create: `docs/backlog/weight-drift-detector.md`
- Auto-regen: `docs/BACKLOG.md`

- [ ] **Step 1: Use the backlog-add skill**

Invoke the project's `backlog-add` skill (defined in `.claude/skills/backlog-add/`). Provide the following parameters:

- id: `weight-drift-detector`
- status: `queued` (overriding the default `parking`)
- type: `design`
- notes: `"reconciliation-ctrl only detects Intent-vs-Settlement drift (broker partial-fill / broker error). No service detects weight-vs-target drift — the kind of drift that motivates a rebalance. DWC SF correctly REACTS to PORTFOLIO_DRIFT_DETECTED, but no production code emits the event from a user-driven path. Surfaced 2026-05-27 during playwright-rebalance-real-agents-maxvms-remediation."`

The skill will create the file with proper frontmatter and run `backlog-lint --fix`.

- [ ] **Step 2: Populate the body of the dossier**

After the skill creates the file, append the body content. Edit `docs/backlog/weight-drift-detector.md` and replace any auto-generated body with:

```markdown
# weight-drift-detector

## What's missing
The system has the rebalance code path (DWC SF starts on PORTFOLIO_DRIFT_DETECTED,
PE+AN produce a rebalance decision, advisory-bff projects it, /advisory renders
the trades) but no producer of PORTFOLIO_DRIFT_DETECTED on the weight-deviation
axis. reconciliation-ctrl exists but its scope is Intent-vs-Settlement (catches
broker errors), not target-weight-vs-current-weight (would catch price drift,
deposit-driven imbalance, etc.).

## Open questions for design (when this is brainstormed)
1. Where does the detector live?
   - (a) Extend reconciliation-ctrl with a second reconciler comparing
         currentWeights vs targetWeights from mandate.
   - (b) New service (advisory or ledger domain) dedicated to weight-drift.
   - (c) Move into advisory-bff as a derived projection.
2. What triggers the check?
   - Subscribe to LedgerSnapshot CDC + MarketSnapshot CDC (recompute on
     either positions change or price change).
   - Periodic timer (cron-driven sweep).
3. What's the threshold contract? Per-instrument vs portfolio-level?
4. How does the detector debounce (avoid emitting PORTFOLIO_DRIFT_DETECTED
   on every tick when the market is moving)?
5. Does it emit per-tenant or per-portfolio?

## Why this is queued (not parking)
Per [[feedback-e2e-gaps-queued-not-parking]]: this blocks the future
re-instatement of a UI-driven rebalance Playwright scenario. Litmus:
without this, rebalance can never be exercised organically end-to-end.

## Related
- Parent: playwright-rebalance-real-agents-maxvms-remediation (the discovery)
- Will block: playwright-rebalance-after-weight-drift-detector (parking)
```

Also fill the `references:` frontmatter (the skill may leave it empty):

```yaml
references:
  - path: services/ledger/reconciliation-ctrl/src/handlers/event-listener.ts
  - path: services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts
  - path: services/ledger/reconciliation-ctrl/src/domain/events.ts
```

- [ ] **Step 3: Re-run backlog-lint --fix**

```bash
node .claude/skills/backlog-lint/lint.mjs --fix 2>&1 | tail -10
```

Expected: `✓ <N> backlog files; all 8 rules pass`.

- [ ] **Step 4: Commit**

```bash
git add docs/backlog/weight-drift-detector.md docs/BACKLOG.md
git commit -m "docs(backlog): add weight-drift-detector — production feature gap

Surfaced 2026-05-27 during playwright-rebalance-real-agents-maxvms-remediation
brainstorming. reconciliation-ctrl only handles Intent-vs-Settlement;
no service detects weight-vs-target drift. Filed queued (not parking)
per feedback-e2e-gaps-queued-not-parking — blocks the future
re-instatement of UI-driven rebalance Playwright coverage.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 14: File `playwright-rebalance-after-weight-drift-detector` dossier (parking)

**Files:**
- Create: `docs/backlog/playwright-rebalance-after-weight-drift-detector.md`
- Auto-regen: `docs/BACKLOG.md`

- [ ] **Step 1: Invoke backlog-add skill**

Parameters:
- id: `playwright-rebalance-after-weight-drift-detector`
- status: `parking` (the default — properly parking with explicit trigger language per rule 8)
- type: `tooling`
- notes: `"Re-add Playwright rebalance coverage on top of a real organic trigger once weight-drift-detector ships. The scenario was deleted 2026-05-27 in playwright-rebalance-real-agents-maxvms-remediation because it tested a speculative production feature."`

- [ ] **Step 2: Populate the body**

Edit the created file and replace any auto-body with:

```markdown
# playwright-rebalance-after-weight-drift-detector

## Promotion trigger
Promote to QUEUED when weight-drift-detector ships (status: shipped).
At that point the production code can emit PORTFOLIO_DRIFT_DETECTED
from a real path (e.g., second deposit changes weights enough → detector
fires → DWC SF starts → rebalance decision). Until then this is parking
per backlog rule 8 (parking entries carry unmet trigger language).

## What to do when promoted
Most likely shape: extend journeys/new-investor-happy-path.spec.ts with
a second-deposit + wait-for-organic-rebalance arm, rather than
re-introducing a scenarios/ file with synthetic injection. Matches
the journeys/scenarios philosophy in apps/nestfolio-e2e/CLAUDE.md.
But the actual shape is a design decision for that future workstream —
this is just a placeholder.

## Original test location (deleted)
- File: apps/nestfolio-e2e/src/scenarios/rebalance-trades-on-drift.spec.ts
- Fixture: apps/nestfolio-e2e/src/fixtures/inject-portfolio-updated.ts
- Last seen at SHA: <SHA from Task 12 Step 3>

## Related
- Blocked by: weight-drift-detector
- Origin: playwright-rebalance-real-agents-maxvms-remediation
```

Replace `<SHA from Task 12 Step 3>` with the actual SHA you captured.

Update `references:` frontmatter:

```yaml
references:
  - path: docs/backlog/weight-drift-detector.md
  - path: docs/backlog/playwright-rebalance-real-agents-maxvms-remediation.md
```

- [ ] **Step 3: Re-run backlog-lint --fix**

```bash
node .claude/skills/backlog-lint/lint.mjs --fix 2>&1 | tail -10
```

Expected: PASS. The parking body MUST contain the trigger word "Promote when" or "Promote once" — rule 8 enforces that parking entries carry trigger language.

- [ ] **Step 4: Commit**

```bash
git add docs/backlog/playwright-rebalance-after-weight-drift-detector.md docs/BACKLOG.md
git commit -m "docs(backlog): add playwright-rebalance-after-weight-drift-detector (parking)

Filed parking with explicit promotion trigger 'promote when
weight-drift-detector ships' per backlog rule 8. Captures the
re-instatement plan for UI-driven rebalance Playwright coverage
once a real organic PORTFOLIO_DRIFT_DETECTED emitter exists.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 5 — Dossier rewrite (Option A from §1 of spec)

### Task 15: Rewrite current dossier — title, Origin, Done Definition, add Reframe history

**Files:**
- Modify: `docs/backlog/playwright-rebalance-real-agents-maxvms-remediation.md`

- [ ] **Step 1: Re-read the current dossier**

```bash
cat docs/backlog/playwright-rebalance-real-agents-maxvms-remediation.md
```

The frontmatter (status: active, out_of_scope filled) was committed during adoption. The body still reflects the original rebalance-scenario framing. The rewrite preserves the frontmatter but replaces the body and updates the `notes:` field.

- [ ] **Step 2: Update the frontmatter `notes:` field**

Use the Edit tool to change the `notes:` field to:

```yaml
notes: "AgentCore maxVms remediation for the journeys (new-investor-happy-path + deposit-reload-mid-flight). Originally framed as 'make the rebalance Playwright scenario pass with real agents'; reframed 2026-05-27 when brainstorming revealed (a) reconciliation-ctrl only detects Intent-vs-Settlement drift, so PORTFOLIO_DRIFT_DETECTED has no production emitter on the user-driven path, and (b) the journeys already exercise the deposit→build chain with real agents. Workstream now: measurement-first maxVms remediation + delete the speculative rebalance scenario + file weight-drift-detector follow-up."
```

- [ ] **Step 3: Replace the body**

After the frontmatter `---` closing line, replace the entire body with:

```markdown
# AgentCore maxVms remediation for Playwright journeys (formerly: rebalance real-agents)

## Goal (current)

Make `apps/nestfolio-e2e/src/journeys/new-investor-happy-path.spec.ts` and
`apps/nestfolio-e2e/src/journeys/deposit-reload-mid-flight.spec.ts` pass 2×
consecutively against deployed dev, cost-positive (or neutral) for the dev
account. Mechanism is measurement-driven — see the decision tree in the
spec at `docs/superpowers/specs/2026-05-27-playwright-rebalance-real-agents-maxvms-remediation-design.md`.

## What ships in this workstream

1. Measurement pass (M1-M6) against deployed dev, results in spec §6.
2. Mechanism chosen by spec §4 decision tree (likely Case A: tighten
   `onboarding-bff` idleTimeout, or Case B: cap PE/AN `expectedBurstSize`
   to derive `sqsMaxConcurrency=1` in sandbox).
3. Deletion of `apps/nestfolio-e2e/src/scenarios/rebalance-trades-on-drift.spec.ts`
   and `apps/nestfolio-e2e/src/fixtures/inject-portfolio-updated.ts` —
   speculative coverage of a production feature that doesn't exist.
4. Two follow-up dossiers: `weight-drift-detector` (queued, production
   feature gap) and `playwright-rebalance-after-weight-drift-detector`
   (parking, the re-instatement plan).

## Done definition

- Both journeys PASS 2× consecutively against deployed dev, no rerun-
  after-fail tolerated. Flake handling per [[feedback-flake-means-broken]]
  and spec §8.
- Post-fix M3 + M4 re-measured and recorded in `validation_gate:` —
  cost-positive or cost-neutral per spec §4 quaternary branch.
- Speculative rebalance scenario + fixture deleted.
- Two follow-up dossiers filed and linted.

## Reframe history

**Original framing (filed 2026-05-26):** "Playwright rebalance-trades-on-drift.spec.ts
must run real agents per [[feedback-e2e-no-external-mocks]] (no stub
allowed) but is structurally blocked by AgentCore maxVms saturation
timing out PE at 120s. ... Order recommended at brainstorming: C → A → D,
with E held as the closer."

**Why that framing was wrong (surfaced 2026-05-27 during /backlog-next
brainstorming):**

1. **Production-feature gap.** The rebalance scenario's
   `PORTFOLIO_DRIFT_DETECTED` synthetic injection models a production
   feature that doesn't exist. Investigation of `reconciliation-ctrl`
   (the only existing producer of the event) showed it only detects
   Intent-vs-Settlement drift (broker errors), not weight-vs-target
   drift (the kind that motivates a rebalance). So no UI-driven flow
   could organically fire `PORTFOLIO_DRIFT_DETECTED` no matter how
   much resilience we add. The dossier's Part 3 ("synthetic injections
   removed or replaced with real user flow") was therefore impossible
   without first building the missing detector.

2. **Existing journey coverage.** The brainstorming surfaced that
   `journeys/new-investor-happy-path.spec.ts` already exercises the
   deposit → initial-portfolio-build chain end-to-end with real
   agents (lines 122-179). The right stabilization surface is the
   journeys, not a parallel scenarios/ test that synthesizes events
   the production system can't yet emit.

**The reframe:** workstream becomes "fix the maxVms saturation so the
journeys pass deterministically." The rebalance Playwright coverage is
deferred to a parking dossier triggered by the (newly filed) production
feature dossier.

**The discipline this depended on:**
- [[feedback-measure-before-proposing]] — original framing pre-committed
  to a candidate ordering (C → A → D) without measurement; the reframe
  pivoted to a decision-tree driven by M1-M6 outcomes recorded in spec
  §6 + §7.
- [[feedback-verify-before-documenting]] — the reframe was triggered
  by checking `services/ledger/reconciliation-ctrl/src/handlers/event-listener.ts`
  in code rather than trusting the dossier's "drift detection chain"
  framing.

## Related

- Spec: `docs/superpowers/specs/2026-05-27-playwright-rebalance-real-agents-maxvms-remediation-design.md`
- Plan: `docs/superpowers/plans/2026-05-27-playwright-rebalance-real-agents-maxvms-remediation.md`
- Filed by this workstream: `weight-drift-detector` (queued),
  `playwright-rebalance-after-weight-drift-detector` (parking)
- Cost-context: `agentcore-maxvms-prod-quota-increase` (LATER, prod-scoped)
- Already shipped: `agentcore-invocation-resilience`,
  `agentcore-maxvms-browser-path-resilience`
```

- [ ] **Step 4: Verify backlog-lint still passes**

```bash
node .claude/skills/backlog-lint/lint.mjs --fix 2>&1 | tail -10
```

Expected: PASS. The dossier still has `status: active` (set during adoption); the rewrite only changes body + notes.

- [ ] **Step 5: Commit**

```bash
git add docs/backlog/playwright-rebalance-real-agents-maxvms-remediation.md docs/BACKLOG.md
git commit -m "$(cat <<'EOF'
docs(backlog): reframe playwright-rebalance-real-agents-maxvms-remediation

Workstream now targets journey maxVms remediation (not the rebalance
scenario, which was deleted as speculative). Original framing kept in
## Reframe history section for traceability. ID preserved (Option A of
spec §1) — file IDs are stable handles; bodies evolve.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 6 — Deploy + validate (§8 of spec)

### Task 16: Deploy affected services to dev

**Files:** none modified (AWS-side action only).

- [ ] **Step 1: Determine which services to deploy**

Based on §7 of the spec:
- Case A → `--services=onboarding-bff`
- Case B → `--services=portfolio-engine-ctrl,advisory-narrative-ctrl`
- Case A+B → `--services=onboarding-bff,portfolio-engine-ctrl,advisory-narrative-ctrl`
- NO-OP or C → skip this task entirely.

- [ ] **Step 2: Run the deploy**

```bash
bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=<from-step-1> 2>&1 | tee /tmp/deploy-maxvms.log
```

Expected: each service synthesizes, bundles, and deploys without error. AgentRuntime services additionally rebuild ARM64 Docker → ECR push → AgentCore runtime update as one unit (handled by the script).

- [ ] **Step 3: Verify the deploy log shows the expected updates**

```bash
grep -E "✅|FAILED|UPDATE_COMPLETE|UPDATE_FAILED" /tmp/deploy-maxvms.log | tail -20
```

Expected: all stacks `UPDATE_COMPLETE`, no `UPDATE_FAILED`. Save the relevant stack-update timestamp line — it goes into `validation_gate:` later.

- [ ] **Step 4: Verify the CDK property landed in CloudFormation**

For Case A:

```bash
aws cloudformation describe-stack-resource --stack-name dev-onboarding-bff --logical-resource-id $(aws cloudformation list-stack-resources --stack-name dev-onboarding-bff --query 'StackResourceSummaries[?ResourceType==`AWS::BedrockAgentCore::Runtime`].LogicalResourceId' --output text) --query 'StackResourceDetail.Metadata' --output text
```

For Case B (per service):

```bash
for svc in portfolio-engine-ctrl advisory-narrative-ctrl; do
  echo "=== dev-$svc ==="
  aws lambda get-event-source-mapping --uuid $(aws lambda list-event-source-mappings --function-name dev-${svc}-ingress --query 'EventSourceMappings[0].UUID' --output text) --query 'ScalingConfig'
done
```

Expected: `MaximumConcurrency: 1` (PE) or `2` (AN — or `1` if §7 chose `expectedBurstSize=3`).

---

### Task 17: First validation pair

**Files:** none modified (Playwright execution + log capture only).

- [ ] **Step 1: Run new-investor-happy-path once**

```bash
pnpm nx run nestfolio-e2e:e2e -- --grep "new-investor-happy-path" --reporter=list 2>&1 | tee /tmp/val1-nihp.log
```

Expected: PASS. Record the test duration.

- [ ] **Step 2: Run deposit-reload-mid-flight once**

```bash
pnpm nx run nestfolio-e2e:e2e -- --grep "deposit reload mid-flight" --reporter=list 2>&1 | tee /tmp/val1-drmf.log
```

Expected: PASS.

- [ ] **Step 3: If either FAILED, pull CloudWatch evidence from the failure window**

Skip if both passed.

```bash
# For each failed run, extract the wall-clock window and pull PE/AN/onboarding-bff logs
WINDOW_START=<test start time, ISO>
WINDOW_END=<test end time, ISO>
for lg in /aws/lambda/dev-portfolio-engine-ctrl-PE /aws/lambda/dev-advisory-narrative-ctrl-AN /aws/lambda/dev-onboarding-bff; do
  aws logs filter-log-events --log-group-name "$lg" --start-time $(date -d "$WINDOW_START" +%s)000 --end-time $(date -d "$WINDOW_END" +%s)000 --filter-pattern "ServiceQuotaExceeded TaskTimedOut" --output json > /tmp/val1-cw-$(basename $lg).json
done
```

Append a `## Flake investigation` section to the spec with the evidence, then proceed to Task 18 only after running a confirmation pair (per spec §8 second bullet).

If either run failed even after the confirmation pair → STOP, mechanism was wrong. Revert the mechanism commits, re-run §4 decision tree with the new evidence (likely escalate Case A → A+B), repeat Phase 2 from Task 8.

---

### Task 18: Second validation pair (the flake gate)

**Files:** none modified.

- [ ] **Step 1: Re-run new-investor-happy-path**

```bash
pnpm nx run nestfolio-e2e:e2e -- --grep "new-investor-happy-path" --reporter=list 2>&1 | tee /tmp/val2-nihp.log
```

Expected: PASS.

- [ ] **Step 2: Re-run deposit-reload-mid-flight**

```bash
pnpm nx run nestfolio-e2e:e2e -- --grep "deposit reload mid-flight" --reporter=list 2>&1 | tee /tmp/val2-drmf.log
```

Expected: PASS.

- [ ] **Step 3: Verify the flake gate**

If all four runs across Tasks 17-18 PASSED first-try → gate met, proceed to Task 19.

If any flake-then-pass occurred → run a third confirmation pair per spec §8 second bullet. Original failure stays recorded as evidence the system still flakes; the confirmation pair must be first-try-green for both tests.

If after the confirmation pair a flake persists → mechanism is insufficient. Revert + escalate per Task 17 Step 3 fallback.

---

### Task 19: Post-fix M3 + M4 re-measurement (quaternary branch)

**Files:**
- Modify: `docs/superpowers/specs/2026-05-27-playwright-rebalance-real-agents-maxvms-remediation-design.md` (populate §8 validation gate)

The spec asks for re-measurement ≥ 24h post-deploy. If that's not practical, take the 1-2h snapshot and note the window in the spec.

- [ ] **Step 1: Re-run M3 query (post-fix window)**

Same query as Task 3 Step 2, but with `--start-time` = deploy timestamp from Task 16:

```bash
DEPLOY_TS=<unix timestamp of deploy completion from Task 16>
QUERY_ID=$(aws logs start-query \
  --log-group-names $(cat /tmp/m3-log-groups.txt | tr '\n' ' ') \
  --start-time $DEPLOY_TS --end-time $(date +%s) \
  --query-string 'fields @timestamp, @log, @message | filter @message like /ServiceQuotaExceeded/ | stats count() by @log' \
  --query 'queryId' --output text)
# (poll loop as in Task 3 Step 3)
aws logs get-query-results --query-id "$QUERY_ID" --output table 2>&1 | tee /tmp/m3-post.txt
```

Expected: count significantly lower than the §6 baseline (ideally 0).

- [ ] **Step 2: Re-run M4 query (post-fix window)**

Same as Task 4 Step 3, with the post-deploy window. Save to `/tmp/m4-post.txt`.

- [ ] **Step 3: Classify cost-positive vs cost-neutral**

Per spec §4 quaternary branch:
- M3 OR M4 dropped to 0 → cost-positive verified.
- M3 + M4 unchanged but journeys pass → cost-neutral (acceptable).
- M3 + M4 INCREASED → backfire; revert per Task 17 Step 3 fallback.

- [ ] **Step 4: Populate §8 of the spec**

Replace "_To be populated with concrete commit SHAs..._" with:

```markdown
**Validation: PASS (<cost-positive | cost-neutral>)**

- Mechanism commit SHA(s): <list from Tasks 9-11>
- Deploy log line confirming success: <from /tmp/deploy-maxvms.log>
- Run identifiers (all PASS first-try):
  - val1-nihp: <duration>s
  - val1-drmf: <duration>s
  - val2-nihp: <duration>s
  - val2-drmf: <duration>s
- M3 baseline → post-fix delta: <baseline>/30d → <post-fix>/<post-window>
- M4 baseline → post-fix delta: <baseline>/30d → <post-fix>/<post-window>
- Classification: <cost-positive: M<3|4> dropped to zero | cost-neutral: residual saturation but journeys deterministic>
```

(If a `## Flake investigation` section was added in Task 17 Step 3, leave it in place.)

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-05-27-playwright-rebalance-real-agents-maxvms-remediation-design.md
git commit -m "docs(spec): populate §8 validation gate with run evidence + post-fix M3/M4

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 7 — Ship + close

### Task 20: Ship the backlog file

**Files:**
- Modify: `docs/backlog/playwright-rebalance-real-agents-maxvms-remediation.md` (frontmatter only)

- [ ] **Step 1: Update frontmatter**

Use the Edit tool to change `status: active` → `status: shipped`. Fill `validation_gate:` with:

```yaml
validation_gate: |
  Both journeys (new-investor-happy-path + deposit-reload-mid-flight)
  PASS 2× consecutively, first-try, against deployed dev. Run identifiers:
  val1-nihp (<duration>s), val1-drmf (<duration>s), val2-nihp (<duration>s),
  val2-drmf (<duration>s). Mechanism commit(s): <SHA list>. Deploy:
  <deploy timestamp from /tmp/deploy-maxvms.log>. Cost classification:
  <cost-positive: M<3|4> baseline=<N>/30d → post=<M>/<window> | cost-neutral>.
  Spec §8 has the full evidence.
```

Add `spec:` and `plan:` paths to the frontmatter:

```yaml
spec: docs/superpowers/specs/2026-05-27-playwright-rebalance-real-agents-maxvms-remediation-design.md
plan: docs/superpowers/plans/2026-05-27-playwright-rebalance-real-agents-maxvms-remediation.md
```

- [ ] **Step 2: Verify backlog-lint passes**

```bash
node .claude/skills/backlog-lint/lint.mjs --fix 2>&1 | tail -10
```

Expected: PASS. Rule 5 requires `validation_gate` non-empty on shipped — verified.

- [ ] **Step 3: Commit**

```bash
git add docs/backlog/playwright-rebalance-real-agents-maxvms-remediation.md docs/BACKLOG.md
git commit -m "docs(backlog): ship playwright-rebalance-real-agents-maxvms-remediation

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 21: Regen service cards (Case B only)

**SKIP this task** if Case A only was applied (no service-card impact).

**Files:**
- Modify: `services/advisory/portfolio-engine-ctrl/CLAUDE.md`
- Modify: `services/advisory/advisory-narrative-ctrl/CLAUDE.md`

- [ ] **Step 1: Invoke audit-service for portfolio-engine-ctrl**

Use the project's `audit-service` skill (defined in `.claude/skills/audit-service/`). Pass:
- service path: `services/advisory/portfolio-engine-ctrl`

The skill verifies + regenerates the service card. If it reports the existing card is still accurate (e.g., no concurrency knobs surface in the card today), no edit is needed.

- [ ] **Step 2: Invoke audit-service for advisory-narrative-ctrl**

Same as Step 1 with `services/advisory/advisory-narrative-ctrl`.

- [ ] **Step 3: Commit any card updates**

```bash
git add services/advisory/portfolio-engine-ctrl/CLAUDE.md services/advisory/advisory-narrative-ctrl/CLAUDE.md
git diff --cached --quiet || git commit -m "docs(services): regen PE+AN cards after sandbox expectedBurstSize cap

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

(If `git diff --cached` is empty, the cards didn't need updating — skip the commit.)

---

### Task 22: finishing-a-development-branch + ExitWorktree + postflight

**Files:** none modified directly (skill drives merge + cleanup).

- [ ] **Step 1: Invoke finishing-a-development-branch**

Use the `superpowers:finishing-a-development-branch` skill. The skill will:
1. Verify the worktree branch is clean and ahead of main.
2. Pick merge strategy (squash vs FF) based on commit history.
3. Run `gh pr create` + `gh pr merge` OR direct merge for the local-only case.
4. Delete the feature branch after merge.

Do NOT run `gh pr create` + `gh pr merge` manually — the skill handles ordering and edge cases.

- [ ] **Step 2: Verify the feature branch's commits are ancestors of main**

```bash
git fetch origin main
git merge-base --is-ancestor worktree-playwright-rebalance-real-agents-maxvms-remediation origin/main && echo "OK: all commits in main" || echo "BAD: feature branch has commits not on main"
```

Expected: `OK`. If `BAD`, do NOT proceed to Step 3 — the merge is incomplete.

- [ ] **Step 3: ExitWorktree with discard_changes**

Use the ExitWorktree tool with `action: remove` and `discard_changes: true`. The harness will warn about "discarding N commits permanently"; this is expected after a clean merge (the commits' content is on main; the branch is just unreachable as a distinct tip). Verified by Step 2.

- [ ] **Step 4: Run postflight**

```bash
node .claude/skills/backlog-next/postflight.mjs --lane=complex --branch=worktree-playwright-rebalance-real-agents-maxvms-remediation
```

Expected: `✓ Postflight passed`. If it fails (dirty tree, branch not deleted, stale worktree), fix the surfaced issue and re-run before declaring done.

---

## Self-review notes

- **Spec coverage:** Every section §1-§9 of the spec maps to at least one task (§3 → Tasks 1-7; §4 + §7 → Task 8; §4 Case A → Task 9; §4 Case B → Tasks 10-11; §1 deletion + §9 step 3 → Task 12; §5 → Tasks 13-14; §1 dossier housekeeping + §9 step 5 → Task 15; §9 step 6 + §8 → Tasks 16-19; §9 steps 8-12 → Tasks 20-22).
- **Placeholder scan:** All `<from-step-N>` / `<duration>` / `<SHA>` markers in the spec/plan commit messages and dossier bodies are EXPLICITLY noted as runtime substitutions, not unfilled placeholders. The implementing agent fills them from measurement output.
- **Type consistency:** `sqsMaxConcurrency` (CDK lib name) vs `MaximumConcurrency` (CloudFormation property) — both used correctly in their respective contexts. `expectedBurstSize` (helper input) vs `agentLatencyP90Ms` (other helper input) — naming consistent across Tasks 8/10/11.
- **Branching:** Case-conditional tasks (9, 10, 11, 21) have explicit "SKIP this task if..." headers so the executor doesn't accidentally apply the wrong mechanism.
