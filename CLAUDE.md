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
| Write or modify tests               | `testing-patterns`                                 |
| Design a new service/flow           | `design-service` or `design-data-flow`             |
| Verify consistency                  | `audit-service`, `audit-domain`, or `audit-system` |
| Validate a business flow            | `validate-flow`                                    |
| Assess impact of a change           | `impact-analysis`                                  |
| Document a flow from code           | `generate-flow-spec`                               |
| Regenerate C4 architecture diagrams | `generate-c4-diagrams`                             |
| Rebuild all docs from code          | `init-docs`                                        |

## Hard Constraints

- Services NEVER call each other via API — events only
- ALL Lambda handlers use event-processor pipelines (no raw Lambda handlers)
- Tests live in `test/` directory, NOT `src/__tests__/`
- Codebase is source of truth — verify before documenting or planning
- Run tasks through `pnpm nx`, never the underlying tool directly
- Always use AskUserQuestion widget for architectural decisions
