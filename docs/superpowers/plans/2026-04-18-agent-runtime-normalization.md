# AgentCore Runtime Structure Normalization Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Normalize all six AgentCore runtime services to a single `agents/<agent-name>/{graph.ts, server.ts, Dockerfile}` directory layout, then update build configs, CDK stacks, tests, service cards, design specs, skills, and C4 diagrams to match.

**Architecture:** The repo currently has three structural patterns for AgentCore runtimes: nested-by-agent (`advisory-ctrl` only), flat-`agents/` (4 advisory services), and split-`src/agent` + `src/runtime` (`onboarding-bff`). We will converge on the nested-by-agent pattern that `advisory-ctrl` already uses. Each service gets its agent code under `agents/<agent-name>/`, with `graph.ts` as the LangGraph entry point, `server.ts` as the Hono process entry point, and `Dockerfile` for the AgentCore container artifact. The pattern future-proofs services that may grow a second agent.

**Tech Stack:** TypeScript, Nx monorepo, AWS CDK, Bedrock AgentCore, esbuild bundling, Hono, LangGraph.js, Jest, pnpm.

---

## File Structure Map

### Services and target agent names

| Service | Domain | Current pattern | Target folder | Status |
|---|---|---|---|---|
| `advisory-ctrl` | advisory | nested `agents/decision-lifecycle/` | `agents/decision-lifecycle/` | already correct (verify only) |
| `investor-profile-ctrl` | advisory | flat `agents/` | `agents/investor-profile/` | restructure |
| `portfolio-engine-ctrl` | advisory | flat `agents/` | `agents/portfolio-engine/` | restructure |
| `advisory-narrative-ctrl` | advisory | flat `agents/` | `agents/advisory-narrative/` | restructure |
| `market-intelligence-ctrl` | advisory | flat `agents/` | `agents/market-intelligence/` | restructure |
| `onboarding-bff` | investor | split `src/agent` + `src/runtime` + root `Dockerfile` | `agents/onboarding/` | restructure |

### Files moved or modified per service (high level)

For each restructured service:
- Move `graph.ts`, `server.ts`, `Dockerfile` into `agents/<agent-name>/`
- Update graph.ts internal imports (depth changes by 1)
- Update `project.json` `build-agent` target paths
- Update `src/service.stack.ts` `agentCodePath` join arguments
- Update test imports that reference moved modules
- Update `CLAUDE.md` service card

Cross-cutting docs/skills:
- `docs/superpowers/specs/2026-04-18-agent-contract-test-design.md` — update path table + section 7 + section 8 wiring example
- `.claude/skills/create-service/SKILL.md` — fix the AgentRuntime build-agent example (currently references nonexistent `src/agent/index.ts`)
- C4 diagrams — regenerate if any encode paths (most are visual; verify and regenerate if needed)

---

## Task 0: Setup

**Files:** none (workspace setup)

- [ ] **Step 1: Create a working branch**

Run: `git checkout -b refactor/normalize-agent-runtime-structure`

Expected: switched to a new branch

- [ ] **Step 2: Confirm clean working tree**

Run: `git status`
Expected: only the untracked `docs/superpowers/specs/2026-04-18-agentcore-evaluations-design.md` and this new plan file appear; no other modifications. If anything else is dirty, stop and reconcile.

- [ ] **Step 3: Baseline test run on all touched services**

Run:
```bash
pnpm nx run-many -t test --projects=advisory-ctrl,investor-profile-ctrl,portfolio-engine-ctrl,advisory-narrative-ctrl,market-intelligence-ctrl,onboarding-bff
```
Expected: PASS for all six. If anything fails, stop — the refactor must start from green.

- [ ] **Step 4: Baseline build-agent for all six services**

Run:
```bash
pnpm nx run-many -t build-agent --projects=advisory-ctrl,investor-profile-ctrl,portfolio-engine-ctrl,advisory-narrative-ctrl,market-intelligence-ctrl,onboarding-bff
```
Expected: PASS for all six. Confirms current bundle paths work, so post-refactor we have a clean comparison.

- [ ] **Step 5: Commit baseline plan**

```bash
git add docs/superpowers/plans/2026-04-18-agent-runtime-normalization.md
git commit -m "docs(plans): add agent runtime normalization plan"
```

---

## Task 1: Verify advisory-ctrl baseline (no changes expected)

**Files:**
- Read: `services/advisory/advisory-ctrl/src/service.stack.ts`
- Read: `services/advisory/advisory-ctrl/agents/decision-lifecycle/Dockerfile`
- Read: `services/advisory/advisory-ctrl/project.json`

- [ ] **Step 1: Verify directory layout matches target**

Run: `ls services/advisory/advisory-ctrl/agents/decision-lifecycle/`
Expected output includes: `Dockerfile`, `graph.ts`, `server.ts`, `dist` (dist may be missing if not yet built — OK).

- [ ] **Step 2: Verify CDK stack uses nested agentCodePath**

Run: `grep -n "agentCodePath" services/advisory/advisory-ctrl/src/service.stack.ts`
Expected: `agentCodePath: join(__dirname, '..', 'agents', 'decision-lifecycle')` or equivalent string-form path containing `agents/decision-lifecycle`. If anything else, stop and align with target shape before continuing.

- [ ] **Step 3: Verify project.json build-agent target points at nested file**

Run: `grep -n "build-agent" -A 5 services/advisory/advisory-ctrl/project.json`
Expected: command references `services/advisory/advisory-ctrl/agents/decision-lifecycle/server.ts` as input and `services/advisory/advisory-ctrl/agents/decision-lifecycle/dist/bundle.js` as output.

- [ ] **Step 4: No commit — this task is verification only**

If any of steps 1–3 didn't match, raise a flag in the PR and stop the plan; the assumption that advisory-ctrl is the canonical pattern is broken and needs revisiting.

---

## Task 2: Normalize investor-profile-ctrl

**Files:**
- Move: `services/advisory/investor-profile-ctrl/agents/graph.ts` → `services/advisory/investor-profile-ctrl/agents/investor-profile/graph.ts`
- Move: `services/advisory/investor-profile-ctrl/agents/server.ts` → `services/advisory/investor-profile-ctrl/agents/investor-profile/server.ts`
- Move: `services/advisory/investor-profile-ctrl/agents/Dockerfile` → `services/advisory/investor-profile-ctrl/agents/investor-profile/Dockerfile`
- Delete: `services/advisory/investor-profile-ctrl/agents/dist/` (regenerated)
- Modify: `services/advisory/investor-profile-ctrl/agents/investor-profile/graph.ts` (import depth +1)
- Modify: `services/advisory/investor-profile-ctrl/project.json` (build-agent target paths)
- Modify: `services/advisory/investor-profile-ctrl/src/service.stack.ts` (`agentCodePath`)
- Modify: `services/advisory/investor-profile-ctrl/test/unit/graph.test.ts` (require path)
- Modify: `services/advisory/investor-profile-ctrl/CLAUDE.md` (service card path mention, if any)

