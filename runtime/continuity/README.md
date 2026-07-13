# Continuity VS-001 implementation

This directory contains the bounded implementation used by **VS-001 — Resumable Agent Work Session**.

It is intentionally isolated from the current Nestfolio runtime. It proves only the accepted slice:

```text
select → start → keyed effect → checkpoint → interrupt → fresh-session resume
→ deduplicated effect → validate → Evidence → complete → candidate Lesson
```

## Commands

```bash
node runtime/continuity/adapters/claude-code/cli.mjs select --work-id <id>
node runtime/continuity/adapters/claude-code/cli.mjs start --working-set-id <id> --run-id <run> --session-id <session>
node runtime/continuity/adapters/claude-code/cli.mjs effect --run-id <run> --session-id <session> --key <key> --path <path> --content <text>
node runtime/continuity/adapters/claude-code/cli.mjs checkpoint --run-id <run> --session-id <session> --next-action <text>
node runtime/continuity/adapters/claude-code/cli.mjs interrupt --run-id <run> --session-id <session>
node runtime/continuity/adapters/claude-code/cli.mjs resume --run-id <run> --session-id <fresh-session>
node runtime/continuity/adapters/claude-code/cli.mjs validate --run-id <run> --session-id <session>
node runtime/continuity/adapters/claude-code/cli.mjs lesson --run-id <run> --session-id <session> --observation <text> --lesson <text>
node runtime/continuity/adapters/claude-code/cli.mjs complete --run-id <run> --session-id <session>
```

Canonical collaborative artifacts are under `continuity/artifacts/`. Active Run, lease, effect, audit, and derived state are under the declared inspectable `.continuity/` operational store. Claude Code transcripts are never authority.

## VS-001A — executor provenance (Claude Code session hooks)

**VS-001A — Interactive Claude Code Session Confirmation** closes the VS-001 evidence gap (criteria
4, 7, 8) without changing Core semantics. Project-local Claude Code hooks (wired in
`.claude/settings.json`) record real executor provenance for sessions launched with a Continuity
identity in the environment:

```bash
CONTINUITY_ACTION=start|resume CONTINUITY_RUN_ID=<run> CONTINUITY_SESSION_ID=<session> \
  [CONTINUITY_WORKING_SET_ID=<ws>] claude "<minimal pointer prompt>"
```

- `adapters/claude-code/hooks/session-start.mjs` — records the real Claude Code session id, startup
  source, model, cwd, timestamp, Claude Code version, Git revision, and the requested Continuity
  identity; invokes the existing `start`/`resume` CLI command; injects the adapter-produced
  execution view into the session context and records its path + digest. It never inspects
  transcript contents. Without the `CONTINUITY_*` variables it is inert.
- `adapters/claude-code/hooks/session-end.mjs` — records the real Claude Code session id, the
  termination reason, and the timestamp.
- Records live under `.continuity/executor-sessions/` (outside every Scope fingerprint path).
- `tools/validate-vs001a-executor-provenance.mjs --run-id run-vs001a [--criterion <id>]` proves the
  VS-001A acceptance criteria from repository-local records only; it backs the deterministic
  completion criteria in `continuity/bindings/nestfolio/work-items/continuity-vs001a-claude-code-session-confirmation.json`.
