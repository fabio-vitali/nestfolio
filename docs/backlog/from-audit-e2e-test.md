---
id: from-audit-e2e-test
type: bug
status: parking
done_when: "resolve: Convention check 8 (hard fail) requires
  `@nestfolio/integration-testing` to never appear anywhere in the
  e2e-feature-tests surface, but `EventBusTrap` is imported from it in two test
  files and two helpers."
provenance:
  from_finding: audit-e2e-test#0
  from_check: audit-e2e-test
---

# from-audit-e2e-test

Convention check 8 (hard fail) requires `@nestfolio/integration-testing` to never appear anywhere in the e2e-feature-tests surface, but `EventBusTrap` is imported from it in two test files and two helpers.
