# AssemblePacket agent-output key rename — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix `services/advisory/decision-workflow-ctrl/src/handlers/assemble-packet.ts` to read the post-Phase-A agent-output shape (`portfolio.allocations.{allocations,totalExposure}`) instead of the obsolete node-keyed shape (`portfolio['portfolio-construction'].{allocations,totalExposure}`). Restores non-empty `proposedTrades` in DecisionPacket rows produced by the SF.

**Architecture:** Phase A (commit `676dd75c`, 2026-05-14) migrated inter-agent handoff to Step Functions state. `services/advisory/portfolio-engine-ctrl/src/agent-service.ts:146-151` returns `{ decisionId, allocations, trades, metadata }` at top level (renaming the LangGraph node-keyed `portfolio-construction`/`rebalance-planner` outputs to semantic names). The SF plumbs that return value as `agentOutput` into AssembleDecisionPacket via Parameters. The handler was not updated to match — it still reads the obsolete node-keyed path, so `allocationsArray = []` and `proposedTrades = []` every run.

**Tech Stack:** TypeScript, Jest (`ts-jest`, ESM), Nx targets (`test`, `lint`, `typecheck`), CDK NodejsFunction bundling, `bash infrastructure/scripts/deploy.sh`, AWS dev account 771924376645.

**Workstream backlog:** [`docs/backlog/e2e-advisory-pipeline-empty-outputs-post-phase-b.md`](../backlog/e2e-advisory-pipeline-empty-outputs-post-phase-b.md) — QUEUED rank 1.

