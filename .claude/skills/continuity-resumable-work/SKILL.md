---
name: continuity-resumable-work
description: Start, checkpoint, resume, validate, and complete one Continuity Run from repository-local canonical state.
---

# Continuity resumable work

Use the adapter CLI; do not reconstruct state from chat.

```bash
node runtime/continuity/adapters/claude-code/cli.mjs select --work-id <id>
node runtime/continuity/adapters/claude-code/cli.mjs start --working-set-id <id> --run-id <run> --session-id <session>
node runtime/continuity/adapters/claude-code/cli.mjs checkpoint --run-id <run> --session-id <session> --next-action "<exact next action>"
node runtime/continuity/adapters/claude-code/cli.mjs interrupt --run-id <run> --session-id <session>
node runtime/continuity/adapters/claude-code/cli.mjs resume --run-id <run> --session-id <fresh-session>
node runtime/continuity/adapters/claude-code/cli.mjs validate --run-id <run> --session-id <session>
node runtime/continuity/adapters/claude-code/cli.mjs complete --run-id <run> --session-id <session>
```

Rules:

1. Read the generated `.continuity/derived/execution-views/<run>-<session>.md`.
2. Every material retryable effect uses a stable effect key.
3. Only a verified Checkpoint may be resumed.
4. A fresh Session must pass repository, Context Pack, Pack lock, Skill asset, and lease checks.
5. Failed or missing required Evidence blocks completion.
6. Record Observations and candidate Lessons; never promote them automatically.
