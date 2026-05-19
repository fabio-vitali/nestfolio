---
name: benchmark-agents
description: Sweep multiple Bedrock models against each of the 6 production AgentConfigs in the advisory domain, capture latency / token usage / cost / schema-pass / not-degraded / validation-pass per iteration against a real captured prompt, and produce per-task + cross-task evaluation reports. Invoked only via `/benchmark-agents` (optional `<task1>,<task2>` and/or `--iterations N`).
---

## What this skill does

For each requested task, runs `scripts/benchmark-agents/run.ts` — which sweeps that task's `models[]` against its captured production prompt — then Claude reads the resulting `raw-results.json` and writes an `evaluation.md`. After all requested tasks complete, Claude writes a cross-task `cross-task-report.md`.

All artifacts land under `benchmarks/` (gitignored end-to-end). No `*.config.ts` files are edited by this skill — recommendations are read-only output that humans apply in a follow-on PR.

## When this skill applies

Invoke only when the user types `/benchmark-agents` (optionally followed by `<task1>,<task2>` and/or `--iterations N`). Do NOT invoke otherwise. Do NOT auto-run on a schedule — that is filed `out_of_scope` in the design spec.

## Canonical TS-runner invocation

ALL commands below shell out via:

```
node -r ./tools/register-paths.js --import tsx scripts/benchmark-agents/<script>.ts <args>
```

Plain `pnpm tsx` fails on the dynamic-import chain into production configs (which carry a runtime `@nestfolio/agent-orchestrator` import via `prompts.ts`). The path-registrar form resolves the workspace aliases at runtime. Do NOT substitute `pnpm tsx`.

## Procedure

### 0. Parse argv against the live task allowlist

```bash
ls scripts/benchmark-agents/tasks/*.bench.ts | xargs -n1 basename | sed 's/\.bench\.ts$//'
```

