# Gate-0 spike findings

> Empirical de-risk spike for the backlog-eval-framework. Each item is accept/reject.
> CLI under test: **2.1.190** (plan said 2.1.187 — minor drift, behavior consistent).
> Probe model: `claude-haiku-4-5-20251001` (cost control). Probe sandboxes in `/tmp/bef-*`.

<!-- GATE VERDICT goes here (Task 0.6) -->

---

## Task 0.1 — Headless baseline + `--verbose` + isolation + event shape — **ACCEPT**

**Commands run** (in `/tmp/bef-spike`, a fresh `git init` repo):

```bash
# First attempt with `env -i HOME=<sandbox>` FAILED:
#   result.is_error=true, "Not logged in . Please run /login" (authentication_failed)
#   -> credentials live in the REAL $HOME; a sandbox HOME strips auth too.
# Working invocation strips only AWS_* and keeps the real HOME:
env -u AWS_PROFILE -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY \
    -u AWS_SESSION_TOKEN -u AWS_REGION -u AWS_DEFAULT_REGION \
  claude -p "reply with the single word OK" --print --verbose --output-format stream-json \
    --setting-sources project --strict-mcp-config --model claude-haiku-4-5-20251001
# exit=0, 9 stream lines, result "OK"
```

**Isolation - init/system event (`type:system, subtype:init`):**
- `mcp_servers: []` ACCEPT
- `plugins: []` ACCEPT
- `permissionMode: "default"` (NOT `auto`) ACCEPT
- no `hooks` key present at all (no SessionStart hook re-injecting context) ACCEPT
- `apiKeySource: "none"`
- `--setting-sources project --strict-mcp-config` alone achieves full isolation. `env -i` / sandbox HOME is NOT needed and actively BREAKS auth - **do not** strip HOME; strip only `AWS_*`.

**`result` event keys (final event):** `usage`, `total_cost_usd`, `duration_ms`, `duration_api_ms`, `ttft_ms`, `ttft_stream_ms`, `num_turns`, `subtype` (`"success"`), `type` (`"result"`), `is_error`, `result`, `modelUsage`, `terminal_reason`. All required keys present.