**Out of scope:**
- Restoring a `trades`-derived `proposedTrades` path (current handler builds proposedTrades from `allocations` only — preserve that behaviour; do not start consuming `rebalance-planner` output in this PR).
- `currentPositions` handling (handler reads `portfolio?.currentPositions` directly; post-Phase-A schema doesn't have that key — file as parking if it surfaces, do not fix here).
- Any change to `agent-service.ts`, `wrapAgentOutput`, or the SF state machine — the consumer-side fix is sufficient.
- Operating-mode envelope tuning, mode-aware retry tuning, narrative latency, or any UI/test polling rework.

---

### Task 1: Worktree setup

**Files:** none yet — create the worktree first.

- [ ] **Step 1: Invoke the `superpowers:using-git-worktrees` skill** to create a worktree off `main` named `fix/assemble-packet-agent-output-key`. All subsequent tasks run inside the worktree.

- [ ] **Step 2: Verify worktree status**

Run: `git branch --show-current && git status`
Expected: branch is `fix/assemble-packet-agent-output-key`, working tree clean.

---

### Task 2: Failing test for new shape

**Files:**
- Modify: `services/advisory/decision-workflow-ctrl/test/unit/assemble-packet.test.ts:160-195` — replace the `it('translates portfolio-engine allocations into proposedTrades', …)` block.

- [ ] **Step 1: Rewrite the existing translation test to use the new shape**

Replace lines 160-195 with:

```typescript
  it('translates portfolio-engine allocations into proposedTrades (post-Phase-A shape)', async () => {
    // Phase A (2026-05-14, commit 676dd75c) migrated inter-agent handoff to SF state.
    // portfolio-engine-ctrl/src/agent-service.ts returns top-level
    // { decisionId, allocations, trades, metadata } — the LangGraph node-keyed
    // outputs (portfolio-construction / rebalance-planner) are renamed by the
    // agent-service layer before they reach SF state. The handler must read
    // portfolio.allocations.allocations, NOT portfolio['portfolio-construction'].allocations.
    const result = await handler({
      ...baseEvent,
      investorProfile: { riskScore: 7 },
      marketAnalysis: null,
      portfolio: {
        decisionId: 'd-1',
        allocations: {
          allocations: [
            { instrument: 'AAPL', assetClass: 'EQUITY', targetWeight: 0.6, rationale: 'Growth' },
            { instrument: 'BND', assetClass: 'FIXED_INCOME', targetWeight: 0.4, rationale: 'Ballast' },
          ],
          totalExposure: 100_000,
          equityWeight: 0.6,
          riskMetrics: { concentrationRisk: 0.3, sectorDiversity: 0.7, largestPositionWeight: 0.6 },
          confidence: 0.85,
        },
        trades: {
          trades: [],
          estimatedTurnover: 0.1,
          confidence: 0.8,
        },
        metadata: { durationMs: 1234, modeUsed: 'BALANCED' },
      },
      narrative: null,
    });

    expect(result.proposedTrades).toEqual([
      { symbol: 'AAPL', assetClass: 'EQUITY', side: 'BUY', quantityOrAmountCents: 6_000_000, targetWeightPercent: 60, rationale: 'Growth' },
      { symbol: 'BND', assetClass: 'FIXED_INCOME', side: 'BUY', quantityOrAmountCents: 4_000_000, targetWeightPercent: 40, rationale: 'Ballast' },
    ]);
    expect(result.portfolioValue).toBe(100_000);
    expect(result.riskScore).toBe(7);
  });
```

- [ ] **Step 2: Run the rewritten test against the unfixed handler to verify it fails**

Run: `pnpm nx run decision-workflow-ctrl:test -- --testPathPatterns='assemble-packet' -t 'post-Phase-A shape'`
Expected: FAIL with `result.proposedTrades` equal to `[]` (handler reads the obsolete key, gets `undefined`, defaults to `{}`, `allocationsArray` is `[]`).

---

### Task 3: Fix the handler

**Files:**
- Modify: `services/advisory/decision-workflow-ctrl/src/handlers/assemble-packet.ts:50-56`

- [ ] **Step 1: Replace the stale comment + obsolete key lookup**

Replace lines 50-56 with:

```typescript
    // Portfolio output schema (post-Phase-A, 2026-05-14): portfolio-engine-ctrl's
    // agent-service.ts:146-151 returns { decisionId, allocations, trades, metadata }
    // at the top level. The LangGraph node-keyed outputs (portfolio-construction /
    // rebalance-planner) are renamed by the agent-service layer; the SF plumbs
    // that return value through as `portfolio` here, so we read
    // portfolio.allocations.{allocations,totalExposure,…} — NOT portfolio['portfolio-construction'].
    const construction = (portfolio?.allocations as Record<string, unknown> | undefined) ?? {};
    const allocationsArray = (construction.allocations as Array<Record<string, unknown>> | undefined) ?? [];
    const portfolioValue = (construction.totalExposure as number | undefined) ?? 0;
```

- [ ] **Step 2: Run the test again to verify it passes**

Run: `pnpm nx run decision-workflow-ctrl:test -- --testPathPatterns='assemble-packet' -t 'post-Phase-A shape'`
Expected: PASS.

- [ ] **Step 3: Run the full assemble-packet test file to confirm no regressions**

Run: `pnpm nx run decision-workflow-ctrl:test -- --testPathPatterns='assemble-packet'`
Expected: all tests PASS (the placeholder/degraded-state tests still hold because the lookup uses the same `?? {}` fallback chain).

---

### Task 4: Service-level test + lint

- [ ] **Step 1: Run all decision-workflow-ctrl unit tests**

Run: `pnpm nx run decision-workflow-ctrl:test`
Expected: all PASS.

- [ ] **Step 2: Lint the service**

Run: `pnpm nx run decision-workflow-ctrl:lint`
Expected: PASS with no new warnings.

- [ ] **Step 3: Typecheck**

Run: `pnpm nx run decision-workflow-ctrl:typecheck`
Expected: PASS.

---

### Task 5: Commit the fix

- [ ] **Step 1: Stage and commit**

Run:

```bash
git add services/advisory/decision-workflow-ctrl/src/handlers/assemble-packet.ts \
        services/advisory/decision-workflow-ctrl/test/unit/assemble-packet.test.ts
git commit -m "$(cat <<'EOF'
fix(decision-workflow-ctrl): read post-Phase-A agent-output shape in AssemblePacket

Phase A (676dd75c, 2026-05-14) renamed portfolio-engine's top-level
return keys from the LangGraph node names (portfolio-construction /
rebalance-planner) to semantic names (allocations / trades) inside
agent-service.ts. The SF plumbs that return value through as
`portfolio` to AssembleDecisionPacket, but the handler still read the
obsolete node-keyed path — so allocationsArray was always [] and every
DecisionPacket landed with proposedTrades=[] in dev.

Verified against post-deploy SF execution outputs for tenants
e2e-1778845005959-abb9fa87 / e2e-1778845399793-b0b21b79 /
e2e-1778845792706-6390d8b2 (operating-mode e2e gate, 2026-05-15):
agentResults.InvokePortfolioEngine.agentOutput.allocations is the
post-Phase-A portfolio-construction output object containing
{allocations:[...], totalExposure, equityWeight, riskMetrics, confidence}.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Deploy + e2e validation

- [ ] **Step 1: Deploy decision-workflow-ctrl to dev**

Run: `AWS_PROFILE=nestfolio-dev bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=decision-workflow-ctrl 2>&1 | tee /tmp/deploy-dwc.log`
Expected: `✅ dev-decision-workflow-ctrl` with non-zero deployment time (the AssemblePacket Lambda asset hash changed, so CFN should publish a new bundle and update the function).

- [ ] **Step 2: Verify AssemblePacket Lambda LastModified moved forward**

Run: `AWS_PROFILE=nestfolio-dev aws lambda list-functions --query 'Functions[?starts_with(FunctionName, \`dev-decision-workflow-ctrl-AssemblePacket\`)].[FunctionName,LastModified]' --output text`
Expected: LastModified timestamp newer than `2026-05-14T14:17:47Z`.

- [ ] **Step 3: Re-run the 2 originally-failing e2e files against dev**

Run:

```bash
AWS_PROFILE=nestfolio-dev NODE_OPTIONS='--experimental-vm-modules' NESTFOLIO_INTEG_PREFIX=dev \
  pnpm jest --config apps/e2e-feature-tests/jest.config.js --runInBand \
  --testPathPatterns='rebalance-on-drift|operating-mode-recommendation-shape' \
  2>&1 | tee /tmp/e2e-post-fix.log
```

Expected: `Test Suites: 2 passed, 2 total / Tests: 4 passed, 4 total`. The 4 = rebalance-on-drift (1) + operating-mode (CONSERVATIVE + BALANCED + AGGRESSIVE).

If any operating-mode case fails on envelope tolerances (LLM non-determinism), rerun ONCE per the test file's own §Risk register — that's a flake threshold the spec already documents, not this workstream's failure.

---

### Task 7: Ship the dossier + finish the worktree

- [ ] **Step 1: Update `docs/backlog/e2e-advisory-pipeline-empty-outputs-post-phase-b.md`** — set `status: shipped`, fill `validation_gate:` with the commit SHA from Task 5, the SF execution count + tenantIds verified, and the e2e pass count from Task 6 Step 3.

- [ ] **Step 2: Run backlog-lint --fix**

Run: `node .claude/skills/backlog-lint/lint.mjs --fix`
Expected: `✓ 109 backlog files; all 8 rules pass`.

- [ ] **Step 3: Commit the ship**

Run:

```bash
git add docs/backlog/e2e-advisory-pipeline-empty-outputs-post-phase-b.md docs/BACKLOG.md
git commit -m "$(cat <<'EOF'
docs(backlog): ship e2e-advisory-pipeline-empty-outputs-post-phase-b

AssemblePacket post-Phase-A key-rename fix shipped; operating-mode +
rebalance-on-drift e2e green on dev.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Open PR + finish-branch flow**

Invoke the `superpowers:finishing-a-development-branch` skill to choose between PR vs. direct merge (per workspace convention) and clean up the worktree.

---

## Self-review

- **Spec coverage:** The single failure mode (`portfolio['portfolio-construction']` → undefined → empty `proposedTrades`) is covered by Tasks 2 + 3. Tasks 4–7 ship the change and validate it end-to-end.
- **Placeholder scan:** no TBD / TODO / "similar to" placeholders. All code blocks are concrete.
- **Type consistency:** `portfolio.allocations` is typed as `Record<string, unknown> | undefined` in both the new handler line and the failing test fixture — matches.
- **Risks:** if `agent-service.ts` ever changes the rename target again (e.g. inlines `allocations: { ... }`), this handler will silently revert to empty. A type-share between agent-service and assemble-packet would catch that — file as a follow-up if the team agrees (out-of-scope for this plan).
