Execute the implementation plan at `docs/superpowers/plans/2026-03-24-fix-event-chain-gaps.md` using subagent-driven development.

The plan fixes 7 confirmed event-chain issues across 4 waves (7 tasks):

- **Wave 1 (Critical CDC):** Task 1 fixes execution-ctrl Order CDC mapping (function-based resolver for status→event type). Task 2 makes broker-adpt emit DEPOSIT_DETECTED. Task 3 makes broker-adpt emit WITHDRAWAL_COMPLETED.
- **Wave 2 (Notifications):** Task 4 adds WITHDRAWAL_COMPLETED forwarding to InvestorBus. Task 5 adds ORDER_REJECTED, DECISION_BLOCKED, WITHDRAWAL_COMPLETED notification templates to investor-ctrl.
- **Wave 3 (Staged Orders):** Task 6 creates a scheduled Lambda to process staged orders at market open.
- **Wave 4 (Docs):** Task 7 updates data-flow documentation.

Run all tests after each wave: `pnpm nx run-many --target=test --all`
