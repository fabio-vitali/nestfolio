# Review: absorb-command-core plan

**Verdict: Issues Found**

## Issues

### Issue 1 (Minor): Incorrect import list for `account.reducer.ts` in Task 3 Step 1

The plan states `account.reducer.ts` imports: `defineCommand, applyCommand, type CommandDef, type LedgerEntry, type EventReducer, replayEvents`

Actual imports (line 1-4):
```ts
import {
  type EventReducer,
  applyCommand,
} from '@nestfolio/command-core';
```

Only `type EventReducer` and `applyCommand` -- not 6 symbols. This is cosmetic (the mechanical replacement is the same), but the inaccuracy could confuse the executor.

### Issue 2 (Minor): Count mismatch -- "7 test files" vs actual 6

Line 7 of the plan says "8 source + 7 test files". The actual consumer test files importing from `@nestfolio/command-core` are 6 (confirmed by grep). The File Structure table and Task 3 Step 2 both correctly list 6. Only the Architecture paragraph is wrong.

Note: `account.reducer.test.ts` and `handlers/reducer.test.ts` exist but do NOT import from `@nestfolio/command-core` -- they import from local `../../src/` paths.

### Issue 3 (Informational): eslint `agent-core` removal is safe

Confirmed: `@nestfolio/agent-orchestrator` has `scope:platform` tag, so all consumers (advisory-scope services) access it through `depConstraints`, not the `allow` list. The stale `@nestfolio/agent-core` entry can be safely removed without adding `@nestfolio/agent-orchestrator` as a replacement.

## Verified Correct

1. All source file paths exist and match plan contents verbatim (command.ts, reducer.ts, index.ts).
2. The `../platform` import fix in command.ts is correct -- `libs/event-processor/src/platform/index.ts` exports `Result, ok, err`.
3. The tsconfig wildcard `"@nestfolio/event-processor/*": ["libs/event-processor/src/*"]` correctly resolves `@nestfolio/event-processor/sourcing` to `libs/event-processor/src/sourcing/index.ts`.
4. The jest moduleNameMapper wildcard `'^@nestfolio/event-processor/(.*)$'` in ledger-ctrl already covers the new subpath -- no new mapper needed.
5. Task ordering is correct: create files (T1) -> move tests (T2) -> rewire consumer (T3) -> delete old lib (T4). No step depends on a later step.
6. Test commands (`pnpm nx build event-processor`, `pnpm nx test event-processor`, `pnpm nx test ledger-ctrl`) are correct.
7. The 8 source files and 6 test files in ledger-ctrl are all accounted for in the Files to modify table.
8. No other consumers of `@nestfolio/command-core` exist outside ledger-ctrl.
