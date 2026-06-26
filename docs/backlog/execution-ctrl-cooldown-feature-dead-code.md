---
id: execution-ctrl-cooldown-feature-dead-code
status: shipped
closed: 2026-06-26
type: refactor
notes: "Surfaced 2026-06-26 while pruning OrderRepository in execution-ctrl-orderrepository-prune-unused-methods. The CoolDown feature is half-dead: OrderRepository.setCoolDown (the WRITE side) has ZERO production callers (only its own unit test), so the CoolDown row is never written. Yet safety-checks.service.ts:41 still calls getCoolDown on every staged-order safety check → it always reads null → the cooldown guard is a permanent no-op. Same 'read of data the producer never writes' pattern the epic targets. Removing it deletes a (currently no-op) safety-check branch, so it needs its own verdict — NOT a trivial method prune. Verify the no-op claim (grep setCoolDown = zero writers) before deleting setCoolDown + getCoolDown + the safety-check cooldown branch + coolDownPk helper."
references: []
out_of_scope:
  - "SafetyChecksService.checkReconciliationLock — a deliberate 'Phase 2: simplified, always returns false' stub awaiting implementation, NOT vestigial code; leave it"
  - "Any redesign of the safety-check pipeline or its SafetyCheckResult shape beyond removing the coolDown member"
spec: null
plan: null
topic_memory: []
validation_gate: "Commit 1742fc70 on feat/epic-dead-code-cleanup. Re-confirmed setCoolDown has zero production writers workspace-wide (only its own unit test); no production code read SafetyCheckResult.checks.coolDown (event-listener/staged-order-processor consume runAllChecks via .passed/.reason). Removal is behavior-preserving — checkCoolDown always returned false, so the runAllChecks cooldown branch never fired. Removed setCoolDown/getCoolDown/coolDownPk + unused TableEntry/RequestContext imports (order.repository.ts), checkCoolDown + the runAllChecks branch + the coolDown result field (safety-checks.service.ts), and all cooldown unit tests; re-pointed the two 'fail safety check' fixtures to the real conflictingStagedOrders mechanism. checkReconciliationLock (deliberate Phase-2 stub) kept. 6.2 gate GREEN: `nx run-many -t test lint` across 33 projects (EXIT 0; execution-ctrl 7/7 suites). Deploy + integration/e2e deferred to epic E6 batched gate per logged decision."
epic: dead-code-cleanup
epic_role: core
---

# Remove the dead CoolDown feature in execution-ctrl

`OrderRepository.setCoolDown` (services/execution/execution-ctrl/src/repositories/order.repository.ts)
has **zero production callers** — the only reference is its own unit test. The `CoolDown` row is
therefore never written.

The READ side is still wired: `safety-checks.service.ts:41` calls `getCoolDown(tenantId, instrument)`
on every staged-order safety check. Because nothing ever writes a `CoolDown` row, that read always
returns `null` and the cooldown guard is a **permanent no-op** — the same "consumer reads data the
producer never emits" vestigial pattern the `dead-code-cleanup` epic targets.

**Why this is a separate member (not folded into the OrderRepository prune):** removing it deletes a
branch from `safety-checks.service.ts` — execution-safety logic. Even though the branch is currently
a no-op, that is a *behavioral* edit with its own closure verdict, distinct from the pure-dead-method
prune of `createOrder`/`createStagedOrder`/`getOrder`.

**Scope (after re-confirming zero writers):**
- `OrderRepository.setCoolDown` + `getCoolDown` + the private `coolDownPk` helper
- the `getCoolDown` cooldown branch in `safety-checks.service.ts`
- the corresponding unit tests

If a future requirement re-introduces cooldowns, this is a feature to *rebuild deliberately*, not a
guard to preserve as dead code.
