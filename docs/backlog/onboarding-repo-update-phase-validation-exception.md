---
id: onboarding-repo-update-phase-validation-exception
status: dropped
type: bug
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
notes: "Latent backend bug; non-blocking for onboarding e2e per Spec 3 ship."
---

# `OnboardingRepository.updatePhase` ValidationException on non-mandate commits

Latent backend bug; non-blocking for onboarding e2e per Spec 3 ship.

**Dropped 2026-06-05** — unverifiable and non-blocking. The dossier is a single line with
no reproduction. Re-inspecting `OnboardingRepository.updatePhase`, the `UpdateCommand`
expression uses placeholders correctly (`#phase`/`#ts` names, `:data`/`:next`/`:idx`/`:ts`
values) with an `attribute_exists(pk)` condition — nothing structurally wrong is visible,
and the onboarding e2e suite is green. With no repro and no observable failure, there is
nothing actionable to track. Re-file with a concrete failing case if one is ever captured.
