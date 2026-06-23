---
id: test-support-typecheck-put-event-type-test-drift
status: parking
type: tooling
notes: "test-support:typecheck red on main — put-event.type-test @ts-expect-error drifted off the now-relocated overload error (false-red, not a masked real error)"
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# test-support:typecheck red — drifted @ts-expect-error in put-event negative type-test

`pnpm nx run test-support:typecheck` (which runs `tsc --noEmit -p libs/test-support/tsconfig.type-test.json`)
fails on `origin/main`, independent of any working-tree change (verified by stashing all edits and
re-running during the `test-integration-parallel-dns-exhaustion` workstream — the failure is present
on the clean base).

## Evidence

`libs/test-support/test/types/put-event.type-test.ts`:

- **line 40** — the `eb.putEvent({ … detailType: 'NOT_A_REAL_EVENT', … })` CALL now produces an
  **unsuppressed** `error TS2769: No overload matches this call` (`'NOT_A_REAL_EVENT'` is not a
  `RegisteredEventName`).
- **line 44** — the `@ts-expect-error` (sitting on the `subject:` line) is reported **unused**
  (`error TS2578`).

The negative type-test drifted: when it was written, the expected compile error landed on the
`subject:` property (hence the directive there); an SDK / overload-resolution change moved the error
up to the `putEvent(` call line, so the directive no longer covers it.

## Root cause vs. neighbours

Distinct root cause from [[typecheck-diagnostics-masking]] (that epic is *masked real production type
errors* + a *missing* gate; this is a **false-red in an existing, working gate** caused by a
miscalibrated negative type-test). Also distinct from the just-shipped
[[test-integration-parallel-dns-exhaustion]] (DNS-resolver exhaustion). Shares only a loose
"test-infra-reliability" root with `ci-pipeline` and the per-test `*-flake` orphans — a candidate to
cluster on the next `/backlog-themes` sweep, not force-clustered here.

## Cheapest next step

Reposition the `@ts-expect-error` to the line the error now lands on (the `putEvent(` call), **after
confirming** the surfaced TS2769 is genuinely the intended negative case (unknown event name
rejected) and not a different overload regression. Add a regression note so the directive's intent is
clear if overload resolution shifts again.

## Blast radius

Low today: the `typecheck` target is not in the standard `/backlog-next` 6.2 gate (`test` + `lint`).
Latent hazard for the `/backlog-next-epic` E6 cumulative-typecheck (F-21) gate if `test-support` ever
lands in an affected set. Does NOT affect the two e2e apps.
