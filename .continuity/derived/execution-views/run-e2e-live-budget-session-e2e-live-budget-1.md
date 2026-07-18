# Continuity Claude Code Execution View

- Run: `run-e2e-live-budget`
- Session: `session-e2e-live-budget-1`
- Working Set: `ws-e2e-live-budget`
- Scope: `scope-e2e-live-budget@1`
- Context Pack: `run-e2e-live-budget@1`
- Pack lock digest: `050be66fe746bce73cb09f56cb0a677fbd08b3be50a0858d7a2b2661ba4fe793`
- Transcript dependency: **none**

## Objective
Make one full live-AgentCore e2e run fit within the dev-account Bedrock daily token budget: size the measured per-model token gap against the tokens-per-day Service Quotas, record an owner-ratified fix direction (quota increase, consumption reduction, scenario scoping, suite split, or a combination), implement it through the repository normal ship mechanisms, and validate that a full pass no longer exhausts the daily budget.

## Completion criteria
- [ ] `e2elb-c1-gap-sizing` — Per-model token consumption of one full live-AgentCore e2e run and the current Bedrock tokens-per-day Service Quota values are measured and recorded with machine-captured provenance.
- [ ] `e2elb-c2-fix-direction` — A fix direction (quota increase, consumption reduction, scenario scoping, suite split, or a combination) is chosen and ratified by the human program owner with machine-captured UTC.
- [ ] `e2elb-c3-budget-fit` — The chosen fix is implemented and a full live-AgentCore e2e pass fits within the daily token budget (measured need at or below the effective quota), with the validating evidence recorded.

## Scope exclusions
- No byte change to runtime/continuity/**, the hook registration, or .claude/settings.json (engine frozen during the SD-001 period).
- No edit to any published continuity suite and no mutation of any recorded historical or immutable result.
- No Skills, Packs, or bindings change outside the MI-007 governed-learning owner-applied path.
- No period-verdict or per-criterion claim; observational dogfooding-ledger appends only.

## Resolved procedures
- `resumable-agent-work` from `continuity-core@0.1.0-vs001` via `.claude/skills/continuity-resumable-work/SKILL.md`
- `nestfolio-backlog-and-evidence` from `nestfolio-binding@0.1.0-vs001` via `.claude/skills/continuity-nestfolio-binding/SKILL.md`

## Applicable Guards
- Explicitly none

## Accepted Decisions

## Exact next action
Execute the authorized keyed dogfood effect, then checkpoint.

Use only canonical artifacts and this adapter-produced view. Do not reconstruct state from an earlier chat.