**Parser field paths (CRITICAL for Phase 1) - plan's assumption CONFIRMED CORRECT:**
- Per-turn usage lives at **`ev.message.usage`** (exactly as the plan's parser assumes).
  - keys: `input_tokens, cache_creation_input_tokens, cache_read_input_tokens, output_tokens` (+ `cache_creation`, `service_tier`, `inference_geo`).
- Content blocks live at **`ev.message.content[]`** - each block has `block.type` (`"text"` here; `"tool_use"` blocks carry `block.name` + `block.input`).
- `assistant` event top-level keys: `type, message, parent_tool_use_id, session_id, uuid, request_id`.
- NO field-path correction needed - the plan's `parseStreamJson` (`ev.message.usage` / `ev.message.content`) works against the captured fixture verbatim.

**Note on cost:** with `--strict-mcp-config` isolation, the first turn still shows `cache_creation_input_tokens` ~6.5k + `cache_read_input_tokens` ~16.6k (system-prompt boilerplate). This is the "floor" the `firstTurnProseTokens` proxy subtracts.

**Fixture captured:** `scripts/benchmark-backlog/test/fixtures/stream-events/completed.jsonl` (9 lines, verbatim).

**Verdict: ACCEPT** - isolation via `--setting-sources project --strict-mcp-config`; result+assistant shapes match the plan's parser; fixture saved.

---

## Task 0.2 — Worker / Skill-tool interception seam (THE critical gate) — **ACCEPT**

**Mechanism that works: cwd `.claude/skills/` discovery.** No `--plugin-dir` needed.

**Sandbox** (`/tmp/bef-spike2`, fresh git repo): a stub `.claude/skills/backlog-next/SKILL.md`
(body: "Run exactly `node .claude/skills/_stubs/worker.mjs MEMBER-ID` then stop") + a trivial
`.claude/skills/_stubs/worker.mjs` that appends `backlog-next-worker <id>` to `stubs.log`.

**Command:**
```bash
env -u AWS_PROFILE ... \
  claude -p "Use the backlog-next skill to ship member acme-1." --print --verbose \
    --output-format stream-json --setting-sources project --strict-mcp-config \
    --allowedTools "Skill Bash" --model claude-haiku-4-5-20251001
# exit=0
```

> NOTE: `--allowedTools "Skill Bash"` was required so the headless run could invoke the Skill
> tool and run the worker via Bash under `permissionMode:default`. The real harness must allow
> `Skill` + `Bash` (and deny the rest per the isolation default-deny).

**Rigorous verification (NOT inferred from prose) — three independent signals all positive:**
1. **Discovery:** the `init` event's `skills` array **includes `backlog-next`** -> the headless CLI
   discovered the sandbox-cwd project skill `.claude/skills/backlog-next/SKILL.md`.
2. **Invocation:** stream contains a `tool_use` block `Skill` with input
   `{"skill":"backlog-next","args":"acme-1"}` -> the Skill tool invoked the discovered skill.
3. **Execution:** stream contains a `tool_use` block `Bash` with command
   `node .claude/skills/_stubs/worker.mjs acme-1` -> the deterministic worker actually ran.
4. **On-disk:** `stubs.log` contains exactly `backlog-next-worker acme-1`.

**Verdict: ACCEPT** - cwd `.claude/skills/` discovery works headlessly; the worker seam is viable.
The entire `backlog-next-epic` corpus is feasible as designed. **Sandbox builder parameterization:
install the stub `backlog-next` skill into the sandbox `.claude/skills/` (cwd discovery), and run
with `--allowedTools` including `Skill` + `Bash`.**

---

## Task 0.3 — Per-op stub seams (deploy.sh / nx / gh) — **ACCEPT** (with one builder requirement)

Sandbox `/tmp/bef-spike3`: in-repo `infrastructure/scripts/deploy.sh` (chmod +x), `node_modules/.bin/nx`
(chmod +x, honors `BEF_NX_EXIT`/`BEF_NX_COLLECTED`), `gh` PATH shim in `.binshim/`.

| Op | Probe | Result |
| -- | ----- | ------ |
| `deploy.sh` | `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev` | logged `deploy.sh sandbox --prefix=dev` ACCEPT |
| `gh` | `PATH="$PWD/.binshim:$PATH" gh pr view 1` | logged `gh pr view 1` ACCEPT |
| `nx` | `pnpm nx run x:y` | see below |

**`pnpm nx` resolution — IMPORTANT discrepancy from the plan:**
- **First attempt FAILED:** `pnpm nx run x:y` in a repo with NO `package.json` -> `ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND`
  (exit 1, nothing logged). pnpm refuses to run a local bin without a manifest.
- **Fix:** add a minimal `package.json` (`{"name":"bef-sandbox","version":"0.0.0","private":true}`) to the sandbox.
  After that, `pnpm nx run x:y` resolves `node_modules/.bin/nx` cleanly: logged `nx run x:y`, exit 0, "Tests: 1 collected".
- **Env knobs honored:** `BEF_NX_EXIT=2 BEF_NX_COLLECTED=7 pnpm nx run a:b` -> exit 2, "Tests: 7 collected".

**Builder requirement (parameterizes `sandbox.mjs`):** the sandbox MUST write a minimal `package.json`
at its root so `pnpm nx` resolves the stub at `node_modules/.bin/nx`. (No `pnpm` shim needed; the local
bin is resolved by real pnpm once a manifest exists.) `deploy.sh` is invoked at its in-repo path; `gh`
is reached via a `.binshim/` (or `.bin/`) dir prepended to the run's PATH.

**Verdict: ACCEPT** - all three ops hit their stubs. The only adjustment vs the plan: add a minimal
`package.json` to the sandbox (pnpm needs a manifest before it resolves `node_modules/.bin/nx`).

---

## Task 0.4 — Pause sentinel via `--append-system-prompt` — **ACCEPT** (use the STRONGER convention)

**Original (plan) convention — 2/3 (UNRELIABLE):**
> "When you would call AskUserQuestion or otherwise pause for a user decision, emit a single final
> line exactly of the form `<<HARNESS-PAUSE: reason>>` and then stop. Do not ask in prose."

Runs 1-2 emitted the sentinel; run 3 asked in prose ("Could you provide the context...?"). 2/3 is
not acceptable for a comparability oracle, so a stronger convention was tested.

**STRONGER convention — 6/6 (RELIABLE):**
> "CRITICAL OUTPUT CONTRACT: You are running headless with no interactive user. You CANNOT ask
> questions in prose and you CANNOT use AskUserQuestion. Whenever you lack information to proceed,
> face a user decision, or would otherwise ask the user anything, your ENTIRE final response MUST
> be exactly one line: `<<HARNESS-PAUSE: brief reason>>` and nothing else. Never phrase a question as
> prose; always encode it as that sentinel line."

- Batch 1 (same forced-decision prompt 3x): 3/3 HIT.
- Batch 2 (3 varied decision prompts): 3/3 HIT. (One run initially scored MISS due to a fragile
  `tail -1 | JSON.parse` measurement pipe choking on a multi-line result; re-checked robustly via
  `node` reading the `result` event -> the sentinel WAS present. True score 3/3.)
- Net: **6/6** with the stronger convention.

**Why it works:** framing it as a "CRITICAL OUTPUT CONTRACT", explicitly stating "running headless
with no interactive user", and demanding the ENTIRE final response be the single sentinel line (not
just "a final line") removes the model's instinct to add a prose follow-up question.

