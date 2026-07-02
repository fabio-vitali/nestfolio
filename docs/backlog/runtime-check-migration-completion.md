---
id: runtime-check-migration-completion
status: parking
type: refactor
epic: runtime-operationalization
epic_role: core
notes: "Migrate the remaining ~23 enforced surfaces (backlog-lint rules 4-11, 3 typed/appsync check-*.mjs, pre-commit structural checks, 4 audit-* skills) into runtime/content/checks CheckEntry YAML — the no-lost-value §12 map, finished."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: [project_runtime_realization.md]
validation_gate: null
---

# Finish the check migration (the §12 no-lost-value map)

Only ~11 of ~34-39 enforced surfaces are in `runtime/content/checks/`. Complete the migration mapped in
SPEC 1 §12 / SPEC 3 §12:
- **backlog-lint** rules 4, 5, 6, 8, 9, 10, 11 (+ the frontmatter-parseable precondition + captured-audit +
  the 2 judgment gaps) → individual `module:backlog-lint#rule…` CheckEntries (today they only run bundled via
  `lint.mjs`; only rule 1 is individualized).
- **tools/check-*.mjs** not yet migrated: `check-no-appsync-literals`, `check-typed-fixtures`,
  `check-typed-subjects`.
- **pre-commit structural checks** #1-#7 (`scripts/verify-structure.sh`) → the intended consolidating
  `service-structure` gap entry (`cmd:scripts/verify-structure.sh`), which does not yet exist.
- **audit-*** judgment skills not yet migrated: `audit-domain`, `audit-e2e-test`, `audit-service`,
  `audit-system` → `skill:` CheckEntries carrying `flake_contract`s.
- Move the `tools/*-exclusions.json` sidecars under `runtime/content/exclusions/` (config already points there).

Do this behind the proven live path from `runtime-make-it-fire` — migrate checks only once something actually
runs them.
