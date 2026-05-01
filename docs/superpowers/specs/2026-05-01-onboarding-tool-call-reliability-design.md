# Onboarding agent tool-call reliability — design

**Date:** 2026-05-01
**Status:** Draft
**Spec lineage:** Spec 3 of the system architecture docs workstream that began 2026-04-30
(Spec 1 = foundation docs, Spec 2 = advisory pipeline consolidation, both shipped to `main`).
**Companion:** §21 OQ #11 (recover originating specs) tracked separately.

## Problem

The Playwright UI e2e journey at `apps/nestfolio-e2e/src/journeys/new-investor-happy-path.spec.ts`
intermittently fails between onboarding steps 2 and 4 because the Sonnet 4.6 model
running inside the onboarding AgentCore runtime occasionally returns an `AIMessage`
with **zero tool calls**, despite the phase node being wired with
`tool_choice: 'any'`. When this happens the browser never receives a
`renderer-render_*` testid event from the AG-UI stream, so Playwright's
`waitFor` times out at the affected phase.

The eighth Playwright session on 2026-04-30 saw this happen in 3 of 6 runs,
each on a different phase (`render_options`, `render_amount`, `render_summary`).
Two prior runs in the same session passed cleanly through the same code path.
The bug is intermittent, not a regression.

ID-case mismatches, phase-order alignment, and state-propagation issues that
also blocked the journey earlier in the migration were resolved in the second
and third Playwright sessions. The remaining failure mode is purely model
behavior.

## Root-cause diagnosis

The flake is reproducible enough that prompt analysis identifies four prose-friendly
escape hatches the current path leaves open. With `tool_choice: 'any'`, Bedrock's
Converse API is documented to force *some* tool call, but Sonnet 4.x has a known
weakness on long histories with stale tool blocks where the constraint occasionally
softens.

### Prompt-level issues

1. **SYSTEM ↔ TURN-CONTEXT contradiction.**
   `SYSTEM_PROMPT` (in `services/investor/onboarding-bff/src/agent/prompts/system.ts`)
   says: *"After the user makes a choice, restate it once for confirmation in
   Italian ('Ho capito bene: ... Confermi?'), then ON CONFIRMATION call
   commit_phase."* `phase-node.ts` `CURRENT TURN CONTEXT` says:
   *"You MUST call commit_phase now (do NOT call render_*)."*
   These directives directly conflict. Sonnet sometimes resolves the conflict
   by emitting prose ("Ho capito... Confermi?") with no tool call.

2. **Inline option lists in phase instructions.**
   Each phase body in `prompts/phase-instructions.ts` lists its option ids and
   Italian labels as bullet points. SYSTEM says *"never list options in the
   message text"* — but the option list is right there, looking like prose to
   pattern-match on. The model can produce a chat reply enumerating the
   options instead of calling the render tool.

3. **Within-turn history bloat.**
   When phase_X commits, the graph immediately runs phase_X+1 in the same
   browser turn. By phase 5–7 the history Sonnet sees contains 5+ prior
   AIMessage→ToolMessage(`(rendered)`) pairs and several commit-phase
   ToolMessages with verbose JSON content. Long histories with un-paired or
   noisy tool blocks degrade `tool_choice` reliability on Bedrock Sonnet 4.x.

4. **Multiple "MUST" directives layered.**
   SYSTEM says "you MUST call render_*", phase body says "you MUST call
   render_X", TURN CONTEXT says "you MUST call commit_phase". When directives
   stack, the model has more degrees of freedom to pick which to obey.

### Code-level gap

`phase-node.ts` does a single `modelWithTools.invoke(messages)` per node call
with **no retry on a failed tool extraction**. If Sonnet returns zero
`tool_calls` (or the wrong tool name for the turn), the AIMessage flows
back to the browser as a text-only stream and the phase silently dead-ends.

## Goal

Make the onboarding agent's tool-call behavior reliable enough that the
Playwright e2e journey reaches step 10 in **5 consecutive runs** without the
renderer-`render_*` testid timing out. After that gate is met, the existing
single-run-per-CI posture is preserved — no permanent CI cost increase.

## Out of scope

