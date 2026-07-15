<!-- nx configuration start-->
<!-- Leave the start & end comments to automatically receive updates. -->

## General Guidelines for working with Nx

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
- `docs/architecture/READ-MODEL-OWNERSHIP.md` — **single-writer aggregate-ownership model** (FROZEN). The discriminator (command-owned vs projection), the P1/P2/P3 variants, the `__version` convention, the `ReadModelOwnership` type registry, and command-side rules. **Consult before touching any BFF transform/projection or adding a row written via an event-processor intent factory.** Enforced by the **mandatory** `event-processor:read-model-drift` nx target — every intent-factory write must be registered or listed in `runtime/content/exclusions/read-model-exclusions.json` (verified non-governed rows).

These supersede `specifications/02-system-design.md` (kept as a high-level summary) for service-level reasoning. Per-service `CLAUDE.md` cards remain authoritative for current code state per service.

## System Model

- Monorepo: 4 DDD domains (Investor, Advisory, Execution, Ledger)
- Each domain: EventBridge bus + services ({domain}-ctrl, -bff, -hub, -adpt)
- Communication: async events only (DynamoDB CDC → EventBridge). No inter-service API calls.
- Frontend: Angular PWA, investor-web via Native Federation
- IaC: CDK with 7-construct pattern (State, Ingress, Egress, Facade, AgentRuntime, Orchestration, Broadcaster)
- All 7 constructs are consumer-instantiated and explicitly wired via props
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
| File an out-of-scope side-finding   | `backlog-add`                                      |
| Cluster the parking lot into epics  | `backlog-themes`                                   |
| Rebuild all docs from code          | `/init-docs` (user command only)                   |

## Backlog Discipline (MANDATORY)

The canonical record for every workstream is `docs/backlog/<id>.md`. `docs/BACKLOG.md` is an auto-generated thin index — **never hand-edit it**. The `backlog-lint` skill enforces 11 invariants; the `backlog-add` skill files new entries via the epic-aware router; the `backlog-themes` skill clusters the parking lot into theme epics.

**Storage:**

- `docs/backlog/<id>.md` — one file per workstream, ever. `status: active|queued|parking|shipped|dropped` distinguishes lifecycle. Files never move folder on close.
- `docs/BACKLOG.md` — auto-generated index. Sections: EPICS (with a **Parking health** line: _N theme epics, M orphans_) / ACTIVE / QUEUED / LATER / Recently Shipped (last 10).
- Cross-references everywhere are by `id`, never file path.

**The 11 rules** (enforced by `backlog-lint`):

1. `id` matches filename. 2. At most one **non-epic** `status: active` (zero allowed between workstreams). 3. `type ∈ {design, spec}` ⇒ `references:` non-empty + paths exist + anchors resolve. 4. `status: active` ⇒ `out_of_scope:` non-empty; active `type: epic` ALSO ⇒ `done_when:` + `scope:` non-empty. 5. `status: shipped` ⇒ `validation_gate` non-empty. 6. `status: queued` ⇒ `rank` set + unique. 7. `BACKLOG.md` matches files. 8. `status: queued` ⇒ neither `notes:` nor body may contain "Promote when/on/once/until/after/only" trigger language (both scanned). Items with unmet triggers belong in `parking`. To promote: remove the trigger sentence and document why it fired. 9. **Epic closure** — terminal (shipped **or** dropped) `type: epic` ⇒ no member in a non-terminal status (core: resolve/drop; captured: resolve/drop **or** re-home; a dropped-epic member whose work survives is re-homed / un-pointed). 10. **Epic pointer integrity** — a member's `epic:` resolves to a real `type: epic` file; epics carry no `epic:` pointer (1-level tree); `epic_role ∈ {core, captured}`. 11. **Single active epic** — at most one `type: epic` with `status: active`.

**Before starting any spec/plan/implementation:** confirm the active workstream is reflected in `docs/backlog/<id>.md` with `status: active`. If it isn't, create or promote first.

**Adoption to ACTIVE requires verifying every cited reference still matches code** — `backlog-lint` confirms paths and anchors exist, but YOU must confirm the cited section's _meaning_ still holds. If any reference is stale, fix the doc layer FIRST.

**Every spec or plan MUST have an explicit § "Out of scope" section** before execution begins. The backlog file's `out_of_scope:` frontmatter mirrors this.

**When an out-of-scope finding surfaces during execution**, default to _file-and-continue_ via the `backlog-add` skill's **epic-aware router** (don't just dump to parking):

