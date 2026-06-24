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
