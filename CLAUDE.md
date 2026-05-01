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
| Rebuild all docs from code          | `/init-docs` (user command only)                   |

## Backlog Discipline (MANDATORY)

`docs/BACKLOG.md` is the single source of truth for what to do next. It has three sections: **ACTIVE** (one workstream), **QUEUED** (ordered list), **PARKING LOT** (one-liners).

**Before starting any spec/plan/implementation:** confirm the active workstream is reflected in `docs/BACKLOG.md` ACTIVE. If it isn't, update it first.

**Every spec or plan MUST have an explicit §"Out of scope" section** before execution begins. If a spec/plan lacks one, propose one as the first step.

**When an out-of-scope finding surfaces during execution** (a separate bug, a tangential improvement, a future refactor), default to *file-and-continue*:
1. Invoke the `backlog-add` skill with a one-liner including file:line evidence and a pointer to the relevant topic memory.
2. State briefly in chat what was filed.
3. Continue executing the active workstream.

Do NOT pivot mid-flight unless the finding actually blocks the active workstream's done-definition (e.g., the validation gate cannot complete). When ambiguous, ask the user with the cost surfaced ("pivot extends ship time by N; the gate may complete first regardless"). Default = file-and-continue.

**At each workstream ship:** spend 5 minutes on a boundary review of `docs/BACKLOG.md` — re-rank PARKING LOT, promote items to QUEUED if they've grown teeth, drop items that have aged out.

The brainstorming / writing-plans / executing-plans / subagent-driven-development skills do not enforce this on their own — these instructions override their default behavior per the superpowers skill priority rules.

## Hard Constraints

- Services NEVER call each other via API — events only
- ALL Lambda handlers use event-processor pipelines (no raw Lambda handlers)
- Tests live in `test/` directory, NOT `src/__tests__/`
- Codebase is source of truth — verify before documenting or planning
- Run tasks through `pnpm nx`, never the underlying tool directly
- Always use AskUserQuestion widget for architectural decisions
- `docs/BACKLOG.md` discipline (above) — file-and-continue, single ACTIVE
