---
name: ci-audit
description: CI-optimized PR audit — scoped to nx-affected, no sub-agents, structured PR comment output. Designed for Sonnet.
---

## When This Skill Applies
- Running in CI via GitHub Action only
- NOT for interactive use

## Design
- No sub-agents — flat single-pass for CI latency
- Scoped: `pnpm nx affected --base=origin/main --head=HEAD --select=projects`
- Sonnet-optimized — concise prompts, structured output
- Transitive: nx affected catches lib → service dependencies

## CI Prompt Template
```
Audit PR for Nestfolio. Affected projects: {projects}

Per affected service: check file structure, handler patterns, test coverage, import boundaries, service card freshness, naming.
Per affected flow spec: validate steps against code.
If events changed: run impact analysis.

Output:
## PR Audit Results
### Hard Failures (block merge)
- [ ] {file}:{line} — {description}
### Warnings
- [ ] {file}:{line} — {description}
### Auto-Fixed
- [x] {file} — regenerated
```

## Failure Modes
- API unreachable → skip (never block PR)
- Timeout (>5min) → fail with message
- No affected services → pass immediately

## Anti-Patterns
- NEVER use sub-agents in CI
- NEVER block PRs on API outages
