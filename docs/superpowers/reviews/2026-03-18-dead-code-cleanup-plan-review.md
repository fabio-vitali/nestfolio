# Review: Dead Code Cleanup Implementation Plan

**Plan:** `docs/superpowers/plans/2026-03-18-dead-code-cleanup.md`
**Spec:** `docs/superpowers/specs/2026-03-18-dead-code-audit.md`
**Verdict:** :x: Issues Found (1 blocking, 1 minor)

---

## Blocking Issue

### Task 2: Missing test file deletion for KnowledgeBase

The plan deletes `libs/cdk-constructs/src/knowledge-base.ts` and removes the barrel export, but does **not** delete the corresponding test file:

```
libs/cdk-constructs/test/knowledge-base.test.ts (137 lines)
```

This test imports `KnowledgeBase` from the source file being deleted. Running `pnpm nx test cdk-constructs` (Step 3 of Task 2) will **fail** because the test file tries to import a non-existent module.

**Fix:** Add to Task 2:
- Delete `libs/cdk-constructs/test/knowledge-base.test.ts`
- Add it to the `git add` in Step 5

---

## Minor Issue

### Task 3: investor-adpt — spec says remove `MandateLevel` + `RebalanceCadence`, plan says remove `OperatingMode` + `RebalanceCadence`

The spec (Section 1) lists `MandateLevel` and `RebalanceCadence` as dead for investor-adpt. The plan correctly identifies `MandateLevel` as a false positive (compliance-ctrl imports it from `@nestfolio/investor-adpt/domain`) and instead removes `OperatingMode` — which truly is dead (investor-bff defines its own in `service-domain/models.ts`, never imports from investor-adpt).

This is actually a **correction** of the spec, not a plan error. The plan is right, the spec is wrong. No action needed, but worth noting in the "Corrected Scope" section that `OperatingMode` replaced `MandateLevel` in the removal list.

**Suggestion:** Add `OperatingMode` to the "Corrected Scope" false-positive explanation to make clear why it differs from the spec's Section 1 listing.

---

## Checklist Results

| # | Check | Result |
|---|-------|--------|
| 1 | Plan covers all verified dead code from spec | PASS — all categories covered, false positives correctly excluded |
| 2 | File paths exact and correct | PASS — all 13 files verified on disk |
| 3 | Code snippets complete and correct | PASS — advisory-adpt, execution-adpt, investor-adpt, all 4 GraphQL files match source |
| 4 | Clear verification steps per task | PASS — each task has build + test commands |
| 5 | Missing dependencies between tasks | PASS — tasks are independent (different files) |
| 6 | Could any deletion break something? | **FAIL** — Task 2 will break `knowledge-base.test.ts` |
| 7 | Commit strategy sound | PASS — one commit per logical chunk, final full-suite verification |

---

## Summary

Fix the blocking issue (add `knowledge-base.test.ts` deletion to Task 2) and the plan is ready for execution. Everything else checks out — file paths are accurate, code snippets match source, false-positive exclusions are well-reasoned, and the commit strategy is sound.
