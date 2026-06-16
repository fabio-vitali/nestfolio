---
id: nx-daemon-instability
status: parking
type: epic
notes: "The nx daemon misbehaves on this machine (self-upgrade pollutes pnpm-lock; unhealthy daemon makes the pre-commit hook fatal). Theme epic, 2 members."
done_when: "The nx daemon no longer self-upgrades/pollutes the lockfile and an unhealthy daemon no longer hard-fails the pre-commit hook; both members shipped or dropped."
scope: "Local nx-daemon instability: self-upgrade lockfile pollution and pre-commit-hook fatality on daemon failure."
out_of_scope:
  - "General CI pipeline bring-up (ci-pipeline)"
references: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# nx daemon instability

Root cause: the nx daemon misbehaves on this machine. Continuous polling (nx-console / nx-mcp)
respawns the daemon, which attempts a self-upgrade (`pnpm add -D nx@latest`) that pollutes
`pnpm-lock.yaml` and leaks tmp dirs; and an unhealthy daemon makes `nx affected` fail, which the
pre-commit hook treats as fatal. Both members trace to the same daemon instability.

Members (derived from `epic:` pointers):
- `nx-daemon-self-upgrade-pollutes-pnpm-lock`
- `precommit-hook-fatal-on-nx-daemon-failure`
