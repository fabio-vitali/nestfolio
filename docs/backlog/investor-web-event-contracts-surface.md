---
id: investor-web-event-contracts-surface
status: parking
type: refactor
epic: typed-test-fixtures
epic_role: captured
notes: "Surfaced 2026-06-17 by typed-test-fixtures Phase 1 (Investor). investor-web PRODUCES USER_REGISTERED + USER_AUTHENTICATED (direct PutEvents from the Cognito post-confirmation / post-authentication trigger handlers, inlined subject `{ userId, tenantId, email }`), but investor-web has NO contracts surface: no package.json, no `exports`, no `@nestfolio/investor-web/*` tsconfig path, no src/domain. So these two events have no producer-owned zod schema, cannot be registered in @nestfolio/test-contracts EventSubjects, and their fixtures (≥3 sites: e2e helpers/fixtures.ts onboarded() USER_REGISTERED, investor-bff integration USER_REGISTERED ×2) were LEFT LEGACY in Phase 1. The registry-driven gate does not flag them (they are unregistered), so it stays green — but the Investor domain is not fully typed until these are homed. Forcing a home was deliberately deferred (not done in Phase 1): the two clean options are (a) stand up a minimal `@nestfolio/investor-web/contracts` lib surface (package.json exports + tsconfig path) owning a UserRegisteredSchema/UserAuthenticatedSchema (DRY subject is just `{ email? }` since identity is context), or (b) relocate the schema to a producer-owned home — but NOT inside a consumer (investor-bff), which would break the producer-ownership invariant the whole typed-subject program rests on. Captured under the typed-test-fixtures epic (does not block the epic's done_when, which is scoped to migratable producer events). Promote when standing up investor-web's contract surface or in a typed-test-fixtures cleanup pass."
references:
  - services/investor/investor-web/src/handlers
  - apps/e2e-feature-tests/src/helpers/fixtures.ts
out_of_scope: []
spec: docs/superpowers/specs/2026-06-16-typed-test-fixtures-design.md
plan: null
topic_memory: [project_event_subject_contracts.md]
validation_gate: null
---

# investor-web has no contracts surface → USER_REGISTERED / USER_AUTHENTICATED can't be typed

investor-web is the Angular frontend + Cognito trigger app. Its `post-confirmation` /
`post-authentication` handlers emit `USER_REGISTERED` / `USER_AUTHENTICATED` directly via
PutEvents with an inlined subject, but the project exposes no importable contracts
(`@nestfolio/investor-web/contracts` does not exist). Consequently these two events have no
producer-owned zod schema, are not in the `EventSubjects` registry, and their test fixtures
stayed on the legacy `putEvent({ detail })` form in Phase 1.

Resolving it means giving investor-web a minimal producer-owned contract surface (or a
correctly-homed schema) — explicitly NOT homing a producer's contract inside a consumer, which
would violate producer ownership. Captured (not core) under [[typed-test-fixtures]].
