---
id: import-boundary-dynamic-import-gap
status: shipped
closed: 2026-07-08
type: tooling
epic: runtime-operationalization
epic_role: core
notes: "import-boundary.test.mjs only matches static `from '…'` — a dynamic await import('…/content/…') in ring-1 would slip past the engine→content ban. Extend the regex to import(…)."
references: []
out_of_scope:
  - "New ring bans or direction rules (e.g. content→adapter) — this closes the import-SHAPE gap in the existing engine→{adapters,content,skills} bans only."
  - "Variable-path dynamic imports (resolve-evaluator's `import(pathToFileURL(abs).href)`) — stay legal by design; only string-literal specifiers are statically judgeable."
  - "Migrating this guard into a runtime/content check yaml — it is a ring-1 self-test and intentionally stays a node --test guard."
spec: null
plan: null
topic_memory: [project_runtime_realization.md]
validation_gate: "Commit a16fd74d (main): BANNED_RING_IMPORT covers static from / bare / dynamic string-literal imports + seamViolation predicate + fixture-shape test. Fail-proven on injected dynamic (worker.mjs) and bare (journal.mjs) violations; clean-tree green; variable-path import (resolve-evaluator pathToFileURL) verified legal. pnpm nx run-many -t test,lint -p runtime,tools → 403 pass 0 fail. detect-deploy exit 10 (all Tier 0). Runtime-engine drive fallback-free (soak 4/5): run-next.mjs exit 0 'worked import-boundary-dynamic-import-gap; ship approved', ship-recheck gate-clean + consider --none journaled (sha 91d969c5)."
---

# import-boundary guard: dynamic `import()` slips past the ring-1 seam bans

Found in the post-ship review of WS-3. `runtime/engine/test/import-boundary.test.mjs:17-18` bans engine→adapter / engine→skill / engine→content / shelling-claude via patterns anchored on `from ['"]…` — static imports only. A future ring-1 file that lazily loads content via `await import('../../content/lib/classify-lane.mjs')` (the exact shape the *adapter* ring legitimately uses — `deploy-gate-runner.mjs:33-34`, `await import('../../../.claude/skills/…')`; cited as lines 18-19 at filing time, drifted since) would reintroduce the WS-3 first-cut violation without failing the guard. Bare side-effect imports (`import '…/content/…'`) are also unmatched.

**Fix:** add `import\(\s*['"][^'"]*\/(adapters|content)\//` (and the bare-import form) to the offender patterns; verify the extended guard fails on an injected dynamic-import violation, mirroring how the WS-3 engine→content extension was verified.

**Promoted 2026-07-08** (parking → queued, rank 4, user-confirmed): drained from the `runtime-operationalization` theme epic as a standalone runtime-driven workstream — soak-gate target 4/5. No trigger sentence existed to remove; the item was parked only as a theme-epic member.

## Decision log

<!-- append-only (F-6): entries are never edited or removed; a reversal is a NEW entry referencing the superseded one. Written by decision-log.mjs — do not hand-edit. -->

### D1 — 2026-07-08
- **Decision:** Named parking item vs default rank pick
- **Options:** Promote import-boundary-dynamic-import-gap to queued rank 4 and proceed | Stop and leave in parking | Fall back to rank-1 queued item
- **Chosen:** Promote to rank 4 + proceed
- **Rationale:** User-confirmed via AskUserQuestion (parking refusal is a floor stop even in --auto). Core member of runtime-operationalization; counts toward the soak gate (target 4/5). Mirrors the epic-clean-fixture-twin-id-typo precedent.
- **Rejected:** Stopping wastes the confirmed intent; the rank-1 item was not what the user asked for.

### D2 — 2026-07-08
- **Decision:** Guard extension shape: append regex alternations inline vs refactor to a named seam-violation predicate + committed fixture-shape test
- **Options:** Minimal inline regex additions | Named BANNED_RING_IMPORT regex + seamViolation(src) predicate + fixture-string shape test
- **Chosen:** Named predicate + fixture-shape test
- **Rationale:** Most reusable/cleanly-abstracted option (CLAUDE.md hard constraint): the predicate documents all three ESM shapes in one place and the fixture test locks shape coverage permanently (regression-tests-with-fixes), beyond the WS-3-style one-off injected-violation verification (also performed). Blast radius is test-file-internal — no shared surface.
- **Rejected:** Inline alternations re-open the same gap class on the next shape and leave coverage unverifiable.

### D3 — 2026-07-08
- **Decision:** 6.4b floors: ship ask + mint consideration
- **Options:** Ship | Hold | Mint a check | Nothing mechanizable
- **Chosen:** Ship + nothing mechanizable (consider --none)
- **Rationale:** User-confirmed both via AskUserQuestion. Ship evidence: guard fail-proven on 2 injected violations, clean-tree green, runtime+tools 403/403, ship-recheck gate-clean, Tier-0 no-deploy. Mint: lesson mechanized directly into the extended guard + fixture-shape test; no second instance to generalize over.
- **Rejected:** Holding had no failing evidence; minting a meta-check is over-abstract (extend-not-remint precedent).
