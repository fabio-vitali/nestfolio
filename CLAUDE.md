<!-- nx configuration start-->
<!-- Leave the start & end comments to automatically receive updates. -->

# General Guidelines for working with Nx

- For navigating/exploring the workspace, invoke the `nx-workspace` skill first - it has patterns for querying projects, targets, and dependencies
- When running tasks (for example build, lint, test, e2e, etc.), always prefer running the task through `nx` (i.e. `nx run`, `nx run-many`, `nx affected`) instead of using the underlying tooling directly
- Prefix nx commands with the workspace's package manager (e.g., `pnpm nx build`, `npm exec nx test`) - avoids using globally installed CLI
- You have access to the Nx MCP server and its tools, use them to help the user
- For Nx plugin best practices, check `node_modules/@nx/<plugin>/PLUGIN.md`. Not all plugins have this file - proceed without it if unavailable.
- NEVER guess CLI flags - always check nx_docs or `--help` first when unsure

## Scaffolding & Generators

- For scaffolding tasks (creating apps, libs, project structure, setup), ALWAYS invoke the `nx-generate` skill FIRST before exploring or calling MCP tools

## When to use nx_docs

- USE for: advanced config options, unfamiliar flags, migration guides, plugin configuration, edge cases
- DON'T USE for: basic generator syntax (`nx g @nx/react:app`), standard commands, things you already know
- The `nx-generate` skill handles generator discovery internally - don't call nx_docs just to look up generator syntax

<!-- nx configuration end-->

## Canonical Architecture References

Before any architecturally non-trivial change, read:

- `docs/architecture/SYSTEM-ARCHITECTURE.md` — domains, agent topology, decision lifecycle, event taxonomy, AgentCore Memory contract, idempotency, circuit breakers, frontend topology
- `docs/architecture/SERVICE-INVENTORY.md` — per-service responsibility, events published/consumed, AI agents, current health (canonical / transitional / legacy / dormant)

These supersede `specifications/02-system-design.md` (kept as a high-level summary) for service-level reasoning. Per-service `CLAUDE.md` cards remain authoritative for current code state per service.

## System Model

- Monorepo: 4 DDD domains (Investor, Advisory, Execution, Ledger)
- Each domain: EventBridge bus + services ({domain}-ctrl, -bff, -hub, -adpt)
- Communication: async events only (DynamoDB CDC → EventBridge). No inter-service API calls.
- Frontend: Angular PWA, investor-web via Native Federation
- IaC: CDK with 6-construct pattern (State, Ingress, Egress, Facade, AgentRuntime, Orchestration)
- All 6 constructs are consumer-instantiated and explicitly wired via props
- Shared libs: event-processor, cdk-constructs, agent-orchestrator, shell, ui

## Skill Routing (MANDATORY)

Before starting any task below, invoke the corresponding skill FIRST:

| Task                                | Skill                                              |
| ----------------------------------- | -------------------------------------------------- |
| Understand the system or a domain   | `orient` or `domains`                              |
| Create a new service                | `create-service`                                   |
| Add a feature to a service          | `create-feature`                                   |
| Add/modify an event                 | `create-event`                                     |
| Wire a cross-domain data flow       | `create-data-flow`                                 |
| Add an MFE feature/route            | `create-mfe`                                       |
| Write CDK infrastructure            | `cdk-patterns`                                     |
| Write event-processor handlers      | `event-processor-patterns`                         |
| Write or modify unit tests          | `testing-patterns`                                 |
| Add integration tests to a service  | `create-integration-test`                          |
| Audit integration test coverage     | `audit-integration-test`                           |
| Add an E2E feature test scenario    | `create-e2e-test`                                  |
| Audit E2E feature test coverage     | `audit-e2e-test`                                   |
| Design a new service/flow           | `design-service` or `design-data-flow`             |
| Verify consistency                  | `audit-service`, `audit-domain`, or `audit-system` |
| Validate a business flow            | `validate-flow`                                    |
| Assess impact of a change           | `impact-analysis`                                  |
| Document a flow from code           | `generate-flow-spec`                               |
| Regenerate C4 architecture diagrams | `generate-c4-diagrams`                             |
| Validate backlog state              | `backlog-lint`                                     |
| Rebuild all docs from code          | `/init-docs` (user command only)                   |

## Backlog Discipline (MANDATORY)

The canonical record for every workstream is `docs/backlog/<id>.md`. `docs/BACKLOG.md` is an auto-generated thin index — **never hand-edit it**. The `backlog-lint` skill enforces 7 invariants; the `backlog-add` skill creates new entries.

**Storage:**
- `docs/backlog/<id>.md` — one file per workstream, ever. `status: active|queued|parking|shipped|dropped` distinguishes lifecycle. Files never move folder on close.
- `docs/BACKLOG.md` — auto-generated index. Sections: ACTIVE / QUEUED / PARKING LOT / Recently Shipped (last 10).
- Cross-references everywhere are by `id`, never file path.