1. Invoke `backlog-add` — it routes the finding (see Epics below), writes `docs/backlog/<id>.md`, runs `backlog-lint --fix`.
2. State briefly in chat which router branch fired (folded / joined a theme / minted aggregation / orphan).
3. Continue executing the active workstream.

Do NOT pivot mid-flight unless the finding actually blocks the active workstream's done-definition.

**Epics — bound the parking lot by collapsing findings into themes.** (Supersedes the old read-model-specific "refactoring-completeness exception"; generalizes it to every program.) An **epic** is a `type: epic` file; members point at it via `epic: <epic-id>` (single-parent tree). Two **roles** (`status`): a **delivery epic** (`status: active`, one at a time — rule 11) is on a closure clock; a **theme epic** (`status: parking`, unbounded) is a durable root-cause bucket. Two **member kinds** (`epic_role`, default `core`): **core** members drive closure — rule 9 drains them; **captured** members ride along to keep session context unified and **never block closure**. The discriminator is the **closure-predicate test**, NOT `scope:` membership: a member is **core** if leaving it undone would make any `done_when` clause literally false (everything in `scope:` qualifies, but so does anything else `done_when` requires); it is **captured** only if it is genuinely *orthogonal* to `done_when` — thematically near but not required for the epic to be done. Because captured members silently leftover-spin-out at close, misfiling required work as captured **drops it from the done-definition** — so when unsure whether a finding is load-bearing for `done_when`, choose **core**.