- [ ] **Step 1: Create nested folder and move files (preserve git history)**

```bash
mkdir -p services/advisory/investor-profile-ctrl/agents/investor-profile
git mv services/advisory/investor-profile-ctrl/agents/graph.ts services/advisory/investor-profile-ctrl/agents/investor-profile/graph.ts
git mv services/advisory/investor-profile-ctrl/agents/server.ts services/advisory/investor-profile-ctrl/agents/investor-profile/server.ts
git mv services/advisory/investor-profile-ctrl/agents/Dockerfile services/advisory/investor-profile-ctrl/agents/investor-profile/Dockerfile
rm -rf services/advisory/investor-profile-ctrl/agents/dist
```

- [ ] **Step 2: Fix graph.ts import depth**

Edit `services/advisory/investor-profile-ctrl/agents/investor-profile/graph.ts`. Replace each occurrence of `from '../src/agents/` with `from '../../src/agents/`. Also update the file-header comment line:

Replace:
```ts
// services/advisory/investor-profile-ctrl/agents/graph.ts
```
With:
```ts
// services/advisory/investor-profile-ctrl/agents/investor-profile/graph.ts
```

(`server.ts` only imports `'./graph'` and `'@hono/node-server'`/`'@nestfolio/agent-orchestrator'` — no path edits needed. The Dockerfile uses `COPY dist/bundle.js ./bundle.js` which resolves relative to the build context the CDK passes in, so it stays correct after `agentCodePath` is updated.)

- [ ] **Step 3: Update graph.ts file-header comment**

Same edit covered above. Sanity-check: no other relative imports in `graph.ts` start with a single `..`.

Run: `grep -n "from '\\.\\./" services/advisory/investor-profile-ctrl/agents/investor-profile/graph.ts`
Expected: no output (all `..` imports should now have at least two segments).

- [ ] **Step 4: Update project.json build-agent target**

Edit `services/advisory/investor-profile-ctrl/project.json`. Replace the build-agent block:

Old:
```json
"build-agent": {
  "executor": "nx:run-commands",
  "options": {
    "command": "npx esbuild services/advisory/investor-profile-ctrl/agents/server.ts --bundle --platform=node --outfile=services/advisory/investor-profile-ctrl/agents/dist/bundle.js --format=cjs --target=node20"
  }
}
```

New:
```json
"build-agent": {
  "executor": "nx:run-commands",
  "options": {
    "command": "npx esbuild services/advisory/investor-profile-ctrl/agents/investor-profile/server.ts --bundle --platform=node --outfile=services/advisory/investor-profile-ctrl/agents/investor-profile/dist/bundle.js --format=cjs --target=node20"
  }
}
```

- [ ] **Step 5: Update service.stack.ts agentCodePath**

Edit `services/advisory/investor-profile-ctrl/src/service.stack.ts`. Replace:
```ts
agentCodePath: join(__dirname, '..', 'agents'),
```
With:
```ts
agentCodePath: join(__dirname, '..', 'agents', 'investor-profile'),
```

- [ ] **Step 6: Update test imports**

```bash
grep -rn "agents/graph\|agents/server" services/advisory/investor-profile-ctrl/test
```

For each match, replace `agents/graph` with `agents/investor-profile/graph` and `agents/server` with `agents/investor-profile/server`. Concretely, in `services/advisory/investor-profile-ctrl/test/unit/graph.test.ts` change every `require('../../agents/graph')` to `require('../../agents/investor-profile/graph')`.

- [ ] **Step 7: Run unit tests**

Run: `pnpm nx test investor-profile-ctrl`
Expected: PASS — including the orchestrator-graph isolated-modules tests. If a path is still stale, the test will throw `Cannot find module`; fix and re-run.

- [ ] **Step 8: Run build-agent**

Run: `pnpm nx build-agent investor-profile-ctrl`
Expected: bundle written to `services/advisory/investor-profile-ctrl/agents/investor-profile/dist/bundle.js`. Confirm:
```bash
ls services/advisory/investor-profile-ctrl/agents/investor-profile/dist/bundle.js
```

- [ ] **Step 9: CDK synth smoke test**

