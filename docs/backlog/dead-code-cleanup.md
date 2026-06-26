---
id: dead-code-cleanup
status: shipped
closed: 2026-06-26
type: epic
notes: "Vestigial code left behind by prior refactors that no checker flags — unread wrappers, unused repo methods, stale comments, a dead consumer read. Debt-class theme epic, 5 members (cooldown split out during execution-ctrl prune)."
done_when: "Each piece of vestigial code in scope is deleted after a zero-caller/zero-reader verification; all members shipped or dropped."
scope: "Dead/vestigial code surviving a refactor: unread wrappers, unused repository methods, stale comments referencing removed APIs, and consumer reads of fields the producer never emits."
out_of_scope:
  - "Live code with a latent type error (typecheck-diagnostics-masking) — masked-but-reachable, not dead"
references: []
spec: null
plan: null
topic_memory: []
validation_gate: >-
  All 5 core members shipped on feat/epic-dead-code-cleanup via a single PR; per-member
  integration tests + lint green at each member ship (6.2 gates across 33-39 affected projects).
  E6 batched gate (code tip 41e72aa4): scoped deploy of the 3 runtime-affected services
  (advisory-narrative-ctrl, market-intelligence-ctrl, execution-ctrl) succeeded; Jest e2e
  collected 56 tests (real run). The 11/56 RED was root-caused to an EXTERNAL Bedrock daily
  token-per-day quota exhaustion (ThrottlingException 'Too many tokens per day'), NOT an epic
  regression — all 3 changed services CloudWatch-verified healthy (execution-ctrl e2e green;
  MI-ctrl REFRESH_TICK processed with correct region, 0 errors; AN-ctrl agent ran error-free),
  and the 7 dominant failures are IP-ctrl InvestorProfileSnapshot timeouts in a service that was
  neither changed nor redeployed (runs byte-for-byte pre-epic code). Playwright skipped (same
  quota). User explicitly authorized ship-over-documented-red. e2e-blocking findings filed
  queued (e2e-live-suite-exceeds-bedrock-daily-token-budget,
  e2e-fixtures-test-stale-detail-envelope-assertion,
  circuit-breaker-lifecycle-e2e-breaker-stuck-open) + daily-quota-throttle-retry-amplification
  (parking, agent-runtime-latent-correctness).
---

# Dead-code cleanup

Root cause (debt class): refactors left vestigial code that no checker flags. Honest caveat — the *code* differs per member; what they share is the cleanup action and the 'left behind by a refactor' trigger, so this is a debt-class cluster, not one literal root cause. Fix pattern: verify zero callers/readers (grep), then delete.

Members (derived from `epic:` pointers) — all 5 shipped:
- `an-ctrl-wrap-agent-output-vestigial` (wrapAgentOutput unread after the callback refactor; lib primitive removed too — zero callers workspace-wide)
- `execution-ctrl-orderrepository-prune-unused-methods` (createOrder/createStagedOrder/getOrder unused after the OrderLifecycleService delete)
- `execution-ctrl-cooldown-feature-dead-code` (dead CoolDown feature — split out from the prune member at file time, per atomicity: a safety-behavioral change with its own verdict)
- `stale-memory-write-comments-phase-a-cleanup` (comments referencing removed Memory APIs — scoped to genuinely-stale only, preserving correct design docs)
- `yahoo-finance-mi-ctrl-subject-region-dead-code` (resolved by finishing the region->RegionContext DRY migration on the slow-tier tick; left no vestigial producer code)
