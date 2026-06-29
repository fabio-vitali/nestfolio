---
name: benchmark-backlog
description: Drive the headless backlog-skills evaluation harness (`scripts/benchmark-backlog/run.mjs`) in one of three modes — `regression` (grade the corpus on current HEAD and flag any scenario whose gatePassRate dropped vs the committed baseline), `compare <refA> <refB>` (interleaved A/B run that proves an intended skill change improved or didn't regress quality), or `rebaseline` (run on main and overwrite the committed baseline). Alongside the orchestration metrics it runs BOTH deterministic test layers (the backlog skills' own unit suites + the harness's own suites) so one invocation reports the whole system's health. Invoked only via `/benchmark-backlog`.
disable-model-invocation: true
---

## What this skill does

Each `scenarios/*.scenario.mjs` drives a real backlog skill (`backlog-add`, `backlog-next`, `backlog-next-epic`, `backlog-themes`) through `claude -p` in an isolated sandbox, then grades the run (terminal-ok + golden + invariants + rubric judge → a single `gatePass` boolean). `run.mjs` runs each scenario N times, prints a JSON `rows` array to stdout, AND writes a rendered markdown report (`report.mjs`) to the gitignored `benchmarks/backlog/<mode>-<ISO>.md`, printing that path to stderr.

This skill orchestrates that runner in three modes, layers a cost-conscious confirmation gate over full-corpus spends, and pairs the (expensive, non-deterministic) orchestration metrics with the (cheap, deterministic) `node --test` suites so one `/benchmark-backlog` call answers "is the whole backlog-skills system healthy?".

All work is read-only output to the user EXCEPT `rebaseline`, which deliberately overwrites the committed `scripts/benchmark-backlog/baseline.json`. No skill `SKILL.md` files are edited by this skill.

## When this skill applies

Invoke only when the user types `/benchmark-backlog` (optionally a mode + flags). Do NOT invoke otherwise, and do NOT auto-run on a schedule — full-corpus runs are tens of millions of tokens of subscription quota.

## Canonical runner invocation

ALL modes shell out via:

```
node scripts/benchmark-backlog/run.mjs <mode> [args] [--skill=<name>] [--scenario=id1,id2] [--iterations=N] [--model=<id>]
```

- `<mode> ∈ {regression, compare, rebaseline}`.
- `--skill=<name>` narrows to one skill family (`backlog-add` | `backlog-next` | `backlog-next-epic` | `backlog-themes`); `--scenario=id1,id2` narrows to explicit scenario ids. Both compose; both optional.
- `--iterations=N` is a positive integer, default `3`.
- `--model=<id>` defaults to `claude-opus-4-8` (the model backlog skills run on; its price row is pinned in `cost.mjs`).
- `compare` takes `refA refB` as the two positional args (`node … run.mjs compare main HEAD`).
- The runner prints a JSON rows array to **stdout** and a `[bef] …` progress line per scenario to **stderr** (mid-flight observability). Redirect stdout to capture rows; let stderr stream.

Do NOT invent flags beyond these — `run.mjs` parses only `--key=value` pairs plus the positional mode/refs.

## Parse argv

1. **Mode** — first positional. Must be one of `regression`, `compare`, `rebaseline`. Reject + bail loudly on anything else.
2. **compare refs** — for `compare`, the next two positionals are `refA refB` (e.g. `main HEAD`). Both required; bail if either is missing.
3. **`--skill=<name>`** — validate against the live family set: `backlog-add backlog-next backlog-next-epic backlog-themes`. Reject an unknown name.
4. **`--scenario=id1,id2`** — comma-split; validate each id against the live corpus:

   ```bash
   ls scripts/benchmark-backlog/scenarios/*.scenario.mjs | xargs -n1 basename | sed 's/\.scenario\.mjs$//'
   ```

   Today: `add-fold-captured bne-auto-design-pause bne-e8-conflict-resolution bne-resume-merged-tail-only next-lane-complex themes-discrimination`. Use this dynamic set — never hardcode it.
5. **`--iterations=N`** — positive integer, default `3`. **`--model=<id>`** — default `claude-opus-4-8`; if overridden, confirm a matching price row exists in `cost.mjs` (`computeCostUSD` throws otherwise).

## Cost-conscious gate (MANDATORY before any full-corpus run)

A full sweep is **tens of millions of tokens** of subscription quota: each `backlog-next-epic` scenario (`bne-*`) is ≈1.7–3M tokens/iteration and there are 6 scenarios × 3 iterations by default — order tens of millions of tokens total. These runs authenticate via the CLI subscription (no `ANTHROPIC_API_KEY`), so they spend **quota, not dollars** — gate in tokens.

A run is **full-corpus** when neither `--skill` nor `--scenario` narrows it, OR `--iterations >= 3`. Before launching any full-corpus run (`regression` or `rebaseline`), surface an `AskUserQuestion`:

- **Question:** "A full backlog-skills corpus run is ~tens of millions of tokens of subscription quota (each `bne-*` scenario ≈1.7–3M tokens/iteration × 6 scenarios × N iterations). Proceed?"
- **Header:** "Corpus run cost"
- **Options** (single-select):
  1. **Narrow first (Recommended)** — re-run scoped via `--skill=<family>` and/or `--scenario=<id>` and/or `--iterations=1` to spot-check before committing the full spend.
  2. **Run full corpus** — proceed at the requested iteration count, spending the full quota.
  3. **Cancel** — make no run.

Quote the token figures in TOKENS, never dollars — the `costUsd` column is a price-weighted API-equivalent normalization number, NOT a Max-subscription bill. A `compare` over a single `--scenario` (a typical "did my edit regress this one gate?" check) skips the gate; a `compare` across the whole corpus is full-corpus and gates.

## Deterministic-suite hook (run on EVERY invocation)

Before (or alongside) the orchestration run, run BOTH deterministic layers — they are cheap, hermetic `node --test` suites and catch breakage the expensive sweep can't isolate:

```bash
node --test .claude/skills/backlog-*/test/*.test.mjs      # the backlog skills' own unit suites
node --test scripts/benchmark-backlog/test/*.test.mjs     # the harness's own suites (parse/grade/cost/report/…)
```

Capture pass/fail for each layer. A red deterministic suite is a system-health failure in its own right — report it prominently even if the orchestration gatePassRates look fine. One `/benchmark-backlog` invocation thus reports the whole system: deterministic pass/fail PLUS orchestration gatePassRate/flips.

## Mode: regression `[--skill=… --scenario=… --iterations=N]`

Quality-on-HEAD check. Grades the corpus on the current ref (default `HEAD`) and flags any scenario that lost quality vs the committed baseline.

```bash
node scripts/benchmark-backlog/run.mjs regression --iterations=3 1>/tmp/bef-regression.json
```

Then:

1. Parse the stdout JSON rows. Render the table with `renderEvaluation(rows)` from `report.mjs` (`| scenario | gatePassRate | cost$ | totTok | turns |`). `totTok` is `tokens.total` — the amortized whole-run token consumption (the headline value/efficiency signal; it captures the cache-re-read cost of skill prose).
2. Load `scripts/benchmark-backlog/baseline.json`. For each scenario id, compare the run's `gatePassRate` against the baseline row's `gatePassRate`. **FLAG** any scenario whose `gatePassRate` **dropped** (`run < baseline`) — that is a regression in skill quality on HEAD. Use `flagBands(value, baseline, bandPct)` from `report.mjs` for token/cost drift bands; for the gate itself a direct `run < baseline` compare is the flag (a gate dropping at all is a finding — also surface any `anyGateFlip: true` row as nondeterminism).
3. A scenario present in the run but missing from `baseline.json` (or vice-versa) is itself a finding — call it out (rebaseline may be needed).

## Mode: compare `<refA> <refB>`

Proves an intended skill change (`refB`) improved or at least didn't regress quality vs the prior ref (`refA`). The runner interleaves A,B,A,B… per iteration so temporal drift is balanced.

```bash
node scripts/benchmark-backlog/run.mjs compare main HEAD --iterations=3 1>/tmp/bef-compare.json
```

Then:

1. Render with `renderCompare(rows)` from `report.mjs` (`| scenario | gate A→B | cost$ A→B | totTok A→B | verdict |`). The renderer marks a row **REGRESSION** when `b.gatePassRate < a.gatePassRate`, else `value↑` when `b.tokens.total < a.tokens.total` (the amortized value signal dropped) or `flat`.
2. Surface every **REGRESSION** row at the top of the report — those block adopting `refB`. Note any row carrying an `error` field (a scenario that hard-failed mid-sweep) separately; the runner records it as a row and continues rather than aborting.

## Mode: rebaseline

The deferred full-baseline mechanism — a deliberate, budgeted spend. Runs the corpus on **main** and OVERWRITES the committed baseline. Only run after the corpus is known-clean on main (e.g. just shipped) and you intend the new numbers to become the regression reference.

```bash
git switch main   # rebaseline must measure main, not a feature ref
node scripts/benchmark-backlog/run.mjs rebaseline --iterations=3 > scripts/benchmark-backlog/baseline.json
```

The full-corpus cost gate above applies — this is the single largest spend the skill offers; confirm before launching. After writing, show the new `baseline.json` summary (per-scenario gatePassRate + token totals + costUsd) and remind the user the file is committed (it is the regression reference) — staging/commit is the user's call; this skill does not `git add`/`commit`.

## Report back

**The runner writes the durable report itself.** Every `run.mjs` invocation (all modes) renders the
markdown report (header + `renderEvaluation`/`renderCompare` table + a findings summary) and writes it
to the **gitignored** `benchmarks/backlog/<mode>-<ISO>.md`, printing `[bef] report written: <path>` to
**stderr** as the last line. This is the findable home for results — **never** a PR comment or the
ephemeral session scratchpad (user-memory: benchmark reports go to a gitignored file). Capture that
path from stderr.

When done, tell the user:

- **Report path:** the `[bef] report written: <path>` line from stderr — the durable markdown report. **Show this link/path first.**
- **Deterministic layers:** pass/fail for `node --test .claude/skills/backlog-*/test/*.test.mjs` and for `node --test scripts/benchmark-backlog/test/*.test.mjs`.
- **Mode + scope:** which mode ran, the `--skill`/`--scenario`/`--iterations` scope, and (for compare) the two refs.
- **Orchestration table:** the rendered `renderEvaluation` / `renderCompare` markdown (already in the report file; echo inline for convenience).
- **Findings:** every flagged scenario — `regression`: gatePassRate dropped vs baseline (or `anyGateFlip`); `compare`: REGRESSION rows; plus any scenario row carrying an `error`.
- **Cost:** total tokens spent across the run (sum the `tokens.total` across rows × iterations), reported in TOKENS not dollars; note the `costUsd` column is a price-weighted normalization number, not a subscription bill.
- For `rebaseline`: the path `scripts/benchmark-backlog/baseline.json` was overwritten, and that committing it is the user's call. (The human-readable report is still written to `benchmarks/backlog/rebaseline-<ISO>.md`.)

Do NOT chain into `git add`/`git commit`/deploy. The skill's surface ends at the run + the gitignored report (and, for rebaseline, the single `baseline.json` overwrite).
