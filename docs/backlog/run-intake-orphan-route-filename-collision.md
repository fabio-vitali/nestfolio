---
id: run-intake-orphan-route-filename-collision
status: parking
type: bug
notes: "run-intake.mjs's orphan route derives the written filename from the check id alone (from-<check>.md), not the finding id; a second finding from the same check silently overwrites the first finding's already-filed backlog item."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# runtime/adapters/claude-code/run-intake.mjs: orphan route filename collides across findings of the same check

## Evidence (discovered 2026-07-19 while filing 4 audit-e2e-test findings)

`docs/backlog/from-audit-e2e-test.md` was already filed 2026-07-06 from finding `audit-e2e-test#0` (`provenance.from_finding: audit-e2e-test#0`, the forbidden `@nestfolio/integration-testing` import). Filing a second, unrelated finding from the same check (`audit-e2e-test#1`, the DDB-read-justification gap) through `node runtime/adapters/claude-code/run-intake.mjs --finding <f1.json> --fulfil execute:intake-audit-e2e-test#1 --value '{"taskId":"intake-audit-e2e-test#1","status":"done","summary":"{\"route\":\"orphan\",...}"}'` returned `"written": ["docs/backlog/from-audit-e2e-test.md"]` — the SAME path — and silently overwrote finding #0's `done_when`/body with finding #1's content (`git diff` confirmed the full replacement; caught and reverted via `git checkout` before it was committed, so no published data was actually lost).

Root cause (inferred from behavior, source not yet read): the orphan-route filename is derived from `from-<check-id>` alone, not from the finding's own id/index (`audit-e2e-test#0` vs `#1` both map to `from-audit-e2e-test`). Any check that raises more than one orphan-routed finding across separate `run-intake.mjs` invocations will collide the same way.

## Cheapest next step

Derive the orphan filename from the finding id (e.g. `from-<check-id>-<n>` or a content-derived slug), or check for an existing file at the target path before writing and refuse/disambiguate on collision instead of silently overwriting.