**The 7 rules** (enforced by `backlog-lint`):
1. `id` matches filename. 2. Exactly one `status: active`. 3. `type ∈ {design, spec}` ⇒ `references:` non-empty + paths exist + anchors resolve. 4. `status: active` ⇒ `out_of_scope:` non-empty. 5. `status: shipped` ⇒ `validation_gate` non-empty. 6. `status: queued` ⇒ `rank` set + unique. 7. `BACKLOG.md` matches files.

**Before starting any spec/plan/implementation:** confirm the active workstream is reflected in `docs/backlog/<id>.md` with `status: active`. If it isn't, create or promote first.

**Adoption to ACTIVE requires verifying every cited reference still matches code** — `backlog-lint` confirms paths and anchors exist, but YOU must confirm the cited section's *meaning* still holds. If any reference is stale, fix the doc layer FIRST.

**Every spec or plan MUST have an explicit § "Out of scope" section** before execution begins. The backlog file's `out_of_scope:` frontmatter mirrors this.

**When an out-of-scope finding surfaces during execution**, default to *file-and-continue*:
1. Invoke the `backlog-add` skill — it creates `docs/backlog/<id>.md` and runs `backlog-lint --fix`.
2. State briefly in chat what was filed.
3. Continue executing the active workstream.

Do NOT pivot mid-flight unless the finding actually blocks the active workstream's done-definition.

**At each workstream ship:**
1. Set `status: shipped`, fill `validation_gate:` in the active file.
2. Run `node .claude/skills/backlog-lint/lint.mjs --fix` — regenerates `BACKLOG.md` and `related_workstreams:` in topic dossiers.
3. Spend 5 minutes on a boundary review of `docs/BACKLOG.md` — re-rank PARKING LOT, promote items to QUEUED, drop items that have aged out.

**BACKLOG ↔ MEMORY contract** (see spec `docs/superpowers/specs/2026-05-07-backlog-redesign-design.md`):
- Backlog file `topic_memory: [project_X.md]` is the single source of truth for the workstream↔dossier link.
- Topic dossier `related_workstreams:` is regenerated by `backlog-lint --fix` — **never hand-edit it**.
- `MEMORY.md` no longer has "Recently Completed Work" or "Active / Planned Work" sections; ship narratives live in the backlog file body.

The brainstorming / writing-plans / executing-plans / subagent-driven-development skills do not enforce this on their own — these instructions override their default behavior per the superpowers skill priority rules.

## Hard Constraints

- Services NEVER call each other via API — events only
- ALL Lambda handlers use event-processor pipelines (no raw Lambda handlers)
- Tests live in `test/` directory, NOT `src/__tests__/`
- E2E relies on UI assertions only — if the POM needs to wait longer than a real user would tolerate, or polls for state a real user could not observe, the UI is the bug, not the test. Fix the UI/backend wiring; do not extend POM timeouts as a band-aid.
- Codebase is source of truth — verify before documenting or planning
- Run tasks through `pnpm nx`, never the underlying tool directly
- Always use AskUserQuestion widget for architectural decisions
- `docs/BACKLOG.md` discipline (above) — file-and-continue, single ACTIVE

## Pre-authorized actions (auto mode)

The following actions against the **dev sandbox** (AWS account 771924376645) are pre-authorized — proceed without asking when in auto mode:

- **Dev deploys.** `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev …` (any `--services=` filter, any tee/pipe to `/tmp/*.log`).
- **Dev teardowns.** `bash infrastructure/scripts/destroy.sh sandbox --prefix=dev …` — only when explicitly requested or when a BACKLOG item names a teardown step.
- **E2E gates against deployed dev.** `pnpm nx run e2e-feature-tests:test-e2e-features` (Jest) and `pnpm nx run nestfolio-e2e:e2e` (Playwright), including their `NESTFOLIO_INTEG_PREFIX=dev` invocations.
- **Read-only AWS introspection** in account 771924376645: CloudWatch Logs (`/aws/lambda/dev-*`, `/aws/bedrock-agentcore/runtime/dev-*`, `/aws/states/dev-*`), DynamoDB scans/queries, EventBridge rule listings, SSM parameter reads, Step Functions execution history, S3 listings.
- **Bedrock AgentCore Runtime updates** that are part of a `deploy.sh` invocation (the script handles esbuild → Docker → ECR push → AgentCore runtime update as one unit).

**Still requires explicit confirmation:**
- Anything against staging or prod accounts.
- Mutations to shared S3 buckets or DDB tables outside `dev-*` naming.
- `git push --force` to any branch, `git reset --hard` on shared branches.
- Anything outside this repo's working directory.
