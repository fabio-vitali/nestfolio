---
id: silent-discard-unknown-operating-mode-narrowing
status: shipped
rank: null
type: bug
references:
  - services/advisory/portfolio-engine-ctrl/agents/portfolio-engine/graph.ts
out_of_scope:
  - "Applying the same narrowing-with-warn to advisory-narrative-ctrl/agents/advisory-narrative/graph.ts (uses untyped string narrowing without an OperatingMode union — separate refactor)."
  - "Promoting the warn to a thrown error or hard-fail — backlog explicitly calls for warn+fallback so a real-money cycle keeps producing allocations on a typo'd mode."
  - "Adding logger from @nestfolio/event-processor — graph.ts runs inside AgentCore Runtime, not a Lambda context; console.warn is the correct sink (CloudWatch Agent Runtime log group)."
  - "Replacing the `as string` cast at lines 108-109 with a runtime type guard — separate cleanup."
spec: null
plan: null
topic_memory:
  - project_operating_mode.md
validation_gate: "pnpm nx test portfolio-engine-ctrl → 94/94 passed (was 91 — added 3 regression tests: warn fires for 'Conservative', no warn for canonical CONSERVATIVE/BALANCED/AGGRESSIVE, no warn when missing)."
shipped_at: "2026-05-07"
notes: "Shipped 2026-05-07 — added console.warn with structured payload (rawOperatingMode/tenantId/decisionId) before BALANCED narrowing in services/advisory/portfolio-engine-ctrl/agents/portfolio-engine/graph.ts. Five-condition guard: string + non-empty + not in {CONSERVATIVE,BALANCED,AGGRESSIVE}. TDD red→green."
---

# Silent discard of unknown operatingMode in portfolio-engine graph.ts narrowing

`services/advisory/portfolio-engine-ctrl/agents/portfolio-engine/graph.ts:111-114` (post-2026-05-07 stale-read cleanup; originally cited as 113-119). Surfaced 2026-05-07 during Task 4 code review of α-tune workstream.

When `payload.upstreamOutputs.operatingMode` (or the nested `investorProfile.operatingMode`) is a non-empty string that isn't `'CONSERVATIVE'`, `'BALANCED'`, or `'AGGRESSIVE'`, it silently collapses to `'BALANCED'` with no log signal. Pre-existing — the narrowing pattern existed before this workstream typed it as `Record<OperatingMode, string>`.

Production risk: a CONSERVATIVE mandate emitted with a typo (`'Conservative'`, `'conservative'`) silently produces BALANCED allocations.

## Fix

Insert `console.warn` before the narrowing assignment when `operatingModeRaw` is a string that is non-empty AND not in the canonical union. Keep the BALANCED fallback (changing fallback semantics is out-of-scope).

## Done definition

- `console.warn` fires with a structured payload containing the unrecognised raw value, tenantId, decisionId.
- Existing tests still green.
- New regression test in `services/advisory/portfolio-engine-ctrl/test/unit/graph.test.ts` asserts the warn fires for a mixed-case value and that the orchestrator is still invoked with `operatingMode: 'BALANCED'`.
- Canonical inputs (`'CONSERVATIVE'`, `'BALANCED'`, `'AGGRESSIVE'`) and missing/empty inputs do NOT trigger the warn.
