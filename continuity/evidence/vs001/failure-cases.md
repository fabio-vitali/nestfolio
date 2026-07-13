# VS-001 Failure-Case Evidence

| Required case | Observable result | Evidence |
|---|---|---|
| Unexpected or simulated Session termination | Session 1 became `interrupted`; a Handoff was published and the lease released. | `commands/06-interrupt.json`, `continuity/artifacts/sessions/session-vs001-1.json`, `continuity/artifacts/handoffs/run-vs001-session-vs001-1.json` |
| Stale repository or Context Pack at resume | Resume failed closed with `STALE_RUN` after a scoped file drifted. | `commands/07-stale-resume.json` |
| Missing required Evidence | Completion failed closed with `COMPLETION_GATE_BLOCKED` before validation/Evidence. | `commands/11-missing-evidence-block.json` |
| Failed validation | A deliberately corrupted material effect produced a failed Validation Result and completion remained blocked in the deterministic test. | `test-results.txt`, `runtime/continuity/test/resumable-session.test.mjs` |
| Conflicting second writer/Session | A second mutable Session was rejected with `LEASE_CONFLICT`. | `commands/05-conflicting-session.json` |
| Missing or mismatched Skill asset | Resume failed closed with `SKILL_ASSET_MISMATCH` after the locked Skill changed. | `commands/08-skill-mismatch.json` |
| Unsafe candidate Lesson | The unsafe Lesson was stored as `rejected`, remained `not_promoted`, and changed no Skill/Guard target. | `commands/13-unsafe-lesson-rejected.json`, `continuity/artifacts/lessons/lesson-555720ab-06d5-4e28-a40a-c59b5dc229c2.json` |
