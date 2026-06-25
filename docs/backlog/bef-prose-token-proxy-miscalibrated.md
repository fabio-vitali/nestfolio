---
id: bef-prose-token-proxy-miscalibrated
status: parking
type: tooling
notes: "benchmark-backlog firstTurnProseTokens reads a hardcoded turn index (1) but the skill loads at a later turn, so it misses skill-load prose changes; it also only captures the one-time load, not the amortized cache-re-read cost. Use tokens.total (the working value signal) or recalibrate to the real skill-load turn."
references: []
spec: null
plan: null
topic_memory: [project_backlog_eval_framework.md]
validation_gate: null
epic: backlog-eval-framework-remaining
epic_role: core
---

# benchmark-backlog: firstTurnProseTokens proxy is mis-calibrated

Surfaced by the oracle-teeth value experiment (`scripts/benchmark-backlog/test/oracle-teeth.md` §3):
a ~2,050-token injection into `backlog-add/SKILL.md` moved `tokens.total` by **+53,831** (its true
amortized cost — the injected prose is cache-re-read on every one of ~26 turns) but moved
`firstTurnProseTokens` by only **+2**.

Two defects in `firstTurnProseTokens` (`run.mjs` `defaultRunOne` passes `Math.min(1, len-1)` as the
skill-load turn index, `cost.mjs` `firstTurnProseTokens`):

1. **Hardcoded turn index 1.** The skill's `SKILL.md` enters context at the turn *after* the Skill-tool
   call (often turn 2+), not turn 1 — so the proxy reads a turn that predates the skill load and misses
   the injected prose. The spec itself flags this ("for a disable-model-invocation skill that is the
   turn following the Skill/command load, not turn 1"). It needs to *detect* the skill-load turn from
   the stream (e.g. the turn after the Skill `tool_use`, or the `cache_creation` spike).
2. **One-time-load only.** Even reading the correct turn, it captures the first cache-creation, not the
   amortized re-read cost across all turns — which is the real token impact of prose size.

**Recommendation:** treat `tokens.total` as the headline value signal (it already captures the
amortized cost and proved the value oracle's teeth); either recalibrate `firstTurnProseTokens` to the
real skill-load turn or deprecate it in favour of `tokens.total`. Non-blocking — the value oracle works
via `tokens.total`. Related: [[project_backlog_eval_framework]].
