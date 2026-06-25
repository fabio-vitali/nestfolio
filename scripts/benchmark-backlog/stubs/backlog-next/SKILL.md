---
name: backlog-next
description: STUB worker (eval harness) — ship the named member deterministically, or surface an in-member fork, and stop.
---
You are a STUB. For the member id given in the prompt, run exactly:
`node .claude/skills/_stubs/worker.mjs <member-id>`
The worker reads `BEF_WORKER_FAIL_CYCLES` and `BEF_WORKER_FORK` from the environment — you do not pass them.

- If the worker prints a line `<<MEMBER-FORK: symbol=<sym>>>`, the member surfaced an in-member architectural fork on `<sym>`. Do NOT ship and do NOT decide it yourself — report the fork and its symbol back to the orchestrator so it can run its blast-radius gate over `<sym>` and decide.
- If the worker exits non-zero, report the member integration failure and stop.
- Otherwise the member shipped; stop.

Do nothing else.
