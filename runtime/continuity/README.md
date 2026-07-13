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