- **Advisory agents** (`investor-profile-ctrl`, `market-intelligence-ctrl`,
  `portfolio-engine-ctrl`, `advisory-narrative-ctrl`). They use
  `agent-orchestrator.invoke()` (single-shot) rather than the chained per-phase
  `streamEvents` pattern, do not have the prompt contradictions above, and
  pass their `AgentTraceEnvelope.toolCalls` assertions reliably. The
  named-tool retry pattern is a candidate to hoist into
  `libs/agent-orchestrator` if advisory flake ever surfaces; it has not.
- `OnboardingRepository.updatePhase` ValidationException on non-mandate
  commits. Separate latent bug tracked in `project_playwright_e2e_ui.md`.
- AgentCore Memory namespace mismatch surfaced as Spec 2 architectural
  finding. Tracked in `project_advisory_pipeline_consolidation.md`.
- Dashboard MFE WSS subscription investigation. Tracked in
  `project_playwright_e2e_ui.md`.
- Switching the onboarding model away from Sonnet. Sonnet remains the default;
  the fixes target making Sonnet's tool-call behavior reliable on the existing
  prompt path.

## Approach

Two coupled fixes, both targeting the same root cause:

1. **Prompt cleanup** — remove the SYSTEM↔TURN-CONTEXT contradiction, restructure
   each phase's option list as explicit tool-arguments (not prose), and tighten
   the TOOL USE block to a single un-conflicted directive set.
2. **Named-tool retry guard** — when the first model invocation returns zero
   tool calls or the wrong tool for the turn context, retry **once** with
   `tool_choice: { tool: '<expected_tool>' }` pinning the named tool. If the
   retry also fails, throw a structured error → AbstractAgent emits
   `RUN_ERROR` → browser surfaces existing 'Riprova' UX.

The retry is on the failure side only; on the happy path the phase node runs
exactly one model call per turn, same as today. Cost and latency unchanged
for the success path.

## Architecture

### Prompt cleanup

**`services/investor/onboarding-bff/src/agent/prompts/system.ts`**

- **Drop** the sentence: *"After the user makes a choice, restate it once for
  confirmation in Italian ('Ho capito bene: [riassunto]. Confermi?'), then on
  confirmation call commit_phase to persist and advance."*
- **Tighten** the TOOL USE block to three unambiguous rules:
  - Phase entry → call the phase's `render_*` tool (named in the phase body).
  - Phase response (user has just answered the phase question) → call
    `commit_phase`.
  - Product question (user asks something off-topic) → call
    `search_knowledge_base`.
- **Add** an explicit rule: *"Options, sliders, presets, and input choices
  appear ONLY inside the render_* tool arguments — never in the assistant
  message text."*

**`services/investor/onboarding-bff/src/agent/prompts/phase-instructions.ts`**

- **Restructure** all 7 phases to a uniform shape:
  - Italian title line for the model to use as the renderer title.
  - Labeled `OPTIONS (tool args only)` block with the literal option ids +
    Italian labels (schema content unchanged).
  - One sentence stating which `render_*` tool to call on entry.
- **Drop** the redundant `commit_phase` instructions from each phase body —
  SYSTEM already covers the response branch.

### Named-tool retry guard

**`services/investor/onboarding-bff/src/agent/phase-node.ts`**

Add a `phaseToRenderTool` map covering all 7 phases:

```typescript
const phaseToRenderTool: Record<Phase, string> = {
  goal:            'render_options',
  operating_mode:  'render_mode_cards',
  horizon:         'render_slider',
  capital:         'render_amount',
  mandate_summary: 'render_summary',
  mandate_consent: 'render_consent',
  mandate_cta:     'render_cta',
};
```

Compute `expectedTool` from the existing turn-classification branches:

```typescript
const expectedTool: string =
    isProductQuestion ? 'search_knowledge_base'
  : userHasResponded  ? 'commit_phase'
  :                     phaseToRenderTool[phaseName];
```

Retry control flow after the first invoke:

```typescript
let response = (await modelWithTools.invoke(messages)) as AIMessage;
const firstToolName = response.tool_calls?.[0]?.name;

if (firstToolName !== expectedTool) {
  console.warn(JSON.stringify({
    level: 'WARN',
    message: 'phase-node retry pinned to expected tool',
    phase: phaseName,
    expectedTool,
    firstAttemptTool: firstToolName ?? null,
  }));
  const pinnedModel = model.bindTools(tools as any[], {
    tool_choice: { tool: expectedTool } as any,
  });
  response = (await pinnedModel.invoke(messages)) as AIMessage;
  if (response.tool_calls?.[0]?.name !== expectedTool) {
    throw new OnboardingToolCallFailure({
      phase: phaseName,
      expectedTool,
      attempts: 2,
    });
  }
}
```

