# Gap-sizing measurement plan — e2e-live-suite-exceeds-bedrock-daily-token-budget

- Run: `run-e2e-live-budget` · Session: `session-e2e-live-budget-1` (SD-001 period work)
- Authored (machine-captured UTC): 2026-07-18T19:54:03.000Z
- Status: PLAN ONLY — execution blocked in the authoring session by missing AWS
  credentials (`aws sts get-caller-identity` → NoCredentials). Run `aws login`
  first in the executing session.
- Criterion served: `e2elb-c1-gap-sizing`. The result file
  `continuity/dogfood/e2e-live-budget/gap-sizing.md` may declare
  `e2elb-c1-gap-sizing: MEASURED` only when every number below is filled from a
  real capture with its command output and machine-captured UTC recorded.

## Static analysis (from repository source, verified 2026-07-18)

The six production AgentConfigs in the advisory domain pin THREE distinct
Bedrock inference profiles (not two — the backlog dossier's Haiku/Sonnet
assumption is incomplete; Nova Pro is also on the decision path):

| Agent | Service | ModelId |
|---|---|---|
| user-goals | investor-profile-ctrl | `us.anthropic.claude-haiku-4-5-20251001-v1:0` |
| risk-assessment | investor-profile-ctrl | `us.anthropic.claude-sonnet-4-6` |
| portfolio-construction | portfolio-engine-ctrl | `us.amazon.nova-pro-v1:0` |
| rebalance-planner | portfolio-engine-ctrl | `us.amazon.nova-pro-v1:0` |
| explainability | advisory-narrative-ctrl | `us.anthropic.claude-haiku-4-5-20251001-v1:0` |
| market-research | market-intelligence-ctrl | `us.anthropic.claude-sonnet-4-6` |

Region: `us-east-1` (deploy tooling default). The 2026-06-26 throttling
evidence names agent `user-goals` (Haiku), consistent with the Haiku
tokens-per-day quota being the first exhausted; per-model measurement below
confirms or corrects that attribution.

## Step 1 — Per-model token totals for the reference burn window (2026-06-26 UTC)

For each ModelId M in the table above run (1-day sum, whole burn day):

```bash
aws cloudwatch get-metric-statistics --region us-east-1 \
  --namespace AWS/Bedrock --metric-name InvocationInputTokenCount \
  --dimensions Name=ModelId,Value=M \
  --start-time 2026-06-26T00:00:00Z --end-time 2026-06-27T00:00:00Z \
  --period 86400 --statistics Sum
```

Repeat with `InvocationOutputTokenCount`, `Invocations`, and
`InvocationThrottles`. If the ModelId dimension returns no datapoints, list the
dimension values actually emitted first:

```bash
aws cloudwatch list-metrics --region us-east-1 --namespace AWS/Bedrock \
  --metric-name InvocationInputTokenCount
```

Record per model: input tokens, output tokens, invocations, throttles.
Cross-check the hourly shape (period 3600) against the dossier's recorded
12/hr baseline vs 3.5k/hr e2e burst if attribution is contested.

## Step 2 — Current tokens-per-day Service Quota values

```bash
aws service-quotas list-service-quotas --region us-east-1 \
  --service-code bedrock --output json \
  | python3 -c "import json,sys; [print(q['QuotaCode'], q['Value'], q['QuotaName']) \
      for q in json.load(sys.stdin)['Quotas'] if 'tokens per day' in q['QuotaName'].lower()]"
```

Match quota names against the three profiles (Claude Haiku 4.5, Claude
Sonnet 4-6, Nova Pro — cross-region/inference-profile variants included) and
record value + QuotaCode + whether an increase is user-requestable
(`aws service-quotas get-quota` shows `Adjustable`).

## Step 3 — Gap computation

Per model: `gap = tokens consumed by ONE full live run − tokens-per-day quota`
(tokens per run from Step 1 minus the ~12/hr scheduled-emitter baseline share).
Also compute `runs-per-day = quota / tokens-per-run`. The binding constraint is
the model with the smallest runs-per-day. Record which of the four dossier fix
options (quota increase / consumption reduction / scenario scoping / suite
split) the numbers favor, as INPUT to the owner decision (`e2elb-c2`), not as
the decision.

## Output contract

Write `continuity/dogfood/e2e-live-budget/gap-sizing.md` through the Run
effect API (stable key `e2elb-gap-sizing-result-v1`) with: capture UTC, every
command + numeric result, the per-model gap table, the binding-constraint
statement, and the final line `e2elb-c1-gap-sizing: MEASURED`.