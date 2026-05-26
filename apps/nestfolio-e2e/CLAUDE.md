# nestfolio-e2e — Playwright conventions

This app holds the Playwright end-to-end suite for the investor PWA.
It is **complementary** to `apps/e2e-feature-tests` (which exercises
per-domain backend flows via GraphQL); Playwright only proves
assertions that require a real browser driving the real UI.

## Folder split

- `journeys/` — flows where the *user-driven sequence itself* is what's
  being tested (today: the onboarding wizard). Each journey pays the
  wizard-driving cost (≈30–60 s of agent calls). Use `authedPage` and
  drive the wizard end-to-end.
- `scenarios/` — narrow UX/state assertions for any surface *post*
  onboarding. Use `onboardedPage` (skips the wizard via
  localStorage seed) and inject events synthetically via
  `fixtures/inject-*.ts`. Each scenario should run in seconds, not minutes.

**Default to `scenarios/`.** Only put a test in `journeys/` if the
wizard or a multi-feature user-driven sequence IS the test surface.

## Fixture choices

| Fixture | When |
|---------|------|
| `authedPage` | Wizard test or anywhere onboarding must run for real. |
| `onboardedPage` | Anything after onboarding — dashboard, advisory, ledger surfaces. |

## What backend state-setup belongs in PW

Only the state that's hard or slow to reach via direct API.
Default: inject the carrier event via `fixtures/inject-*.ts` rather
than driving the full user-facing chain.

What does NOT belong in PW:
- Asserting "EventBridge delivered the event" — that's an integration
  test in the producing service.
- Asserting "this DDB write happened" — same.
- Asserting "compliance fired rule X" — same.

PW is for: "given the system has reached state X, does the UI render Y."

## Event-injection $or filter

Synthetic events sent to a domain bus must carry
`source: 'integration-test:<consumer-service>'` so they pass the consumer's
$or filter (see `services/*/src/service.stack.ts` for the
`integration-test:` prefix handling). Reuse `inject-advisory-update.ts`
as the canonical reference.

## Anti-flake discipline

Every scenario must pass twice consecutively on `nestfolio-e2e:e2e`
before being declared green. A rerun-pass after a fail is not evidence
of greenness — see `feedback_flake_means_broken.md`. Pull
CloudWatch logs from the failing window before parking.

## Adding a new scenario

1. Decide: does this need the wizard? If yes → `journeys/`. If no →
   `scenarios/`.
2. Pick the fixture (`authedPage` or `onboardedPage`).
3. If a state setup helper doesn't exist, add it under `fixtures/`.
4. Add the test file under the chosen folder.
5. Run it twice; do not rely on a single passing run.
