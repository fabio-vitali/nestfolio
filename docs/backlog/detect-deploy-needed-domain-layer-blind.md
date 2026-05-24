---
id: detect-deploy-needed-domain-layer-blind
status: parking
type: tooling
notes: "detect-deploy-needed.mjs TIER1 regex assumes services/<svc>/src/ but real layout is services/<domain>/<svc>/src/ — flags deploy=true with services='' (empty), forcing manual --services scoping."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# detect-deploy-needed.mjs is blind to the domain layer in service paths

`.claude/skills/backlog-next/detect-deploy-needed.mjs:40-43` declares:

```js
{ re: /^services\/([^/]+)\/src\//,            reason: 'Lambda code',         service: true  },
{ re: /^services\/([^/]+)\/infrastructure\//, reason: 'CDK stack',           service: true  },
{ re: /^services\/([^/]+)\/domain\//,         reason: 'event/intent schema', service: true  },
```

But the actual repo layout is `services/<domain>/<service>/src/` (e.g. `services/advisory/decision-workflow-ctrl/src/handlers/assemble-packet.ts`). The regex matches `services/advisory/` and then expects `/src/` — but instead there's `/decision-workflow-ctrl/src/`. So every service-level change falls through to the "Unknown paths" branch, which conservatively flags `deploy=true` but with an empty `services=` list.

Observed during `/backlog-next assemble-packet-narrative-explainability-key-mismatch` (2026-05-24):

```
deploy=true
services=
reason=2 unknown path(s) — conservative default
```

Then `deploy.sh sandbox --prefix=dev --services=<from-detect-output>` becomes `--services=`, which would deploy everything (or fail).

## Fix

Change the three TIER1 regexes to:

```js
{ re: /^services\/[^/]+\/([^/]+)\/src\//,            reason: 'Lambda code',         service: true  },
{ re: /^services\/[^/]+\/([^/]+)\/infrastructure\//, reason: 'CDK stack',           service: true  },
{ re: /^services\/[^/]+\/([^/]+)\/domain\//,         reason: 'event/intent schema', service: true  },
```

`m[1]` is now the service name (the leaf before `/src|/infrastructure|/domain`). Add a unit test that exercises a realistic two-segment path.

## Why parking, not queued

The conservative default produces correct behaviour (deploy=true) — only the auto-scoping is broken. Manual `--services=<svc>` workaround takes 5 seconds. No e2e gate impact. Promote when the next workstream re-encounters it or when a sweep batches multiple skill-script bugs together.