Run:
```bash
pnpm nx deploy investor-profile-ctrl --args="--prefix=dev" -- --no-execute 2>/dev/null || \
  pnpm exec ts-node -r ./tools/register-paths.js services/advisory/investor-profile-ctrl/src/main.ts --help >/dev/null
```
Expected: no synth errors. (The deploy call is gated by `--no-execute`/dry pattern; the fallback simply parses the entry to catch import failures. Use whichever is supported by the workspace's deploy script.)

If the workspace lacks a no-op synth path, fall back to:
```bash
pnpm exec cdk synth --app 'pnpm exec ts-node -r ./tools/register-paths.js services/advisory/investor-profile-ctrl/src/main.ts' -c prefix=dev > /dev/null
```
Expected: stack synthesizes without error.

- [ ] **Step 10: Update CLAUDE.md service card**

Edit `services/advisory/investor-profile-ctrl/CLAUDE.md`. If the AgentRuntime section mentions `agents/graph.ts`, update to `agents/investor-profile/graph.ts`. If no path is referenced, leave untouched. Then add a single line in the AgentRuntime section noting the agent name segment:

```
Agent folder: agents/investor-profile/
```

(Place it directly under the `## AgentRuntime` heading.)

- [ ] **Step 11: Commit**

```bash
git add services/advisory/investor-profile-ctrl
git commit -m "refactor(investor-profile-ctrl): nest agent runtime under agents/investor-profile/"
```

---

## Task 3: Normalize portfolio-engine-ctrl

**Files:**
- Move: `services/advisory/portfolio-engine-ctrl/agents/graph.ts` → `services/advisory/portfolio-engine-ctrl/agents/portfolio-engine/graph.ts`
- Move: `services/advisory/portfolio-engine-ctrl/agents/server.ts` → `services/advisory/portfolio-engine-ctrl/agents/portfolio-engine/server.ts`
- Move: `services/advisory/portfolio-engine-ctrl/agents/Dockerfile` → `services/advisory/portfolio-engine-ctrl/agents/portfolio-engine/Dockerfile`
- Delete: `services/advisory/portfolio-engine-ctrl/agents/dist/`
- Modify: `services/advisory/portfolio-engine-ctrl/agents/portfolio-engine/graph.ts`
- Modify: `services/advisory/portfolio-engine-ctrl/project.json`
- Modify: `services/advisory/portfolio-engine-ctrl/src/service.stack.ts`
- Modify: `services/advisory/portfolio-engine-ctrl/test/**/*.test.ts` (any that reference `agents/graph` or `agents/server`)
- Modify: `services/advisory/portfolio-engine-ctrl/CLAUDE.md`

- [ ] **Step 1: Move files**

```bash
mkdir -p services/advisory/portfolio-engine-ctrl/agents/portfolio-engine
git mv services/advisory/portfolio-engine-ctrl/agents/graph.ts services/advisory/portfolio-engine-ctrl/agents/portfolio-engine/graph.ts
git mv services/advisory/portfolio-engine-ctrl/agents/server.ts services/advisory/portfolio-engine-ctrl/agents/portfolio-engine/server.ts
git mv services/advisory/portfolio-engine-ctrl/agents/Dockerfile services/advisory/portfolio-engine-ctrl/agents/portfolio-engine/Dockerfile
rm -rf services/advisory/portfolio-engine-ctrl/agents/dist
```

- [ ] **Step 2: Fix graph.ts imports**

Edit `services/advisory/portfolio-engine-ctrl/agents/portfolio-engine/graph.ts`. Replace `from '../src/agents/` with `from '../../src/agents/` (every occurrence). Also update the file-header comment:

Replace:
```ts
// services/advisory/portfolio-engine-ctrl/agents/graph.ts
```
With:
```ts
// services/advisory/portfolio-engine-ctrl/agents/portfolio-engine/graph.ts
```

Verify: `grep -n "from '\\.\\./" services/advisory/portfolio-engine-ctrl/agents/portfolio-engine/graph.ts` — expect every `..` to have two or more segments.

- [ ] **Step 3: Update project.json build-agent target**

Edit `services/advisory/portfolio-engine-ctrl/project.json`. Replace:
```json
"command": "npx esbuild services/advisory/portfolio-engine-ctrl/agents/server.ts --bundle --platform=node --outfile=services/advisory/portfolio-engine-ctrl/agents/dist/bundle.js --format=cjs --target=node20"
```
With:
```json
"command": "npx esbuild services/advisory/portfolio-engine-ctrl/agents/portfolio-engine/server.ts --bundle --platform=node --outfile=services/advisory/portfolio-engine-ctrl/agents/portfolio-engine/dist/bundle.js --format=cjs --target=node20"
```

- [ ] **Step 4: Update service.stack.ts agentCodePath**

Edit `services/advisory/portfolio-engine-ctrl/src/service.stack.ts`. Replace:
```ts
agentCodePath: join(__dirname, '..', 'agents'),
```
With:
```ts
agentCodePath: join(__dirname, '..', 'agents', 'portfolio-engine'),
```

- [ ] **Step 5: Update test imports**

```bash
grep -rn "agents/graph\|agents/server" services/advisory/portfolio-engine-ctrl/test
```
For each match, replace `agents/graph` with `agents/portfolio-engine/graph` and `agents/server` with `agents/portfolio-engine/server`. If grep returns no matches, this step is a no-op.

- [ ] **Step 6: Run unit tests**

Run: `pnpm nx test portfolio-engine-ctrl`
Expected: PASS.

- [ ] **Step 7: Run build-agent**

Run: `pnpm nx build-agent portfolio-engine-ctrl`
Expected: bundle at `services/advisory/portfolio-engine-ctrl/agents/portfolio-engine/dist/bundle.js`. Verify:
```bash
ls services/advisory/portfolio-engine-ctrl/agents/portfolio-engine/dist/bundle.js
```

- [ ] **Step 8: CDK synth smoke test**

Run:
```bash
pnpm exec cdk synth --app 'pnpm exec ts-node -r ./tools/register-paths.js services/advisory/portfolio-engine-ctrl/src/main.ts' -c prefix=dev > /dev/null
```
Expected: no synth errors.

- [ ] **Step 9: Update CLAUDE.md service card**

Edit `services/advisory/portfolio-engine-ctrl/CLAUDE.md`. If `agents/graph.ts` is referenced, replace with `agents/portfolio-engine/graph.ts`. Add under `## AgentRuntime`:

```
Agent folder: agents/portfolio-engine/
```

- [ ] **Step 10: Commit**

```bash
git add services/advisory/portfolio-engine-ctrl
git commit -m "refactor(portfolio-engine-ctrl): nest agent runtime under agents/portfolio-engine/"
```

---

## Task 4: Normalize advisory-narrative-ctrl

**Files:**
- Move: `services/advisory/advisory-narrative-ctrl/agents/graph.ts` → `services/advisory/advisory-narrative-ctrl/agents/advisory-narrative/graph.ts`
- Move: `services/advisory/advisory-narrative-ctrl/agents/server.ts` → `services/advisory/advisory-narrative-ctrl/agents/advisory-narrative/server.ts`
- Move: `services/advisory/advisory-narrative-ctrl/agents/Dockerfile` → `services/advisory/advisory-narrative-ctrl/agents/advisory-narrative/Dockerfile`
- Delete: `services/advisory/advisory-narrative-ctrl/agents/dist/`
- Modify: `services/advisory/advisory-narrative-ctrl/agents/advisory-narrative/graph.ts`
- Modify: `services/advisory/advisory-narrative-ctrl/project.json`
- Modify: `services/advisory/advisory-narrative-ctrl/src/service.stack.ts`
- Modify: `services/advisory/advisory-narrative-ctrl/test/**/*.test.ts` (matches only)
- Modify: `services/advisory/advisory-narrative-ctrl/CLAUDE.md`

- [ ] **Step 1: Move files**

```bash
mkdir -p services/advisory/advisory-narrative-ctrl/agents/advisory-narrative
git mv services/advisory/advisory-narrative-ctrl/agents/graph.ts services/advisory/advisory-narrative-ctrl/agents/advisory-narrative/graph.ts
git mv services/advisory/advisory-narrative-ctrl/agents/server.ts services/advisory/advisory-narrative-ctrl/agents/advisory-narrative/server.ts
git mv services/advisory/advisory-narrative-ctrl/agents/Dockerfile services/advisory/advisory-narrative-ctrl/agents/advisory-narrative/Dockerfile
rm -rf services/advisory/advisory-narrative-ctrl/agents/dist
```

- [ ] **Step 2: Fix graph.ts imports**

Edit `services/advisory/advisory-narrative-ctrl/agents/advisory-narrative/graph.ts`. Replace `from '../src/agents/` with `from '../../src/agents/` (every occurrence).

If the file has a path-comment header (e.g. `// services/advisory/advisory-narrative-ctrl/agents/graph.ts`), update it to `// services/advisory/advisory-narrative-ctrl/agents/advisory-narrative/graph.ts`. If no header, skip.

Verify: `grep -n "from '\\.\\./" services/advisory/advisory-narrative-ctrl/agents/advisory-narrative/graph.ts` — every `..` should have at least two segments.

- [ ] **Step 3: Update project.json build-agent target**

Edit `services/advisory/advisory-narrative-ctrl/project.json`. Replace:
```json
"command": "npx esbuild services/advisory/advisory-narrative-ctrl/agents/server.ts --bundle --platform=node --outfile=services/advisory/advisory-narrative-ctrl/agents/dist/bundle.js --format=cjs --target=node20"
```
With:
```json
"command": "npx esbuild services/advisory/advisory-narrative-ctrl/agents/advisory-narrative/server.ts --bundle --platform=node --outfile=services/advisory/advisory-narrative-ctrl/agents/advisory-narrative/dist/bundle.js --format=cjs --target=node20"
```

- [ ] **Step 4: Update service.stack.ts agentCodePath**

Edit `services/advisory/advisory-narrative-ctrl/src/service.stack.ts`. Replace:
```ts
agentCodePath: join(__dirname, '..', 'agents'),
```
With:
```ts
agentCodePath: join(__dirname, '..', 'agents', 'advisory-narrative'),
```

- [ ] **Step 5: Update test imports**

```bash
grep -rn "agents/graph\|agents/server" services/advisory/advisory-narrative-ctrl/test
```
For each match, replace `agents/graph` with `agents/advisory-narrative/graph` and `agents/server` with `agents/advisory-narrative/server`.

- [ ] **Step 6: Run unit tests**

Run: `pnpm nx test advisory-narrative-ctrl`
Expected: PASS.

- [ ] **Step 7: Run build-agent**

Run: `pnpm nx build-agent advisory-narrative-ctrl`
Expected: bundle at `services/advisory/advisory-narrative-ctrl/agents/advisory-narrative/dist/bundle.js`.

- [ ] **Step 8: CDK synth smoke test**

Run:
```bash
pnpm exec cdk synth --app 'pnpm exec ts-node -r ./tools/register-paths.js services/advisory/advisory-narrative-ctrl/src/main.ts' -c prefix=dev > /dev/null
```
Expected: no errors.

- [ ] **Step 9: Update CLAUDE.md service card**

Edit `services/advisory/advisory-narrative-ctrl/CLAUDE.md`. Replace any `agents/graph.ts` reference with `agents/advisory-narrative/graph.ts`. Add under `## AgentRuntime`:

```
Agent folder: agents/advisory-narrative/
```

- [ ] **Step 10: Commit**

```bash
git add services/advisory/advisory-narrative-ctrl
git commit -m "refactor(advisory-narrative-ctrl): nest agent runtime under agents/advisory-narrative/"
```

---

## Task 5: Normalize market-intelligence-ctrl

**Files:**
- Move: `services/advisory/market-intelligence-ctrl/agents/graph.ts` → `services/advisory/market-intelligence-ctrl/agents/market-intelligence/graph.ts`
- Move: `services/advisory/market-intelligence-ctrl/agents/server.ts` → `services/advisory/market-intelligence-ctrl/agents/market-intelligence/server.ts`
- Move: `services/advisory/market-intelligence-ctrl/agents/Dockerfile` → `services/advisory/market-intelligence-ctrl/agents/market-intelligence/Dockerfile`
- Delete: `services/advisory/market-intelligence-ctrl/agents/dist/`
- Modify: `services/advisory/market-intelligence-ctrl/agents/market-intelligence/graph.ts`
- Modify: `services/advisory/market-intelligence-ctrl/project.json`
- Modify: `services/advisory/market-intelligence-ctrl/src/service.stack.ts`
- Modify: `services/advisory/market-intelligence-ctrl/test/**/*.test.ts` (matches only)
- Modify: `services/advisory/market-intelligence-ctrl/CLAUDE.md`

- [ ] **Step 1: Move files**

```bash
mkdir -p services/advisory/market-intelligence-ctrl/agents/market-intelligence
git mv services/advisory/market-intelligence-ctrl/agents/graph.ts services/advisory/market-intelligence-ctrl/agents/market-intelligence/graph.ts
git mv services/advisory/market-intelligence-ctrl/agents/server.ts services/advisory/market-intelligence-ctrl/agents/market-intelligence/server.ts
git mv services/advisory/market-intelligence-ctrl/agents/Dockerfile services/advisory/market-intelligence-ctrl/agents/market-intelligence/Dockerfile
rm -rf services/advisory/market-intelligence-ctrl/agents/dist
```

- [ ] **Step 2: Fix graph.ts imports**

Edit `services/advisory/market-intelligence-ctrl/agents/market-intelligence/graph.ts`. Replace `from '../src/agents/` with `from '../../src/agents/` (every occurrence).

Update the path-comment header from:
```ts
// services/advisory/market-intelligence-ctrl/agents/graph.ts
```
to:
```ts
// services/advisory/market-intelligence-ctrl/agents/market-intelligence/graph.ts
```

Verify: `grep -n "from '\\.\\./" services/advisory/market-intelligence-ctrl/agents/market-intelligence/graph.ts` — every `..` should have ≥2 segments.

- [ ] **Step 3: Update project.json build-agent target**

Edit `services/advisory/market-intelligence-ctrl/project.json`. Replace:
```json
"command": "npx esbuild services/advisory/market-intelligence-ctrl/agents/server.ts --bundle --platform=node --outfile=services/advisory/market-intelligence-ctrl/agents/dist/bundle.js --format=cjs --target=node20"
```
With:
```json
"command": "npx esbuild services/advisory/market-intelligence-ctrl/agents/market-intelligence/server.ts --bundle --platform=node --outfile=services/advisory/market-intelligence-ctrl/agents/market-intelligence/dist/bundle.js --format=cjs --target=node20"
```

- [ ] **Step 4: Update service.stack.ts agentCodePath**

Edit `services/advisory/market-intelligence-ctrl/src/service.stack.ts`. Replace:
```ts
agentCodePath: join(__dirname, '..', 'agents'),
```
With:
```ts
agentCodePath: join(__dirname, '..', 'agents', 'market-intelligence'),
```

- [ ] **Step 5: Update test imports**

```bash
grep -rn "agents/graph\|agents/server" services/advisory/market-intelligence-ctrl/test
```
Replace each match: `agents/graph` → `agents/market-intelligence/graph`; `agents/server` → `agents/market-intelligence/server`.

- [ ] **Step 6: Run unit tests**

Run: `pnpm nx test market-intelligence-ctrl`
Expected: PASS.

- [ ] **Step 7: Run build-agent**

Run: `pnpm nx build-agent market-intelligence-ctrl`
Expected: bundle at `services/advisory/market-intelligence-ctrl/agents/market-intelligence/dist/bundle.js`.

- [ ] **Step 8: CDK synth smoke test**

Run:
```bash
pnpm exec cdk synth --app 'pnpm exec ts-node -r ./tools/register-paths.js services/advisory/market-intelligence-ctrl/src/main.ts' -c prefix=dev > /dev/null
```
Expected: no errors.

- [ ] **Step 9: Update CLAUDE.md service card**

Edit `services/advisory/market-intelligence-ctrl/CLAUDE.md`. Replace any `agents/graph.ts` reference with `agents/market-intelligence/graph.ts`. Add under `## AgentRuntime`:

```
Agent folder: agents/market-intelligence/
```

- [ ] **Step 10: Commit**

```bash
git add services/advisory/market-intelligence-ctrl
git commit -m "refactor(market-intelligence-ctrl): nest agent runtime under agents/market-intelligence/"
```

---

## Task 6: Normalize onboarding-bff

This is the most invasive change because the service uses a different layout (`src/agent/`, `src/runtime/server.ts`, root-level `Dockerfile`). The agent name is `onboarding`.

**Files:**
- Create: `services/investor/onboarding-bff/agents/onboarding/` (new dir)
- Move: `services/investor/onboarding-bff/src/agent/graph.ts` → `services/investor/onboarding-bff/agents/onboarding/graph.ts`
- Move: `services/investor/onboarding-bff/src/runtime/server.ts` → `services/investor/onboarding-bff/agents/onboarding/server.ts`
- Move: `services/investor/onboarding-bff/Dockerfile` → `services/investor/onboarding-bff/agents/onboarding/Dockerfile`
- Delete: `services/investor/onboarding-bff/dist/` (regenerated)
- Modify: `services/investor/onboarding-bff/agents/onboarding/graph.ts` (imports of `./router`, `./session`, `./state`, `./phase-node`, `./tools/...`, `./prompts/...` → `'../../src/agent/...'`)
- Modify: `services/investor/onboarding-bff/agents/onboarding/server.ts` (imports of `'../agent/...'` and `'../repositories/...'` → `'../../src/agent/...'` and `'../../src/repositories/...'`)
- Modify: `services/investor/onboarding-bff/project.json` (build-agent paths)
- Modify: `services/investor/onboarding-bff/src/service.stack.ts` (`agentCodePath`)
- Modify: `services/investor/onboarding-bff/test/unit/runtime/server.test.ts` (import + jest.mock paths)
- Modify: `services/investor/onboarding-bff/CLAUDE.md`

**Constraints to preserve:**
- The runtime auto-start guard `if (process.env['AGENT_RUNTIME'] === 'true') { ... }` in server.ts MUST remain — it lets unit tests import `createApp` without spawning a server.
- The `searchKbFn` Lambda in `service.stack.ts` reads its entry from `path.join(__dirname, 'agent/tools/search-kb.handler.ts')`. The Lambda handler stays under `src/agent/tools/`; do NOT move it. Only the AgentCore container entry trio moves.

- [ ] **Step 1: Create folder and move the three container-entry files**

```bash
mkdir -p services/investor/onboarding-bff/agents/onboarding
git mv services/investor/onboarding-bff/src/agent/graph.ts services/investor/onboarding-bff/agents/onboarding/graph.ts
git mv services/investor/onboarding-bff/src/runtime/server.ts services/investor/onboarding-bff/agents/onboarding/server.ts
git mv services/investor/onboarding-bff/Dockerfile services/investor/onboarding-bff/agents/onboarding/Dockerfile
rm -rf services/investor/onboarding-bff/dist
```

The empty `src/runtime/` directory left behind can be removed:
```bash
rmdir services/investor/onboarding-bff/src/runtime 2>/dev/null || true
```

- [ ] **Step 2: Fix imports in agents/onboarding/graph.ts**

Edit `services/investor/onboarding-bff/agents/onboarding/graph.ts`. The previous location was `src/agent/graph.ts`, so its sibling imports look like `from './router'`, `from './state'`, `from './session'`, `from './phase-node'`, `from './tools/commit-phase'`, `from './tools/render-ui'`, `from './tools/compute-risk'`, `from './prompts/system'`, `from './prompts/phase-instructions'`, etc.

For every relative import in this file, rewrite the path:
- `from './X'` → `from '../../src/agent/X'`
- `from './tools/X'` → `from '../../src/agent/tools/X'`
- `from './prompts/X'` → `from '../../src/agent/prompts/X'`
- `from '../X'` → `from '../../src/X'` (for cross-folder imports out of `agent/`, e.g. `from '../domain/...'`)

Verify after edit:
```bash
grep -n "^import\|^} from\| from '" services/investor/onboarding-bff/agents/onboarding/graph.ts
```
Expected: every relative path begins with `'../../'` or imports a `@nestfolio/...` workspace package; no remaining `'./` paths.

- [ ] **Step 3: Fix imports in agents/onboarding/server.ts**

Edit `services/investor/onboarding-bff/agents/onboarding/server.ts`. The previous location was `src/runtime/server.ts`. Rewrite:
- `from '../agent/X'` → `from '../../src/agent/X'`
- `from '../repositories/X'` → `from '../../src/repositories/X'`
- `from '../domain/X'` → `from '../../src/domain/X'`
- The dynamic import `await import('../agent/session')` → `await import('../../src/agent/session')`

Replace import of the local graph builder so server.ts now uses the moved graph file. If the existing line is `import { buildOnboardingGraph } from '../agent/graph'`, change to:
```ts
import { buildOnboardingGraph } from './graph';
```
(server.ts and graph.ts are now siblings inside `agents/onboarding/`.)

Preserve unchanged:
- `if (process.env['AGENT_RUNTIME'] === 'true')` guard
- The `Bun.serve` / `node:http` fallback block

Verify:
```bash
grep -n "from '\\.\\./\\|from '\\./" services/investor/onboarding-bff/agents/onboarding/server.ts
```
Expected: only `from './graph'` for the local sibling import; everything else `'../../src/...'` or workspace packages.

- [ ] **Step 4: Update project.json build-agent target**

Edit `services/investor/onboarding-bff/project.json`. Replace:
```json
"command": "npx esbuild services/investor/onboarding-bff/src/runtime/server.ts --bundle --platform=node --outfile=services/investor/onboarding-bff/dist/bundle.js --format=cjs --target=node20"
```
With:
```json
"command": "npx esbuild services/investor/onboarding-bff/agents/onboarding/server.ts --bundle --platform=node --outfile=services/investor/onboarding-bff/agents/onboarding/dist/bundle.js --format=cjs --target=node20"
```

- [ ] **Step 5: Update service.stack.ts agentCodePath**

Edit `services/investor/onboarding-bff/src/service.stack.ts`. Replace:
```ts
agentCodePath: path.join(__dirname, '..'),
```
With:
```ts
agentCodePath: path.join(__dirname, '..', 'agents', 'onboarding'),
```

Do NOT touch the `searchKbFn` Lambda's `entry` path or its `schemaPath` — those stay at `path.join(__dirname, 'agent/tools/search-kb.handler.ts')` and `path.join(__dirname, 'agent/tools/search-kb.schema.json')` respectively, since the handler remains under `src/agent/tools/`.

- [ ] **Step 6: Update test imports**

Edit `services/investor/onboarding-bff/test/unit/runtime/server.test.ts`. Replace:

Old:
```ts
import { createApp } from '../../../src/runtime/server';
```
New:
```ts
import { createApp } from '../../../agents/onboarding/server';
```

Old:
```ts
jest.mock('../../../src/agent/graph', () => ({ ... }));
```
New:
```ts
jest.mock('../../../agents/onboarding/graph', () => ({ ... }));
```

Leave the `jest.mock('../../../src/agent/session', ...)` line as-is — `session.ts` did not move.

Then sweep the rest of the test tree for any other stale references:
```bash
grep -rn "src/runtime/server\|src/agent/graph" services/investor/onboarding-bff/test
```
For each match outside the edits above, apply the same replacement.

- [ ] **Step 7: Run unit tests**

Run: `pnpm nx test onboarding-bff`
Expected: PASS — including `runtime/server.test.ts`, `agent/graph.test.ts`, `agent/router.test.ts`, `agent/state.test.ts`, `agent/session.test.ts`, and the tool tests under `tools/`.

If `tools/*.test.ts` files break, they probably already imported from `../../../src/agent/tools/...` (which still exists). They should pass without edits — confirm.

- [ ] **Step 8: Run build-agent**

Run: `pnpm nx build-agent onboarding-bff`
Expected: bundle at `services/investor/onboarding-bff/agents/onboarding/dist/bundle.js`.

- [ ] **Step 9: CDK synth smoke test**

Run:
```bash
pnpm exec cdk synth --app 'pnpm exec ts-node -r ./tools/register-paths.js services/investor/onboarding-bff/src/main.ts' -c prefix=dev > /dev/null
```
Expected: no errors. The synth must still resolve the searchKbFn Lambda path (`agent/tools/search-kb.handler.ts`) — verify by searching the synth output for the asset hash if needed:
```bash
pnpm exec cdk synth --app 'pnpm exec ts-node -r ./tools/register-paths.js services/investor/onboarding-bff/src/main.ts' -c prefix=dev 2>&1 | grep -i "search-kb\|onboarding" | head -5
```

- [ ] **Step 10: Update CLAUDE.md service card**

Edit `services/investor/onboarding-bff/CLAUDE.md`. Replace any reference to `src/runtime/server.ts` or `src/agent/graph.ts` with `agents/onboarding/server.ts` and `agents/onboarding/graph.ts` respectively. Add under `## AgentRuntime`:

```
Agent folder: agents/onboarding/  (graph.ts + server.ts + Dockerfile)
Tooling support code remains under src/agent/ (tools, prompts, state, router, session, phase-node).
```

- [ ] **Step 11: Commit**

```bash
git add services/investor/onboarding-bff
git commit -m "refactor(onboarding-bff): nest agent runtime under agents/onboarding/"
```

---

## Task 7: Update agent contract test design spec

**Files:**
- Modify: `docs/superpowers/specs/2026-04-18-agent-contract-test-design.md`

- [ ] **Step 1: Update the scope table in section 1**

Edit the spec. Replace the Scope table:

Old:
```markdown
| Service | Domain | Graph location | Server location |
|---|---|---|---|
| `advisory-ctrl` (decision-lifecycle) | advisory | `agents/decision-lifecycle/graph.ts` | `agents/decision-lifecycle/server.ts` |
| `investor-profile-ctrl` | advisory | `agents/graph.ts` | `agents/server.ts` |
| `portfolio-engine-ctrl` | advisory | `agents/graph.ts` | `agents/server.ts` |
| `advisory-narrative-ctrl` | advisory | `agents/graph.ts` | `agents/server.ts` |
| `market-intelligence-ctrl` | advisory | `agents/graph.ts` | `agents/server.ts` |
| `onboarding-bff` | **investor** | `src/agent/graph.ts` | `src/runtime/server.ts` |
```

New:
```markdown
| Service | Domain | Agent name | Graph location | Server location |
|---|---|---|---|---|
| `advisory-ctrl` | advisory | `decision-lifecycle` | `agents/decision-lifecycle/graph.ts` | `agents/decision-lifecycle/server.ts` |
| `investor-profile-ctrl` | advisory | `investor-profile` | `agents/investor-profile/graph.ts` | `agents/investor-profile/server.ts` |
| `portfolio-engine-ctrl` | advisory | `portfolio-engine` | `agents/portfolio-engine/graph.ts` | `agents/portfolio-engine/server.ts` |
| `advisory-narrative-ctrl` | advisory | `advisory-narrative` | `agents/advisory-narrative/graph.ts` | `agents/advisory-narrative/server.ts` |
| `market-intelligence-ctrl` | advisory | `market-intelligence` | `agents/market-intelligence/graph.ts` | `agents/market-intelligence/server.ts` |
| `onboarding-bff` | **investor** | `onboarding` | `agents/onboarding/graph.ts` | `agents/onboarding/server.ts` |

All six services use a uniform `agents/<agent-name>/{graph.ts, server.ts, Dockerfile}` layout. Onboarding-bff retains additional agent support code under `src/agent/` (tools, prompts, state, router, session) which is referenced by `agents/onboarding/graph.ts`.
```

- [ ] **Step 2: Remove the "Note on onboarding-bff's structure" subsection in section 7**

Find the subsection titled `### Note on onboarding-bff's structure` (under section 7). Replace its body with:

```markdown
### Note on onboarding-bff

Onboarding-bff is the single agent outside the advisory domain — it emits on the **investor** bus rather than advisory. The event name `ONBOARDING_AGENT_INVOCATION_TRACED` lives in `services/investor/onboarding-bff/src/domain/events.ts` (or the service's existing event-types module) following the same per-service ownership rule.
```

(The directory-convention exception is gone after Task 6.)

- [ ] **Step 3: Update section 8 wiring example paths**

In section 8 ("Service-side wiring"), find the "Each agent service's `agents/server.ts`:" intro line and the example file-header comment:
```ts
// services/advisory/advisory-ctrl/agents/decision-lifecycle/server.ts
```

That comment is already correct for advisory-ctrl. But change the intro line:

Old:
```markdown
Each agent service's `agents/server.ts`:
```
New:
```markdown
Each agent service's `agents/<agent-name>/server.ts`:
```

In the "What changes vs. what doesn't" subsection (section 2), find the bullet:

Old:
```markdown
- Six agent-emitting services each add one event declaration to their `domain/events.ts` and ~3 lines of wiring in their agent server file (`agents/server.ts` for the five advisory-domain agents, `src/runtime/server.ts` for onboarding-bff).
```
New:
```markdown
- Six agent-emitting services each add one event declaration to their `domain/events.ts` and ~3 lines of wiring in their agent server file (`agents/<agent-name>/server.ts`, uniform across all six services).
```

- [ ] **Step 4: Verify no other stale path references remain in the spec**

```bash
grep -n "src/runtime\|src/agent/graph\|agents/server\.ts'" docs/superpowers/specs/2026-04-18-agent-contract-test-design.md
```
Expected: no matches except where they appear inside the new uniform table or the canonical `agents/<agent-name>/server.ts` form. If anything else surfaces, fix it.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-04-18-agent-contract-test-design.md
git commit -m "docs(specs): update agent contract test design for nested agent layout"
```

---

## Task 8: Fix create-service skill AgentRuntime template

**Files:**
- Modify: `.claude/skills/create-service/SKILL.md`

Background: the current skill (around line 122–131) shows a `build-agent` example that references `src/agent/index.ts` — a path no real service uses. After normalization, the canonical example must point at `agents/<agent-name>/server.ts`.

- [ ] **Step 1: Read the AgentRuntime section of the skill**

```bash
sed -n '110,160p' .claude/skills/create-service/SKILL.md
```

Capture the current text of the build-agent block exactly as it appears, so the Edit call below uses a unique `old_string`.

- [ ] **Step 2: Replace the build-agent example**

Edit `.claude/skills/create-service/SKILL.md`. Replace the existing build-agent block (the one that mentions `src/agent/index.ts` or `--outdir=dist/agent`) with:

```json
"build-agent": {
  "executor": "nx:run-commands",
  "options": {
    "command": "npx esbuild services/{domain}/{service-name}/agents/{agent-name}/server.ts --bundle --platform=node --outfile=services/{domain}/{service-name}/agents/{agent-name}/dist/bundle.js --format=cjs --target=node20"
  }
}
```

And add a new sentence above the JSON block:

```markdown
The agent code lives at `services/{domain}/{service-name}/agents/{agent-name}/`, containing `graph.ts` (LangGraph entry), `server.ts` (Hono entry, listens on port 8080), and `Dockerfile` (ARM64 node:20-slim base, copies `dist/bundle.js`). Use a kebab-case `{agent-name}` (e.g. `decision-lifecycle`, `investor-profile`).
```

- [ ] **Step 3: Update the AgentRuntime construct snippet in the skill**

In the same skill, find the AgentRuntime sample wiring (look for `agentCodePath`). Make sure it reads:

```ts
agentCodePath: path.join(__dirname, '..', 'agents', '{agent-name}'),
```

If the current sample uses `path.join(__dirname, '..')` or `path.join(__dirname, '..', 'agents')`, replace it with the form above.

- [ ] **Step 4: Sanity-check there are no other stale path forms in the skill**

```bash
grep -n "src/agent/index\|src/runtime/server\|agents/server\.ts\|agents/graph\.ts" .claude/skills/create-service/SKILL.md
```
Expected: no matches except the new template form `agents/{agent-name}/server.ts` etc.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/create-service/SKILL.md
git commit -m "docs(skills): fix create-service AgentRuntime template paths"
```

---

## Task 9: Sweep other skills, docs, and references

**Files:**
- Read/modify (only if matches found): `.claude/skills/cdk-patterns/SKILL.md`, `.claude/skills/orient/SKILL.md`, `.claude/skills/audit-service/SKILL.md`, `.claude/skills/design-service/SKILL.md`, `.claude/skills/init-docs/SKILL.md`
- Read/modify (only if matches found): `docs/agent-system.md`, files under `docs/data-flows/`, `docs/architecture/agent-system.md` (if present)
- Read/modify (only if matches found): `docs/superpowers/specs/2026-04-18-agentcore-evaluations-design.md`
- Read/modify (only if matches found): `flows/*.flow.yaml`

- [ ] **Step 1: Sweep `.claude/skills/` for stale path patterns**

```bash
grep -rn "agents/server\.ts\|agents/graph\.ts\|src/runtime/server\|src/agent/graph\|build-agent" .claude/skills/ | grep -v "agents/{agent-name}\|agents/decision-lifecycle\|agents/investor-profile\|agents/portfolio-engine\|agents/advisory-narrative\|agents/market-intelligence\|agents/onboarding"
```

Expected: empty. If any rows return:
- Open each file
- Replace stale flat-`agents/` paths with the nested form (use the agent name from the service the example references; if the example is generic, use `{agent-name}` placeholder)
- Replace `src/runtime/server` and `src/agent/graph` with `agents/{agent-name}/server` and `agents/{agent-name}/graph`

- [ ] **Step 2: Sweep `docs/` for stale path patterns**

```bash
grep -rn "agents/server\.ts\|agents/graph\.ts\|src/runtime/server\|src/agent/graph" docs/ | grep -v "2026-04-18-agent-contract-test-design.md\|2026-04-18-agent-runtime-normalization.md"
```

Expected: empty (after Task 7 fixed the contract-test design spec). If anything else surfaces — for instance the AgentCore evaluations design spec, `agent-system.md`, data-flow docs — apply the same replacements:
- Flat advisory `agents/graph.ts` → `agents/<service-specific-name>/graph.ts` using the service-to-name mapping in this plan's File Structure Map
- onboarding-bff `src/runtime/server.ts` and `src/agent/graph.ts` → `agents/onboarding/server.ts` and `agents/onboarding/graph.ts`

- [ ] **Step 3: Sweep flow specs**

```bash
grep -rn "agents/server\|agents/graph\|src/agent\|src/runtime" flows/
```

Expected: empty. Flow specs are event-centric and shouldn't reference paths, but verify. If anything matches, update with the nested form.

- [ ] **Step 4: Verify no stale references in apps/e2e-feature-tests or libs/agent-orchestrator**

```bash
grep -rn "agents/server\|agents/graph\|src/runtime/server\|src/agent/graph" apps/ libs/ | grep -v node_modules | grep -v dist
```

Expected: empty. (The contract test spec hasn't been implemented yet, so no real e2e helper code references these paths.) If matches surface in actual code — not in this plan or in the spec — fix them with the same mapping.

- [ ] **Step 5: Commit (only if anything changed)**

```bash
git status
# if there are modifications:
git add -p
git commit -m "docs: sweep stale agent runtime path references"
```

If `git status` shows no changes, skip the commit.

---

## Task 10: Regenerate C4 diagrams

**Files:**
- Possibly modify: `docs/architecture/nestfolio/c2-advisory/c3-*.svg`, `docs/architecture/nestfolio/c2-investor/c3-onboarding-bff.svg`
- Possibly modify: D2 sources under `docs/architecture/` (if any encode paths)

The 6-construct C4 generator inspects `service.stack.ts` files to render. Since `agentCodePath` strings changed, the diagrams may render new container-asset captions. Regenerate to keep them current.

- [ ] **Step 1: Run the C4 regeneration skill or command**

If the workspace exposes a `/generate-c4-diagrams` command, run it. Otherwise:

```bash
pnpm nx run docs:generate-c4-diagrams 2>/dev/null || \
  bash infrastructure/scripts/generate-c4.sh 2>/dev/null || \
  echo "No C4 regeneration target found — invoke the generate-c4-diagrams skill manually."
```

If neither target exists, manually trigger the `generate-c4-diagrams` skill which is registered in this workspace.

- [ ] **Step 2: Visual check the affected SVGs**

Open the 6 service-level SVGs:
- `docs/architecture/nestfolio/c2-advisory/c3-advisory-ctrl.svg`
- `docs/architecture/nestfolio/c2-advisory/c3-investor-profile-ctrl.svg`
- `docs/architecture/nestfolio/c2-advisory/c3-portfolio-engine-ctrl.svg`
- `docs/architecture/nestfolio/c2-advisory/c3-advisory-narrative-ctrl.svg`
- `docs/architecture/nestfolio/c2-advisory/c3-market-intelligence-ctrl.svg`
- `docs/architecture/nestfolio/c2-investor/c3-onboarding-bff.svg`

Verify each renders without broken nodes and that AgentRuntime container is shown. (Per project feedback: always visually verify SVG output before committing.)

- [ ] **Step 3: Commit only if SVGs changed**

```bash
git status docs/architecture
# if dirty:
git add docs/architecture
git commit -m "docs(architecture): regenerate C4 diagrams after agent layout normalization"
```

If diagrams are byte-identical to before (paths might not appear in node captions), skip the commit.

---

## Task 11: Final verification

**Files:** none — verification only

- [ ] **Step 1: Run all touched-service unit tests in one batch**

```bash
pnpm nx run-many -t test --projects=advisory-ctrl,investor-profile-ctrl,portfolio-engine-ctrl,advisory-narrative-ctrl,market-intelligence-ctrl,onboarding-bff
```
Expected: PASS for all six.

- [ ] **Step 2: Run all touched-service build-agent in one batch**

```bash
pnpm nx run-many -t build-agent --projects=advisory-ctrl,investor-profile-ctrl,portfolio-engine-ctrl,advisory-narrative-ctrl,market-intelligence-ctrl,onboarding-bff
```
Expected: PASS for all six. Each writes `bundle.js` to `agents/<agent-name>/dist/`.

- [ ] **Step 3: Run lint on touched services**

```bash
pnpm nx run-many -t lint --projects=advisory-ctrl,investor-profile-ctrl,portfolio-engine-ctrl,advisory-narrative-ctrl,market-intelligence-ctrl,onboarding-bff
```
Expected: PASS.

- [ ] **Step 4: nx affected check**

```bash
pnpm nx affected -t test,build-agent,lint --base=main
```
Expected: every affected target passes. Catches any cross-project breakage missed in single-service runs.

- [ ] **Step 5: CDK synth all six service stacks**

```bash
for svc in \
  "advisory/advisory-ctrl" \
  "advisory/investor-profile-ctrl" \
  "advisory/portfolio-engine-ctrl" \
  "advisory/advisory-narrative-ctrl" \
  "advisory/market-intelligence-ctrl" \
  "investor/onboarding-bff"; do
  echo "Synthing $svc..."
  pnpm exec cdk synth \
    --app "pnpm exec ts-node -r ./tools/register-paths.js services/$svc/src/main.ts" \
    -c prefix=dev > /dev/null || { echo "FAILED: $svc"; exit 1; }
done
echo "All synths OK"
```
Expected: prints "All synths OK".

- [ ] **Step 6: Confirm the new directory layout exists for all six services**

```bash
for svc in \
  "advisory/advisory-ctrl/agents/decision-lifecycle" \
  "advisory/investor-profile-ctrl/agents/investor-profile" \
  "advisory/portfolio-engine-ctrl/agents/portfolio-engine" \
  "advisory/advisory-narrative-ctrl/agents/advisory-narrative" \
  "advisory/market-intelligence-ctrl/agents/market-intelligence" \
  "investor/onboarding-bff/agents/onboarding"; do
  for f in graph.ts server.ts Dockerfile; do
    test -f "services/$svc/$f" || { echo "MISSING: services/$svc/$f"; exit 1; }
  done
done
echo "All six services have graph.ts + server.ts + Dockerfile in nested layout"
```
Expected: prints the success line.

- [ ] **Step 7: Confirm no flat agents/{graph.ts,server.ts,Dockerfile} files remain outside the nested folders**

```bash
for svc in \
  "advisory/investor-profile-ctrl" \
  "advisory/portfolio-engine-ctrl" \
  "advisory/advisory-narrative-ctrl" \
  "advisory/market-intelligence-ctrl"; do
  for f in graph.ts server.ts Dockerfile; do
    if [ -f "services/$svc/agents/$f" ]; then
      echo "STALE FLAT FILE: services/$svc/agents/$f"; exit 1
    fi
  done
done
test ! -f services/investor/onboarding-bff/Dockerfile || { echo "STALE: services/investor/onboarding-bff/Dockerfile"; exit 1; }
test ! -f services/investor/onboarding-bff/src/runtime/server.ts || { echo "STALE: services/investor/onboarding-bff/src/runtime/server.ts"; exit 1; }
test ! -f services/investor/onboarding-bff/src/agent/graph.ts || { echo "STALE: services/investor/onboarding-bff/src/agent/graph.ts"; exit 1; }
echo "No stale files remain"
```
Expected: prints "No stale files remain".

- [ ] **Step 8: Final repo-wide grep for any remaining stale references**

```bash
grep -rn "src/runtime/server\|src/agent/graph" \
  --include='*.ts' --include='*.json' --include='*.md' --include='*.yaml' \
  --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=cdk.out --exclude-dir=.worktrees \
  . \
  | grep -v "docs/superpowers/plans/2026-04-18-agent-runtime-normalization.md"
```
Expected: empty (the plan file itself is the only allowed mention). If anything else surfaces, edit it and re-run until clean.

- [ ] **Step 9: Push branch and open PR**

```bash
git push -u origin refactor/normalize-agent-runtime-structure
gh pr create --title "refactor: normalize AgentCore runtime layout to agents/<agent-name>/" --body "$(cat <<'EOF'
## Summary
- Normalizes 5 services (4 advisory + onboarding-bff) to the nested `agents/<agent-name>/` layout already used by advisory-ctrl
- Updates CDK stacks (`agentCodePath`), project.json `build-agent` targets, test imports, service cards
- Updates the agent contract test design spec and the create-service skill template
- Regenerates C4 diagrams

## Test plan
- [ ] `pnpm nx run-many -t test,build-agent,lint --projects=advisory-ctrl,investor-profile-ctrl,portfolio-engine-ctrl,advisory-narrative-ctrl,market-intelligence-ctrl,onboarding-bff` passes
- [ ] CDK synth succeeds for all 6 service stacks
- [ ] Visual review of regenerated C4 SVGs
- [ ] No stale `src/runtime/server` or `src/agent/graph` references in repo
EOF
)"
```

Expected: PR opened. Capture the PR URL.

---

## Self-Review Notes (post-write check)

- **Spec coverage:** Every service in the design spec's table is addressed by Tasks 1–6; spec edits live in Task 7; create-service skill in Task 8; broader sweep in Task 9; diagrams in Task 10; verification in Task 11.
- **Type/path consistency:** Agent-name → folder mapping is reused identically across stack edits, project.json edits, test edits, and the spec table:
  - `decision-lifecycle`, `investor-profile`, `portfolio-engine`, `advisory-narrative`, `market-intelligence`, `onboarding`.
- **No placeholders:** Each step shows the exact `git mv` invocation, exact JSON block, exact import-path replacement rule, or exact verification command.
- **Onboarding-bff caveats called out explicitly:** AGENT_RUNTIME guard preserved; searchKbFn Lambda entry path NOT moved; src/agent/ support code stays put.
