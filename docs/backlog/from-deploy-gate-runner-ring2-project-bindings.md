---
id: from-deploy-gate-runner-ring2-project-bindings
type: bug
status: parking
done_when: "resolve: deploy-gate-runner.mjs (ring-2, the Claude Code harness
  seam) imports two PROJECT-specific modules from outside runtime/:
  ../../../.claude/skills/backlog-next/detect-deploy-needed.mjs and
  ../../../tools/affected-projects.mjs. Project bindings belong in ring 3
  (content, the project seam) or behind an injected capability — ring 2 should
  bind host primitives only. Currently allowlisted-and-shrinking in
  runtime/engine/test/import-boundary.test.mjs (KNOWN_ESCAPES) after the
  2026-07-09 self-containment regression (audit-procedures importing
  scripts/benchmark-backlog crashed every driver main in runtime-only trees).
  Fix pattern: relocate the deploy-detect + affected-resolution composition into
  runtime/content/lib (project seam) or inject via the adapter assembly, then
  delete both KNOWN_ESCAPES entries so the guard is total."
provenance:
  from_finding: deploy-gate-runner-ring2-project-bindings
epic: runtime-self-hosting-debt
epic_role: core
notes: "deploy-gate-runner (ring-2) binds project paths directly; relocate to ring 3 / injection, then drop the KNOWN_ESCAPES allowlist entries"
---

# from-deploy-gate-runner-ring2-project-bindings

deploy-gate-runner.mjs (ring-2, the Claude Code harness seam) imports two PROJECT-specific modules from outside runtime/: ../../../.claude/skills/backlog-next/detect-deploy-needed.mjs and ../../../tools/affected-projects.mjs. Project bindings belong in ring 3 (content, the project seam) or behind an injected capability — ring 2 should bind host primitives only. Currently allowlisted-and-shrinking in runtime/engine/test/import-boundary.test.mjs (KNOWN_ESCAPES) after the 2026-07-09 self-containment regression (audit-procedures importing scripts/benchmark-backlog crashed every driver main in runtime-only trees). Fix pattern: relocate the deploy-detect + affected-resolution composition into runtime/content/lib (project seam) or inject via the adapter assembly, then delete both KNOWN_ESCAPES entries so the guard is total.