**Verdict: ACCEPT** - use the STRONGER convention as the harness `pauseConvention`, applied
identically to both A/B variants (so it cannot bias the comparison). Grader detects pause via the
`<<HARNESS-PAUSE:` sentinel in the final `result` text.

**Measurement caveat for Phase 1:** detect the sentinel against the `result` event's `result` field
parsed by `node` (the classifier already does this) - NEVER via a shell `tail | JSON.parse` pipe,
which mis-handles multi-line results.

---

## Task 0.5 — Run-state seed + local origin (resume feasibility) — **ACCEPT**

Sandbox `/tmp/bef-spike5` with a local **bare** `origin` at `/tmp/bef-spike5-origin`, the REAL
`backlog-next-epic` helpers copied from
`/Users/fabiovitali/WebstormProjects/nestfolio/.claude/skills/backlog-next-epic/`, and a baseline
commit pushed so `origin/main` exists.

**Exact seed command sequence (becomes `buildSandbox`'s run-state seeding) — all from the repo root,
invoked with a RELATIVE helper path:**
```bash
RS=.claude/skills/backlog-next-epic/runstate.mjs
node $RS init acme --branch=feat/epic-acme --worktree=.claude/worktrees/epic-acme   # exit 0
echo '{ "commands":["x"],"outcome":"green","sha":"deadbeef" }' | node $RS set-e2e acme   # exit 0 (optional)
node $RS set-e8 acme PR_OPEN_AWAITING_MERGE   # exit 0
node $RS get acme   # exit 0, full seeded JSON incl. "e8":"PR_OPEN_AWAITING_MERGE" — NOT FRESH
```
The closed 6-key schema ACCEPTED the seed; `get` returns the seeded JSON (exit 0).

**Origin / worktree ops:**
- `git fetch origin main` -> succeeds.
- `git worktree add .claude/worktrees/epic-acme origin/main` -> succeeds ("HEAD is now at ... baseline").

**IMPORTANT builder caveat (a /tmp symlink trap) — discovered during the spike:**
`runstate.mjs`'s entrypoint guard (line ~213) is
`import.meta.url === file://${process.argv[1]} || fileURLToPath(import.meta.url) === process.argv[1]`.
Invoking the helper with an **absolute** `/tmp/...` path (e.g. `node /tmp/bef-spike5/.../runstate.mjs get acme`)
on macOS makes `process.argv[1]` = `/tmp/...` while `import.meta.url` resolves the symlink to
`/private/tmp/...` -> NEITHER comparison matches -> `main()` never runs -> **silent exit 0 with empty
output** (looks like a seam failure but is not). The `--git-common-dir` path itself resolves correctly.
**Fix / requirement:** ALWAYS invoke the helper with a RELATIVE path from the sandbox repo root
(`execFileSync('node', ['.claude/skills/backlog-next-epic/runstate.mjs', ...], {cwd: dir})`) — exactly
what the plan's `seedRunState` already does. With the relative form, `get` returns the seeded JSON
from both the repo root AND a worktree cwd (common-dir path stable, no FRESH misclassification).

**Verdict: ACCEPT** - helper-seeded run-state + local-origin worktree/fetch all work; the closed schema
accepts the seed; resume is feasible. Builder must use relative helper paths (avoids the /tmp symlink trap).