The existing `tc.name === 'commit_phase'` / `'search_knowledge_base'` /
render-default branches downstream remain unchanged.

`OnboardingToolCallFailure` is a small named `Error` subclass with a
grep-friendly `.message` shape (`"OnboardingToolCallFailure: phase=<phase>
expectedTool=<tool> attempts=2"`) and the structured fields exposed for the
log path.

### Error propagation to the browser

Already-existing path, no change required:

```
phase-node throws
   ↓
LangGraph streamEvents propagates the throw
   ↓
agent.ts runStream `.then(_, err => subscriber.next({ type: RUN_ERROR, ... }))`
   ↓
AG-UI client in browser receives RunErrorEvent
   ↓
onboarding-chat.component.ts shows the existing 'Connessione interrotta' alert
with the 'Riprova' button (wired in sixth Playwright session)
```

User clicks Riprova → next browser turn re-enters the same phase fresh →
retries the render. No half-state in DDB because the throw happens before
`updates.messages` is assigned and before any state field is written.

### Telemetry

`agents/onboarding/agent.ts` already logs `OnboardingAgent stream complete`
with `eventCounts` + `toolCallsEmitted`. Extend with two aggregates collected
during the run:

- `phaseRetryCount: number` — sum of retries across all phase invocations
  in this stream.
- `phaseFailures: Array<{ phase, firstAttemptTool, expectedTool }>` — entries
  for the warning path.

These flow into CloudWatch via the existing log line; no new infrastructure.
On a clean prompt the expected steady-state is `phaseRetryCount: 0`. Any
non-zero count signals either a model behavior change (e.g., a model bump)
or a prompt regression — caught by ops, not by users.

## File-by-file change list

### Modified

| Path | Change |
|---|---|
| `services/investor/onboarding-bff/src/agent/prompts/system.ts` | Drop confirm directive; tighten TOOL USE block to 3 unambiguous rules; add explicit "options go in tool args, not prose" rule. |
| `services/investor/onboarding-bff/src/agent/prompts/phase-instructions.ts` | Restructure all 7 phases to title + `OPTIONS (tool args only)` block. Drop redundant `commit_phase` sentences. Schema content (ids, labels, slider bounds, presets) preserved verbatim. |
| `services/investor/onboarding-bff/src/agent/phase-node.ts` | Add `phaseToRenderTool` map, `expectedTool` computation, named-tool retry, `OnboardingToolCallFailure` throw. |
| `services/investor/onboarding-bff/agents/onboarding/agent.ts` | Extend the `OnboardingAgent stream complete` log with `phaseRetryCount` + `phaseFailures` aggregates. The existing `runStream` catch already maps thrown errors → `RUN_ERROR`; no change to the error path itself. |

### Added

| Path | Purpose |
|---|---|
| `services/investor/onboarding-bff/test/unit/agent/phase-node.test.ts` | New unit test file. Phase-node has no existing test coverage. |
| `services/investor/onboarding-bff/test/unit/agent/prompts.test.ts` | New unit test file. Asserts prompt invariants. |

## Testing

All tests use mocked Bedrock — no live calls.

### `phase-node.test.ts`

1. **First attempt succeeds** — model returns AIMessage with
   `tool_calls = [{ name: 'render_options' }]` on a fresh `goal` entry.
   Assert exactly one model invocation, no retry.
2. **Empty tool_calls → retry pinned to render_X** — first invoke returns
   `tool_calls: []`, retry returns `[{ name: 'render_options' }]`. Assert
   retry was called with `tool_choice: { tool: 'render_options' }`. Assert
   structured warning log.
3. **Wrong tool → retry pinned** — first invoke returns
   `[{ name: 'search_knowledge_base' }]` on a phase entry (not a question
   turn). Assert retry with named pin, retry returns `render_options`.
4. **Retry also empty → throws OnboardingToolCallFailure** — assert error
   carries `{ phase, expectedTool, attempts: 2 }`.
5. **Response branch** — `userHasResponded=true`. First invoke wrong tool →
   retry pinned to `commit_phase`.
6. **Question branch** — `isProductQuestion=true`. First invoke wrong tool →
   retry pinned to `search_knowledge_base`.
