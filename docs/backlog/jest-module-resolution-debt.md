---
id: jest-module-resolution-debt
status: parking
type: epic
notes: "jest moduleNameMapper drifts from tsconfig paths → @nestfolio/<svc> subpaths resolve in tsc/lint but fail at jest run time. Theme epic, 2 members."
done_when: "jest module resolution is derived from / kept in sync with tsconfig paths so a new @nestfolio subpath can no longer fail only at test run time; both members shipped or dropped."
scope: "jest moduleNameMapper / tsconfig-path resolution drift for @nestfolio/<svc>/{contracts,events,domain} subpaths."
out_of_scope:
  - "Phantom/undeclared package dependencies (agent-orchestrator-invoke-agentcore-smithy-phantom-dep — a missing package.json dep, not a mapper gap)"
references: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# jest module-resolution debt

Root cause: jest's `moduleNameMapper` is hand-maintained and drifts from the tsconfig `paths`
that `tsc --noEmit` and `lint` use. So a `@nestfolio/<svc>/contracts` (or `/domain`, `/events`)
import passes type-check and lint but fails at jest RUN time — the most expensive place to find
it (post-deploy for e2e). Shared fix: derive the jest mapper from tsconfig paths (or assert
parity) so the two can't diverge.

Members (derived from `epic:` pointers):
- `e2e-jest-modulenamemapper-auto-derive`
- `advisory-services-jest-mapper-investor-adpt-domain`
