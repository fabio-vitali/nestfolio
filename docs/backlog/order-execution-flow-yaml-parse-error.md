---
id: order-execution-flow-yaml-parse-error
status: parking
type: bug
notes: "flows/order-execution.flow.yaml line 154 fails YAML parse due to unquoted multi-colon string."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# `flows/order-execution.flow.yaml:154` fails YAML parse (BLOCK_AS_IMPLICIT_KEY)

`node -e "require('yaml').parse(require('fs').readFileSync('flows/order-execution.flow.yaml','utf8'))"` rejects line 154:

```
- step 7 timeout: 300s adapter timeout triggers HandleTimeout — parallel: open circuit breaker, escalate order (ORDER_ESCALATED + BROKER_CIRCUIT_OPEN via CDC)
```

Error code `BLOCK_AS_IMPLICIT_KEY` at line 154 col 21–22. The YAML parser sees two colons in the bare scalar and tries to interpret the head as an implicit map key, which collides with the surrounding sequence node.

**Fix:** quote the value, e.g. `- "step 7 timeout: 300s adapter timeout triggers HandleTimeout — parallel: open circuit breaker, escalate order (ORDER_ESCALATED + BROKER_CIRCUIT_OPEN via CDC)"`. Or split the bullet so the bare string contains a single colon.

**Impact:** any tool that ingests flow specs as YAML (validate-flow skill, future codegen, doc renderers) will fail on this file. The pre-existing entry in `git log -- flows/order-execution.flow.yaml` shows the broken file has been in tree since the initial flow-spec generation.

Surfaced 2026-05-09 during Task 27 of `advisory-in-flight-projection` (commit `c1482edd`); not caused by that workstream.