7. **Phase coverage** — parameterized assertion that `phaseToRenderTool`
   covers every phase in `PHASE_ORDER` and maps to a tool name present in
   `RENDER_TOOLS`.

### `prompts.test.ts`

8. **SYSTEM_PROMPT invariants** — assert `SYSTEM_PROMPT` does not contain
   `"Confermi"` / `"ON CONFIRMATION"` / `"restate"` (resolves contradiction).
9. **PHASE_INSTRUCTIONS invariants** — assert each entry contains one Italian
   title and an `OPTIONS (tool args only)` block; assert no entry contains
   redundant `commit_phase` instructions beyond the SYSTEM rules.

## Validation gate (one-time, before declaring fix shipped)

5 consecutive runs of:

```bash
NX_DAEMON=false NX_SOCKET_DIR=/tmp/nx-tmp NESTFOLIO_INTEG_PREFIX=dev \
  AWS_REGION=us-east-1 \
  pnpm nx run nestfolio-e2e:e2e
```

All 5 must reach step 10 (decision detail page rendered with explanation
populated) without the journey timing out at any onboarding renderer wait.
CloudWatch `phaseRetryCount` aggregates captured for the 5 runs and reported
in the ship-commit message + topic memory.

The 5-run validation is one-time, not a steady-state CI posture. After it
passes, CI continues to run the e2e once per session as today.

## Steady-state CI

Unchanged. Single-run posture preserved. Sweep cost stays flat.

## Ship plan

1. Implement prompt changes (`system.ts`, `phase-instructions.ts`).
2. Implement `phase-node.ts` retry + `OnboardingToolCallFailure` + map.
3. Implement `agent.ts` log extension.
4. Add `phase-node.test.ts` + `prompts.test.ts`. Run
   `pnpm nx run onboarding-bff:test` until green.
5. Build + deploy: `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev
   --services=onboarding-bff` (the AgentCore container bundles prompt files,
   so a redeploy is required).
6. Validation gate: 5 consecutive Playwright e2e runs reach step 10 cleanly.
   Report aggregate `phaseRetryCount` from CloudWatch.

Single commit on `main` (matches Spec 1 + Spec 2 cadence):
`fix(onboarding-bff): harden phase-node tool calling — prompt cleanup +
named-tool retry guard`.

## Memory updates after ship

- Update `MEMORY.md` "Recently Completed Work" block: replace the
  *"Onboarding Sonnet tool-call flakiness remaining intermittent blocker"*
  reference with a 2026-05-01 SHIPPED entry linking this spec.
- Update `project_playwright_e2e_ui.md` "Open blocker — onboarding agent
  flakiness (Sonnet)" section: mark resolved, link to Spec 3.
- New topic file `project_onboarding_tool_call_reliability.md` summarizing
  the fix shape, the validation-gate result, and the residual telemetry to
  watch (`phaseRetryCount` non-zero alarms a future regression).

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Prompt cleanup unintentionally changes the model's Italian register or persona warmth. | Schema content (ids, labels, slider bounds, presets) preserved verbatim. The dropped sentence is the confirm round-trip, which the e2e journey already does not exercise. Manual verification of one full e2e journey before claiming the gate. |
| Retry doubles latency on the unhappy path. | Worst-case ~1× extra LLM call (~3–5 seconds) per phase, only on the failure path. The frontend timeout is already 45s (raised in the second Playwright session for cold-start headroom). |
| Throw → RUN_ERROR surfaces a visible alert to a real user mid-onboarding. | Acceptable per the chosen "fail with structured error" semantic. The user sees the existing 'Riprova' UX, clicks once, the phase re-enters fresh. The alternative (silent fabrication) was rejected to preserve UX honesty. |
| Sonnet's behavior on the cleaner prompt is *worse* on some unmeasured axis (e.g., it now over-eagerly commits before the user has answered). | The 5-run validation gate exercises every phase + chained turn + the KB tool path. Any regression in the happy path will surface there before ship. |
| `tool_choice: { tool: '<name>' }` is not honored by Bedrock Converse on Sonnet 4.6 in some corner case. | The throw path is the deterministic backstop. If the named pin also fails, the user sees the retry alert rather than a silent dead-end. The structured warning + failure log captures the case for diagnosis. |

## Open questions

None. All scope, retry semantics, success criteria, and confirm-UX questions
were resolved during brainstorming.
