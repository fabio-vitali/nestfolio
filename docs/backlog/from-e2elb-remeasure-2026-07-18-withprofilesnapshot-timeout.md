---
id: from-e2elb-remeasure-2026-07-18-withprofilesnapshot-timeout
type: bug
status: parking
done_when: "resolve: During the 2026-07-18 e2elb-c2 re-measurement live run,
  three live-AgentCore decision-cycle scenarios (first-decision,
  rebalance-on-drift, and all 3 cases of operating-mode-recommendation-shape)
  timed out on withProfileSnapshot(): 'InvestorProfileSnapshot not materialised
  within 360s'. This is the same fixture and the same 360s poll budget shipped
  by e2e-fixture-agentcore-synchronous-coupling (2026-05-21), whose own
  validation gate measured these scenarios completing well inside budget
  (rebalance-on-drift 178s, operating-mode-recommendation-shape 3/3 cases 264s).
  Whether this is a regression (materialisation now genuinely slower) or an
  artifact of the same-run DNS-resolution failures (the poller reads DynamoDB,
  which also errored elsewhere in this run) is undetermined from the Jest log
  alone. Evidence: continuity/dogfood/e2e-live-budget/remeasure-2026-07-18.md
  and continuity/evidence/sd-001/dogfooding-ledger.md Entry 13."
provenance:
  from_finding: e2elb-remeasure-2026-07-18-withprofilesnapshot-timeout
---

# from-e2elb-remeasure-2026-07-18-withprofilesnapshot-timeout

During the 2026-07-18 e2elb-c2 re-measurement live run, three live-AgentCore decision-cycle scenarios (first-decision, rebalance-on-drift, and all 3 cases of operating-mode-recommendation-shape) timed out on withProfileSnapshot(): 'InvestorProfileSnapshot not materialised within 360s'. This is the same fixture and the same 360s poll budget shipped by e2e-fixture-agentcore-synchronous-coupling (2026-05-21), whose own validation gate measured these scenarios completing well inside budget (rebalance-on-drift 178s, operating-mode-recommendation-shape 3/3 cases 264s). Whether this is a regression (materialisation now genuinely slower) or an artifact of the same-run DNS-resolution failures (the poller reads DynamoDB, which also errored elsewhere in this run) is undetermined from the Jest log alone. Evidence: continuity/dogfood/e2e-live-budget/remeasure-2026-07-18.md and continuity/evidence/sd-001/dogfooding-ledger.md Entry 13.