**Working an epic:** run `/backlog-next-epic <id>` (the epic orchestrator). It promotes the epic, loops its core members through `/backlog-next` in epic-member mode on **one shared branch**, batches the expensive e2e (Jest e2e + Playwright) **once at epic pre-done**, runs the captured audit, and ships via a **single PR**. `--auto` auto-resolves decisions (each logged into the PR body, picking the most reusable/recommended option) with a hard floor that still pauses on irreversible/outward-facing actions or genuinely-balanced forks. Single non-epic items go through `/backlog-next` directly — it carries no epic logic and redirects a `type: epic` id to `/backlog-next-epic`; it supports the same `--auto` mode (same hard floor, decisions logged into the workstream file's Decision log).

- **Hot path (mid-workstream, in `backlog-add`)** — route the finding cheaply: (1) thematically near the active epic → fold in as a member, picking the role by the **closure-predicate test** above (`core` if leaving it undone falsifies a `done_when` clause or it's in `scope:`; `captured` only if genuinely orthogonal to `done_when` — be generous folding things in, but on the core-vs-captured call default to **core** when load-bearing is uncertain); (2) else matches an existing theme epic → join it; (3) else shares a root cause with ≥1 parking orphans → **suggest** minting a new theme epic that aggregates them; (4) else → parking **orphan** (the residue). Filing finding N is an organizing opportunity, not just growth.
- **Atomicity (one item = one closure verdict)** — a backlog item must be *homogeneous in closure-relevance*. If a finding's sub-parts split across the verdict (some falsify `done_when` → core, others are orthogonal or blocked on out-of-scope work → captured), file them as **separate** items — never one mixed item. A single item that bundles required and not-required work cannot carry a correct `epic_role`, and the required half hides under the captured label. Split at file time.
- **Cold path (on demand, `backlog-themes`)** — the heavy all-vs-all clustering: scans orphans + `*-leftovers`, mints/extends theme epics by shared root cause, drives the **orphan count → 0**.
- **Closure & close ritual** — a delivery epic ships when its **core** members are all terminal (rule 9). Before that, run the **captured audit**: re-test every still-open **captured** member with the closure-predicate test, since a mid-flight finding may have been misfiled (or `done_when` may have tightened). Any captured member that turns out load-bearing for `done_when` is **promoted to `core`** (and must then be resolved/dropped — it does NOT spin out). Only members that pass the audit as genuinely orthogonal auto-spin-out into a single `<epic>-leftovers` theme epic (`status: parking`), re-clustered later by `backlog-themes` — no per-item triage for those. Escape hatch: removing a member's `epic:` pointer returns it to standalone parking.

**At each workstream ship:**

1. Set `status: shipped`, fill `validation_gate:` in the active file. **If shipping a delivery epic:** first run the **captured audit** (above) — promote any load-bearing captured member to `core`; then verify every `core` member is terminal and auto-spin-out the remaining (genuinely-orthogonal) `captured` members into `<epic>-leftovers` (rule 9 will block the ship otherwise). `lint.mjs` prints the active epic's captured members as the audit checklist.
2. Run `node .claude/skills/backlog-lint/lint.mjs --fix` — regenerates `BACKLOG.md` and `related_workstreams:` in topic dossiers.
3. Spend 5 minutes on a boundary review of `docs/BACKLOG.md` — re-rank LATER, promote items to QUEUED, drop items that have aged out, and check the **Parking health** line (run `backlog-themes` if orphans have crept up).

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
- **Reusable patterns are the primary objective.** Nestfolio exists first to define implementation patterns liftable *mostly as-is* into other projects/domains; working (well) software is necessary but secondary. This MUST heavily weight which AskUserQuestion option is marked "(Recommended)": pick the most reusable/generalizable/cleanly-abstracted option over the faster or more domain-coupled one, and **let reusability break ties.** State the pattern-reuse rationale in the recommendation. (user-memory `recommend-reusable-patterns`)
- `docs/BACKLOG.md` discipline (above) — file-and-continue, single ACTIVE

## Pre-authorized actions (auto mode)

The following actions against the **dev sandbox** (AWS account 771924376645) are pre-authorized — proceed without asking when in auto mode:

- **Dev deploys.** `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev …` (any `--services=` filter, any tee/pipe to `/tmp/*.log`).
- **Dev teardowns.** `bash infrastructure/scripts/destroy.sh sandbox --prefix=dev …` — only when explicitly requested or when a BACKLOG item names a teardown step.
- **E2E gates against deployed dev.** `pnpm nx run e2e-feature-tests:test-e2e-features` (Jest) and `pnpm nx run nestfolio-e2e:e2e` (Playwright), including their `NESTFOLIO_INTEG_PREFIX=dev` invocations.
- **Read-only AWS introspection** in account 771924376645: CloudWatch Logs (`/aws/lambda/dev-*`, `/aws/bedrock-agentcore/runtime/dev-*`, `/aws/states/dev-*`), DynamoDB scans/queries, EventBridge rule listings, SSM parameter reads, Step Functions execution history, S3 listings.
- **Bedrock AgentCore Runtime updates** that are part of a `deploy.sh` invocation (the script handles esbuild → Docker → ECR push → AgentCore runtime update as one unit).
- **Local git cleanup of workstream worktrees.** `git worktree remove .claude/worktrees/<name>`, `git worktree prune`, `git worktree list`, and `git branch -d <branch>` (the safe `-d` only, never `-D`). All four are local-only, network-free, and reversible via reflog.
- **`git push origin main` after a Doc-layer or Simple lane workstream.** Per `/backlog-next` lane classification (CLAUDE.md § "Backlog Discipline" lane table) and the standing policy in user memory ("docs/backlog commits go to main", "simple fixes stay on main"), doc-only and small single-service fixes intentionally bypass the worktree/PR path. The push completes the lane the workstream was started in. Complex-lane work is gated by `superpowers:finishing-a-development-branch`, which uses its own PR flow. `git push --force` to any branch still requires explicit confirmation.

**Still requires explicit confirmation:**

- Anything against staging or prod accounts.
- Mutations to shared S3 buckets or DDB tables outside `dev-*` naming.
- `git push --force` to any branch, `git reset --hard` on shared branches, `git branch -D` (force-delete).
- Anything outside this repo's working directory.

## BLOCKED commands — do NOT attempt these

### curl / wget — BLOCKED

Any Bash command containing `curl` or `wget` is intercepted and replaced with an error message. Do NOT retry.
Instead use:

- `ctx_fetch_and_index(url, source)` to fetch and index web pages
- `ctx_execute(language: "javascript", code: "const r = await fetch(...)")` to run HTTP calls in sandbox

### Inline HTTP — BLOCKED

Any Bash command containing `fetch('http`, `requests.get(`, `requests.post(`, `http.get(`, or `http.request(` is intercepted and replaced with an error message. Do NOT retry with Bash.
Instead use:

- `ctx_execute(language, code)` to run HTTP calls in sandbox — only stdout enters context

### WebFetch — BLOCKED

WebFetch calls are denied entirely. The URL is extracted and you are told to use `ctx_fetch_and_index` instead.
Instead use:

- `ctx_fetch_and_index(url, source)` then `ctx_search(queries)` to query the indexed content

## REDIRECTED tools — use sandbox equivalents

### Bash (>20 lines output)

Bash is ONLY for: `git`, `mkdir`, `rm`, `mv`, `cd`, `ls`, `npm install`, `pip install`, and other short-output commands.
For everything else, use:

- `ctx_batch_execute(commands, queries)` — run multiple commands + search in ONE call
- `ctx_execute(language: "shell", code: "...")` — run in sandbox, only stdout enters context

### Read (for analysis)

If you are reading a file to **Edit** it → Read is correct (Edit needs content in context).
If you are reading to **analyze, explore, or summarize** → use `ctx_execute_file(path, language, code)` instead. Only your printed summary enters context. The raw file content stays in the sandbox.

### Grep (large results)

Grep results can flood context. Use `ctx_execute(language: "shell", code: "grep ...")` to run searches in sandbox. Only your printed summary enters context.

## Tool selection hierarchy

1. **GATHER**: `ctx_batch_execute(commands, queries)` — Primary tool. Runs all commands, auto-indexes output, returns search results. ONE call replaces 30+ individual calls.
2. **FOLLOW-UP**: `ctx_search(queries: ["q1", "q2", ...])` — Query indexed content. Pass ALL questions as array in ONE call.
3. **PROCESSING**: `ctx_execute(language, code)` | `ctx_execute_file(path, language, code)` — Sandbox execution. Only stdout enters context.
4. **WEB**: `ctx_fetch_and_index(url, source)` then `ctx_search(queries)` — Fetch, chunk, index, query. Raw HTML never enters context.
5. **INDEX**: `ctx_index(content, source)` — Store content in FTS5 knowledge base for later search.

## Subagent routing

When spawning subagents (Agent/Task tool), the routing block is automatically injected into their prompt. Bash-type subagents are upgraded to general-purpose so they have access to MCP tools.

## Output constraints

- Keep responses under 500 words.
- Write artifacts (code, configs, PRDs) to FILES — never return them as inline text. Return only: file path + 1-line description.
- When indexing content, use descriptive source labels so others can `ctx_search(source: "label")` later.

## ctx commands

| Command       | Action                                                                                |
| ------------- | ------------------------------------------------------------------------------------- |
| `ctx stats`   | Call the `ctx_stats` MCP tool and display the full output verbatim                    |
| `ctx doctor`  | Call the `ctx_doctor` MCP tool, run the returned shell command, display as checklist  |
| `ctx upgrade` | Call the `ctx_upgrade` MCP tool, run the returned shell command, display as checklist |

## Continuity Level 1 — `/backlog-next`

This repository has one active Continuity Level 1 Procedure: `nestfolio.backlog-next@1.0.1` in project Pack `nestfolio.level-1@1.0.1`.

For `/backlog-next`, follow the existing Skill at `.claude/skills/backlog-next/SKILL.md`. Its newly authored MI-001D 1.0.1 preflight is not recovered MI-001 output; it verifies the bounded Level 1 identity before the unchanged backlog-next procedure. Inspect the guarantee card and exact asset lock with:

```bash
npm run continuity:doctor
npm run continuity:inspect
```

Level 1 guarantees only Procedure/Pack identity, the Nestfolio binding, exact SHA-256 asset locking, repository/prerequisite diagnostics, the Claude Code entry point, and structured invocation provenance. It does **not** provide canonical Work or Scope, Context Packs, Sessions/Runs, Checkpoints/Handoffs, Assurance or completion authority, Guards/Waivers, Decisions, Observations, Lessons, or learning promotion.

Disable the target route with `npm run continuity:disable`; direct `/backlog-next` behavior remains available because the current Skill stays in place. Reactivate with `npm run continuity:activate`.

## Continuity Level 2 — composed local Packs

The active Level 2 target composes the immutable Level 1 project Pack with
`continuity.repository-tools@1.0.0`. Its sole reusable Procedure is the
read-only `continuity.repository-status@1.0.0`, mapped to
`/continuity-repository-status` and resolved only through the exact local
workspace lock.

Inspect, verify, resolve, compare, and run the composed target with:

```bash
npm run continuity:pack:list
npm run continuity:pack:verify
npm run continuity:pack:resolve
npm run continuity:procedure:compare
npm run continuity:procedure:run -- continuity.repository-status@1.0.0 --repo=.
```

Level 2 guarantees exact two-Pack/two-Procedure resolution, manifest/spec/asset
digests, compatibility and permission checks, conflict blocking, self-validation,
CAS activation history, comparison, and exact Level 1 rollback. It adds no Work,
Scope, Context, Run, Assurance, completion, or learning authority. Direct
`/backlog-next` behavior and its 19 immutable assets remain unchanged.
