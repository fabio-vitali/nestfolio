# Prompt for next conversation

Copy-paste everything below the line into a new Claude Code conversation:

---

Read `infrastructure/plans/deploy-fix-plan.md` — this is a deployment fix plan from a previous session that deployed 22/33 services to AWS with prefix `dev`. 11 services remain blocked.

Your job:

1. **Verify the plan thoroughly** — especially the DDB stream filter batching approach (A6). Read the actual CDK source code, AWS Lambda docs, and test whether multiple `DynamoEventSource` mappings on the same table actually work. If the approach is wrong, find the correct one.

2. **Verify the Step Functions `.addCatch()` fix (A1)** — read the actual broker-ctrl state machine code and confirm `CustomState.addCatch()` works when the Catch target is also a CustomState with inline Parallel ASL.

3. **Write a refined implementation plan** using superpowers, then execute ALL fixes in order: code bugs → secrets → deploy fixed services → deploy AgentRuntime services → update skills documentation.

4. **For every code bug you fix, also update the `.claude/skills/` documentation** that generated the buggy code (see Part C of the plan). The skills are the source of truth for code generation — if you don't fix them, the bugs will recur.

5. After all 33 services are deployed, run verification (list stacks, check SSM params, spot-check Lambdas).

Context: I'm connected to AWS via Leapp (account 771924376645, us-east-1, AdminRole). Docker is installed and running. API keys for Alpha Vantage and FRED are in the plan file.