Today this prints: `explainability market-research portfolio-construction rebalance-planner risk-assessment user-goals`. Use this dynamic set as the allowlist — never hardcode the 6 names in this SKILL.md (that's the drift trap §8 of the design spec calls out).

Parsing rules:
- No positional args → sweep all 6 tasks.
- `<task1>,<task2>` → split on comma, validate each against the allowlist. Reject + bail loudly on any name not in the set (e.g. `onboarding`, `compliance`, service names).
- `--iterations <N>` → positive integer, default `3`. Pass through to `run.ts`.

### 1. Preflight

```bash
echo "${AWS_PROFILE:-}"
```

Must print `nestfolio-dev`. If empty or different, ask the user to set it. Verify `pnpm` is on PATH.

### 2. Fixtures

For each requested task, check whether the fixture file already exists:

```bash
test -f benchmarks/fixtures/<task>.input.json
```

If missing:

```bash
AWS_PROFILE=nestfolio-dev node -r ./tools/register-paths.js --import tsx scripts/benchmark-agents/capture-fixture.ts --task <task>
```

On non-zero exit, surface the script's diagnostic message verbatim to the user. Do NOT synthesize a fake prompt — the capture step is what makes the benchmark truthful.

If the script reports a missing log group (`ResourceNotFoundException` on `/aws/bedrock/dev-invocations`), prompt the user to confirm Task 0 of the agent-benchmark-skill workstream is done (Bedrock model invocation logging enabled on dev). The exact log group can be overridden via `BEDROCK_INVOCATION_LOG_GROUP`.

### 3. Pricing

If `benchmarks/cache/pricing.json` is missing or older than 7 days, run:

```bash
node -r ./tools/register-paths.js --import tsx scripts/benchmark-agents/refresh-pricing.ts
```

(No AWS profile needed — the script reads `scripts/benchmark-agents/pricing.manifest.json` checked into source, no API call.)

### 4. Sweep loop (one task at a time, sequential)

For each requested task:

```bash
AWS_PROFILE=nestfolio-dev node -r ./tools/register-paths.js --import tsx scripts/benchmark-agents/run.ts --task <task> --iterations <N>
```

Capture the trailing `[run] raw-results=<path>` line. That's the JSON the next step reads.

If a task throws `ThrottlingException` mid-sweep, the iteration is recorded with `schemaPass=false` and the script continues. Note throttled rows in the evaluation and recommend the user rerun just that task.

### 5. Per-task evaluation.md

Read each `raw-results.json`. Write `benchmarks/tasks/<task>/<same-ISO>/evaluation.md` with these sections in order:

1. **Header** — task name, owning service, production config file path, fixture path + `capturedAt`, run timestamp, iterations per combo, sum of `aggregates.totalCostUSD` across all models.
2. **Comparison table** — markdown, one row per model:

   ```
   | model | runs | schemaPass | notDegraded | validationPass | medianLat | medianCost | totalCost |
   ```

   Mark the row whose `modelId` matches the production config's `modelId` with `(current)`. Highlight any row where `schemaPass='3/3'` but `validationPass='0/3'` as **NOT production-viable**.

3. **Per-model section** — one paragraph per model commenting on:
   - (a) output semantic quality given the task's role (inspect iteration `output` fields, but quote ≤ 5 lines — never the full output);
   - (b) prompt-template tweaks that might lift this model specifically (e.g. "Llama 3.3 dropped the `rationale` field on 2/3 runs — adding `Return EVERY field including rationale` to the prompt would likely fix this");
   - (c) three-gate verdict (schemaPass / notDegraded / validationPass).

4. **Final recommendation** — explicit reasoning over quality / cost / latency anchored in this task's role. Format:

   > Recommend changing `modelId` in `<configFilePath>` from `<current>` to `<recommended>`.

### 6. Cross-task report

After all requested tasks finish, write `benchmarks/_summary/<ISO>/cross-task-report.md`:

1. **Recommendation snapshot table** — `| task | service | current model | recommended model | current quality | recommended quality | cost Δ/call | latency Δ/call | configFilePath |`.

   `current quality` and `recommended quality` are 1-line semantic summaries drawn from each per-task `evaluation.md` §3 Per-model — never copy raw outputs; use structural metrics (e.g. "9 signals, 723-char outlook" vs "5 signals, 281-char outlook, drops TLT/GLD/EFA/EEM"). The PII guard in §7 applies — these are *structural* observations about the output, not the output text itself.

2. **Side-by-side quality matrix** — per task, two short blocks contrasting current vs recommended on the semantic dimensions that matter for that task's role. The market-research postscript §7.5 (`benchmarks/_summary/2026-05-19T21-15-00Z/cross-task-report.md`) is the canonical shape — generalise it across every task in the sweep. Format per task:

   ```
   ### <task>
   - **<current model>:** <semantic dimensions: count of signals / length of narrative / coverage of input items / confidence calibration / etc.>
   - **<recommended model>:** <same dimensions, contrasted>
   - **Tradeoff:** <one-line summary of what's lost vs gained semantically>
   ```

   For tasks where current === recommended (no downgrade proposed), state "no change recommended" and skip the contrast.

3. **Projected cost-per-decision-cycle delta** — sum each task's effective per-call cost across one cycle. Effective factor per (task, model) = `2 − (notDegraded count / iterations)`. Render: "$X today vs $Y recommended". Models with `notDegradedRate < 0.7` flagged "retry-heavy — high variance".
4. **Iteration-noise caveat** — if any (task, model) has `(maxLat − minLat) / medianLat > 0.3` OR `(maxCost − minCost) / medianCost > 0.3`, recommend rerunning that subset with `--iterations 5` before treating the median as basis for the production edit.
5. **Cross-cutting observations** — patterns visible only across tasks (e.g. "Nova Pro faster than Sonnet 4.6 on structured-output across all 5 task types tried").
6. **Action items** — concrete edit list:
   - "`<configFilePath>` — change `modelId` from `<current>` to `<recommended>`."

   All 6 task configs export a top-level object with the `modelId` field at the top — a uniform single-line Edit applies in every case.

### 7. PII guard (mirrors spec §4.2)

- Never paste fixture content or full raw output into chat, PR descriptions, or any non-local surface.
- `evaluation.md` and `cross-task-report.md` may quote schemaPass/fail signals + ≤5-line structural excerpts. Never full prompt bodies. Never full structured outputs.
- The `benchmarks/` tree is gitignored entirely; treat the contents as the dev account's data.

### 8. Reporting back

When done with §7, tell the user:
- Tasks swept + iteration count.
- The path to each `evaluation.md`.
- The path to `cross-task-report.md`.
- Total estimated cost across all `aggregates.totalCostUSD`.

### 9. Propose applying the recommended config edits

After reporting back, build an `applyCandidates` list from the cross-task report's **"Action items"** subsection (item 6 of §6). Filter:

- **Drop** any candidate where `notDegradedRate < 0.7` on the recommended model. Report which were dropped and why.
- **Tag** (do not drop) any candidate that the cross-task report flagged under **"Iteration-noise caveat"** (item 4 of §6) — these are eligible but require explicit opt-in.

If the filtered list is empty, say so and stop. Otherwise, invoke `AskUserQuestion` with one question:

- **Question:** "Apply the recommended `modelId` edits to production configs?"
- **Header:** "Apply edits"
- **Options** (single-select, no `multiSelect`):
  1. **Apply all** *(Recommended only if no candidate is noise-flagged)* — Edit every `configFilePath` to swap `modelId` from current → recommended.
  2. **Apply selected** — Ask a follow-up `AskUserQuestion` with one option per candidate (multiSelect), labelled `<task> → <recommended>` and tagged `(noise-flagged)` where applicable. Then Edit only the chosen rows.
  3. **Skip all** — Make no edits. The report stands as a read-only recommendation.

For each candidate the user approves, use the `Edit` tool: find the `modelId: '<current>'` line in `<configFilePath>` and replace `<current>` with `<recommended>`. All 6 configs share the same shape — a top-level object whose `modelId` field is the unique target.

After Edits land, report:
- The list of files edited (one path per line).
- A reminder that the change is local-only — no commit, no deploy. The user owns staging, PR, and CI gating.
- A reminder to run the relevant integration test for each touched agent before merging.

Do NOT chain into `git add` / `git commit` / `pnpm nx test` automatically. The skill's surface ends at the Edit calls; downstream verification + commit is the user's call.
