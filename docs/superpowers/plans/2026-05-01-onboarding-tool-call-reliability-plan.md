# Onboarding Tool-Call Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the onboarding agent's tool-call behavior deterministic enough that the Playwright UI e2e journey reaches step 10 in 5 consecutive runs without a `renderer-render_*` testid timeout, by removing prompt contradictions and adding a named-tool retry guard with structured failure semantics.

**Architecture:** Two coupled fixes against the same root cause. (1) Prompt cleanup removes the SYSTEM↔TURN-CONTEXT contradiction in `system.ts` and restructures `phase-instructions.ts` so option lists live as tool-arguments, not prose. (2) `phase-node.ts` gains a named-tool retry: if the first model invocation returns zero or wrong-named tool calls, retry once with `tool_choice: { tool: '<expected>' }`; if that also fails, throw `OnboardingToolCallFailure` → AbstractAgent emits `RUN_ERROR` → existing 'Riprova' UX. Telemetry: extend the existing `OnboardingAgent stream complete` log with `phaseRetryCount` + `phaseFailures` aggregates. Happy-path latency and cost are unchanged.

**Tech Stack:** TypeScript 5.x, Nx monorepo, AWS CDK, AWS Bedrock AgentCore (`@aws-sdk/client-bedrock-agentcore`), `@langchain/aws` `ChatBedrockConverse`, `@langchain/langgraph` (in-process), `@ag-ui/client` `AbstractAgent`, Hono on port 8080, Jest unit tests, Playwright e2e at `apps/nestfolio-e2e`. Spec: `docs/superpowers/specs/2026-05-01-onboarding-tool-call-reliability-design.md` (commit `23135844`).

**Workstream conventions:**
- Doc + plan + ship commit go directly to `main` — no feature branch, no PR.
- No `Co-Authored-By: Claude` attribution in commit messages.
- Follows Spec 1 + Spec 2 cadence: a **single ship commit** on `main` after the e2e validation gate passes. No per-phase commits during implementation. The deploy script bundles whatever is on-disk, so deploy-before-commit is safe (and gives us a clean one-shot revert window if the gate fails).
- Phase 6 (deploy) and Phase 7 (e2e validation) require explicit user confirmation before running — they touch the dev sandbox AWS account (771924376645) and consume real Bedrock + AgentCore time.
- Phase ordering follows the spec's Ship plan: prompts → retry → telemetry → tests → deploy → e2e gate. Tests are written **after** the implementation (matches Spec 3 ship plan; deviates from default TDD because the changes are small, deterministic, and tightly bounded by spec test cases).
- Architectural decisions during execution use the AskUserQuestion widget; per Spec 3 §"Open questions" all decisions are pre-resolved.

---

## File Structure (what gets touched)

**Modified (4 files):**
- `services/investor/onboarding-bff/src/agent/prompts/system.ts` — drop confirm directive, tighten TOOL USE block, add explicit "options in tool args, not prose" rule (Phase 1).
- `services/investor/onboarding-bff/src/agent/prompts/phase-instructions.ts` — restructure all 7 phases to title + `OPTIONS (tool args only)` block; drop redundant `commit_phase` instructions (Phase 1).
- `services/investor/onboarding-bff/src/agent/phase-node.ts` — add `phaseToRenderTool` map, `expectedTool` computation, named-tool retry, `OnboardingToolCallFailure` throw, retry counter passed up via state field (Phase 2).
- `services/investor/onboarding-bff/agents/onboarding/agent.ts` — extend `OnboardingAgent stream complete` log with `phaseRetryCount` + `phaseFailures` aggregates collected from per-node updates (Phase 3).

**Created (2 files):**
- `services/investor/onboarding-bff/test/unit/agent/phase-node.test.ts` — new unit test file. Phase-node has no existing test coverage.
- `services/investor/onboarding-bff/test/unit/agent/prompts.test.ts` — new unit test file. Asserts prompt invariants (no confirm directive; phase OPTIONS block shape).

**User auto-memory (NOT in repo, no commits):**
- `/Users/fabiovitali/.claude/projects/-Users-fabiovitali-WebstormProjects-nestfolio/memory/MEMORY.md` — Recently Completed Work entry, topic-files pointer (Phase 8).
- `/Users/fabiovitali/.claude/projects/-Users-fabiovitali-WebstormProjects-nestfolio/memory/project_onboarding_tool_call_reliability.md` — new topic file (Phase 8).
- `/Users/fabiovitali/.claude/projects/-Users-fabiovitali-WebstormProjects-nestfolio/memory/project_playwright_e2e_ui.md` — mark "Open blocker — onboarding agent flakiness (Sonnet)" resolved, link Spec 3 (Phase 8).

---

## Phase 1 — Prompt cleanup

Lowest-risk change. Pure text edits in two files. Schema content (option ids, Italian labels, slider bounds, presets) is preserved verbatim — only structure and the contradiction-causing sentences change.

### Task 1.1: Replace `system.ts` with cleaned TOOL USE block

**Files:**
- Modify: `services/investor/onboarding-bff/src/agent/prompts/system.ts` (entire file)

- [ ] **Step 1: Replace the file contents**

Replace the entire contents of `services/investor/onboarding-bff/src/agent/prompts/system.ts` with:

```typescript
export const SYSTEM_PROMPT = `You are the Nestfolio onboarding assistant — a financial-advisory platform. Guide the user through onboarding in a friendly, professional, reassuring tone.

OUTPUT LANGUAGE:
- ALL user-facing text (assistant messages, tool arguments, render_* labels and descriptions) MUST be written in Italian. The user only speaks Italian.
- Use emoji sparingly to make the conversation feel natural.

TOOL USE — STRICT (three rules, no exceptions):
1. Phase entry (no user response yet for this phase) → call the render_* tool named in the phase instructions.
2. Phase response (user has just answered the phase question) → call commit_phase with the phase id and data.
3. Product question (user asks something off-topic about Nestfolio) → call search_knowledge_base.

Options, sliders, presets, and input choices appear ONLY inside the render_* tool arguments — NEVER in the assistant message text. A short Italian intro sentence in the message is fine ("Iniziamo con il primo punto." / "Ora una domanda sul tempo."), but the actual choice surface must be the tool call.

OTHER RULES:
- Never give financial advice during onboarding — collect preferences only.
- After answering a product question via search_knowledge_base, add one short sentence inviting the user back to the current onboarding step.
- If the user input is unclear, ask for clarification in Italian: "Non ho capito, potresti ripetere?"
- Do not invent product information — rely on documented sources only.

FLOW:
- Onboarding has 7 phases — guide the user through them in order.

PERSONA:
- Name: Nestfolio.
- Tone: warm but professional — a young, competent financial advisor.
`;
```

**Notes on what changed (do not include in the file — for plan review only):**
- DROPPED: the 11th-line "After the user makes a choice, restate it once for confirmation in Italian ('Ho capito bene: ... Confermi?'), then on confirmation call commit_phase to persist and advance." — this was the SYSTEM↔TURN-CONTEXT contradiction.
- DROPPED: the duplicate "After each phase is complete, call commit_phase" line at the bottom — Rule 2 above already covers it.
- TIGHTENED: TOOL USE block to exactly three numbered rules.
- ADDED: explicit "options in tool args, not prose" rule (was implicit before).

---

### Task 1.2: Replace `phase-instructions.ts` with restructured phases

**Files:**
- Modify: `services/investor/onboarding-bff/src/agent/prompts/phase-instructions.ts` (entire file)

- [ ] **Step 1: Replace the file contents**

Replace the entire contents of `services/investor/onboarding-bff/src/agent/prompts/phase-instructions.ts` with:

```typescript
export const PHASE_INSTRUCTIONS: Record<string, string> = {
  goal: `PHASE: investment goal.
TITLE (Italian): "Qual è il tuo obiettivo principale di investimento?"
ON ENTRY: call render_options with the title above.
OPTIONS (tool args only — never list these in the assistant message):
  - { id: "growth",      emoji: "📈", label: "Far crescere il capitale" }
  - { id: "real_estate", emoji: "🏠", label: "Acquistare un immobile" }
  - { id: "family",      emoji: "👨‍👩‍👧", label: "Pianificare per la famiglia" }
  - { id: "education",   emoji: "🎓", label: "Finanziare studi/formazione" }
  - { id: "retirement",  emoji: "🏖️", label: "Prepararsi alla pensione" }
  - { id: "other",       emoji: "💼", label: "Altro" }
ON RESPONSE: call commit_phase with { phase: "goal", data: { goal: "<id>" } }. If the user replies with free text instead of clicking, map it to the closest id.`,

  operating_mode: `PHASE: operating mode.
TITLE (Italian): "Come vuoi che Nestfolio gestisca il tuo portafoglio?"
ON ENTRY: call render_mode_cards with the title above.
OPTIONS (tool args only — never list these in the assistant message):
  - { id: "conservative", title: "Conservativo", details: ["Bassa volatilità", "Rendimenti moderati", "Ribilanciamento raro"] }
  - { id: "balanced",     title: "Bilanciato",   badge: "Più scelto", details: ["Volatilità media", "Buoni rendimenti", "Ribilanciamento periodico"] }
  - { id: "aggressive",   title: "Aggressivo",   details: ["Alta volatilità", "Potenziali alti rendimenti", "Ribilanciamento frequente"] }
ON RESPONSE: call commit_phase with { phase: "operating_mode", data: { operatingMode: "conservative" | "balanced" | "aggressive" } }.`,

  horizon: `PHASE: investment horizon.
TITLE (Italian): "Per quanti anni intendi investire?"
ON ENTRY: call render_slider with the title above.
OPTIONS (tool args only): { min: 1, max: 30, step: 1, unit: "anni" }
ON RESPONSE: call commit_phase with { phase: "horizon", data: { horizonYears: <N> } }.`,

  capital: `PHASE: initial capital.
TITLE (Italian): "Quanto vuoi investire inizialmente?"
ON ENTRY: call render_amount with the title above.
OPTIONS (tool args only): { currency: "EUR", presets: [5000, 10000, 25000, 50000] }
ON RESPONSE: call commit_phase with { phase: "capital", data: { capitalAmount: <N> } }. The user may type a custom amount instead of clicking a preset.`,

  mandate_summary: `PHASE: mandate summary.
TITLE (Italian): "Riepilogo"
ON ENTRY: call render_summary with the title above.
OPTIONS (tool args only — populate rows from prior phase choices):
  - { label: "Obiettivo", value: "<Italian label of chosen goal>" }
  - { label: "Modalità",  value: "<Italian label of chosen operating mode>" }
  - { label: "Orizzonte", value: "<N> anni" }
  - { label: "Capitale",  value: "€ <amount>" }
ON RESPONSE: the user message will be exactly "Confermo". Call commit_phase with { phase: "mandate_summary", data: { confirmed: true } }.`,

  mandate_consent: `PHASE: mandate consent.
TITLE (Italian): "Autorizzo Nestfolio a gestire il mio portafoglio secondo le preferenze indicate"
ON ENTRY: call render_consent with the title above as the label.
ON RESPONSE: the user message will be "Accetto". Call commit_phase with { phase: "mandate_consent", data: { mandateAccepted: true }, allPhases: <accumulated phases> }. allPhases is an object: { goal: { objective: "<id>" }, horizon: { years: <N> }, capital: { amount: <N>, currency: "EUR" }, operatingMode: { mode: "<UPPERCASE>" }, mandate: { accepted: true } }.`,

  mandate_cta: `PHASE: dashboard CTA.
TITLE (Italian): "Vai alla Dashboard"
ON ENTRY: call render_cta with { label: "Vai alla Dashboard", action: "navigate:/dashboard" }.
DO NOT call commit_phase — the session was completed in the prior phase. The user's CTA click is handled by the browser to navigate to the dashboard.`,
};
```

**Notes (for plan review only):**
- Each phase now has identical structure: TITLE, ON ENTRY, OPTIONS (tool args only), ON RESPONSE.
- Schema content (option ids, Italian labels, slider min/max/step, currency presets) preserved verbatim from the original.
- Removed verbose "If the user replies with free text..." paragraphs except where load-bearing (goal phase).
- The prose sentence "labels MUST be in Italian, ids stay in English lowercase" was redundant with the SYSTEM_PROMPT OUTPUT LANGUAGE rule and the inline literal labels; dropped.

---

## Phase 2 — Named-tool retry guard in `phase-node.ts`

This phase adds the deterministic backstop. The retry only fires when the first invoke produced an unexpected tool name; happy-path cost and latency are unchanged.

### Task 2.1: Add `OnboardingToolCallFailure` and `phaseToRenderTool` map

**Files:**
- Modify: `services/investor/onboarding-bff/src/agent/phase-node.ts`

- [ ] **Step 1: Replace the imports + add error class + map at the top of the file**

Find lines 1-12 (imports + `PhaseNodeDeps` interface):

```typescript
import { ChatBedrockConverse } from '@langchain/aws';
import { HumanMessage, SystemMessage, ToolMessage, type AIMessage } from '@langchain/core/messages';
import { END } from '@langchain/langgraph';
import { SYSTEM_PROMPT } from './prompts/system';
import { PHASE_INSTRUCTIONS } from './prompts/phase-instructions';
import { nextPhase, phaseIndexOf, PHASE_ORDER, type Phase } from './state';

interface PhaseNodeDeps {
  model: ChatBedrockConverse;
  tools: readonly any[];
  toolsByName: Record<string, any>;
}
```

Replace with:

```typescript
import { ChatBedrockConverse } from '@langchain/aws';
import { HumanMessage, SystemMessage, ToolMessage, type AIMessage } from '@langchain/core/messages';
import { END } from '@langchain/langgraph';
import { SYSTEM_PROMPT } from './prompts/system';
import { PHASE_INSTRUCTIONS } from './prompts/phase-instructions';
import { nextPhase, phaseIndexOf, PHASE_ORDER, type Phase } from './state';

interface PhaseNodeDeps {
  model: ChatBedrockConverse;
  tools: readonly any[];
  toolsByName: Record<string, any>;
}

/**
 * Maps each onboarding phase to its expected render_* tool. Used by the
 * named-tool retry guard to pin tool_choice when the first invoke returns
 * an unexpected tool. Tool names match RENDER_TOOLS in
 * `services/investor/onboarding-bff/src/agent/tools/render-ui.ts`.
 */
export const phaseToRenderTool: Record<Phase, string> = {
  goal:            'render_options',
  operating_mode:  'render_mode_cards',
  horizon:         'render_slider',
  capital:         'render_amount',
  mandate_summary: 'render_summary',
  mandate_consent: 'render_consent',
  mandate_cta:     'render_cta',
};

/**
 * Thrown by the phase node when the named-tool retry also fails to produce
 * the expected tool. AbstractAgent's runStream catch maps this to a RUN_ERROR
 * AG-UI event; the browser surfaces the existing 'Riprova' UX. Grep-friendly
 * message shape.
 */
export class OnboardingToolCallFailure extends Error {
  readonly phase: string;
  readonly expectedTool: string;
  readonly attempts: number;
  constructor(args: { phase: string; expectedTool: string; attempts: number }) {
    super(
      `OnboardingToolCallFailure: phase=${args.phase} expectedTool=${args.expectedTool} attempts=${args.attempts}`,
    );
    this.name = 'OnboardingToolCallFailure';
    this.phase = args.phase;
    this.expectedTool = args.expectedTool;
    this.attempts = args.attempts;
  }
}
```

---

### Task 2.2: Replace the single-invoke block with the retry-guarded block

**Files:**
- Modify: `services/investor/onboarding-bff/src/agent/phase-node.ts:54-58`

- [ ] **Step 1: Replace the single `invoke` + `tc` extraction**

Find lines 54-58:

```typescript
    const response = (await modelWithTools.invoke(messages)) as AIMessage;
    const updates: Record<string, unknown> = {
      messages: [response],
      turnCount: 1,
    };

    const tc = response.tool_calls?.[0];
```

Replace with:

```typescript
    // Compute the tool the model is expected to call this turn — drives the
    // named-tool retry guard if the first invoke returns zero or wrong-named
    // tool calls. Branches mirror the `guidance` block above.
    const expectedTool: string =
        isProductQuestion ? 'search_knowledge_base'
      : userHasResponded  ? 'commit_phase'
      :                     phaseToRenderTool[phaseName as Phase];

    let response = (await modelWithTools.invoke(messages)) as AIMessage;
    let phaseRetryCount = 0;
    let phaseFailure: { phase: string; firstAttemptTool: string | null; expectedTool: string } | undefined;
    const firstToolName = response.tool_calls?.[0]?.name ?? null;

    if (firstToolName !== expectedTool) {
      // eslint-disable-next-line no-console
      console.warn(JSON.stringify({
        level: 'WARN',
        message: 'phase-node retry pinned to expected tool',
        phase: phaseName,
        expectedTool,
        firstAttemptTool: firstToolName,
      }));
      phaseRetryCount = 1;
      phaseFailure = { phase: phaseName, firstAttemptTool: firstToolName, expectedTool };
      const pinnedModel = model.bindTools(tools as any[], {
        tool_choice: { tool: expectedTool } as any,
      });
      response = (await pinnedModel.invoke(messages)) as AIMessage;
      if ((response.tool_calls?.[0]?.name ?? null) !== expectedTool) {
        throw new OnboardingToolCallFailure({
          phase: phaseName,
          expectedTool,
          attempts: 2,
        });
      }
    }

    const updates: Record<string, unknown> = {
      messages: [response],
      turnCount: 1,
      phaseRetryCount,
    };
    if (phaseFailure) {
      updates['phaseFailures'] = [phaseFailure];
    }

    const tc = response.tool_calls?.[0];
```

**Notes (for plan review only):**
- The retry's pinned tool_choice (`{ tool: expectedTool }`) overrides the default `tool_choice: 'any'` from line 22.
- `phaseRetryCount` and `phaseFailures` are surfaced via state updates so `agents/onboarding/agent.ts` can aggregate them across all phase-node executions in a single browser turn (Phase 3).
- The throw happens BEFORE `updates.messages` is committed to graph state and BEFORE any state field (`phase`, `goal`, etc.) is written, so a Riprova click re-enters the same phase fresh — no half-state in DDB.
- Existing downstream branches (`tc.name === 'commit_phase'`, `'search_knowledge_base'`, `'compute_risk_profile'`, render-default) are unchanged.
- The `as Phase` cast on `phaseName` is safe because all 7 phase nodes are constructed with `PHASE_ORDER` keys — verified by `Task 4.1`'s phase-coverage test.

---

### Task 2.3: Extend `OnboardingAnnotation` to surface retry telemetry into final state

**Files:**
- Modify: `services/investor/onboarding-bff/src/agent/state.ts:40-58`

- [ ] **Step 1: Add `phaseRetryCount` and `phaseFailures` annotations**

Find the `OnboardingAnnotation = Annotation.Root({ ... })` block (lines 40-58). Add two new annotations between the existing `turnCount` annotation (line 49) and `messages` annotation (line 50):

Find:

```typescript
  turnCount: Annotation<number>({ reducer: (prev, next) => prev + next, default: () => 0 }),
  messages: Annotation<BaseMessage[]>({
```

Replace with:

```typescript
  turnCount: Annotation<number>({ reducer: (prev, next) => prev + next, default: () => 0 }),
  // Retry telemetry — summed across all phase-node invocations in a single
  // browser turn. Surfaced via `OnboardingAgent stream complete` log line in
  // agents/onboarding/agent.ts. Steady-state expectation: 0. Non-zero signals
  // a model-behavior change or prompt regression.
  phaseRetryCount: Annotation<number>({ reducer: (prev, next) => prev + next, default: () => 0 }),
  phaseFailures: Annotation<Array<{ phase: string; firstAttemptTool: string | null; expectedTool: string }>>({
    reducer: (prev, next) => [...prev, ...next],
    default: () => [],
  }),
  messages: Annotation<BaseMessage[]>({
```

---

## Phase 3 — Telemetry extension in `agent.ts`

Single-line change to the existing `OnboardingAgent stream complete` log so the per-stream `phaseRetryCount` and `phaseFailures` aggregates ship to CloudWatch.

### Task 3.1: Read `phaseRetryCount` + `phaseFailures` from final state into the log

**Files:**
- Modify: `services/investor/onboarding-bff/agents/onboarding/agent.ts:336-356`

- [ ] **Step 1: Replace the final-state snapshot + log block**

Find lines 336-356:

```typescript
    if (finalState) {
      const snapshot: Record<string, unknown> = {};
      for (const key of STATE_SNAPSHOT_KEYS) {
        const v = finalState[key];
        if (v !== undefined) snapshot[key] = v;
      }
      subscriber.next({
        type: EventType.STATE_SNAPSHOT,
        snapshot,
      } as StateSnapshotEvent);
    }

    // eslint-disable-next-line no-console
    console.log(JSON.stringify({
      level: 'INFO',
      message: 'OnboardingAgent stream complete',
      threadId: input.threadId,
      runId: input.runId,
      eventCounts,
      toolCallsEmitted,
    }));
```

Replace with:

```typescript
    if (finalState) {
      const snapshot: Record<string, unknown> = {};
      for (const key of STATE_SNAPSHOT_KEYS) {
        const v = finalState[key];
        if (v !== undefined) snapshot[key] = v;
      }
      subscriber.next({
        type: EventType.STATE_SNAPSHOT,
        snapshot,
      } as StateSnapshotEvent);
    }

    // Retry telemetry comes up via finalState — phase-node writes
    // `phaseRetryCount` (number, summed reducer) and `phaseFailures` (array,
    // concat reducer) on each invocation. See state.ts annotation defs.
    const phaseRetryCount = (finalState?.['phaseRetryCount'] as number | undefined) ?? 0;
    const phaseFailures = (finalState?.['phaseFailures'] as unknown[] | undefined) ?? [];

    // eslint-disable-next-line no-console
    console.log(JSON.stringify({
      level: 'INFO',
      message: 'OnboardingAgent stream complete',
      threadId: input.threadId,
      runId: input.runId,
      eventCounts,
      toolCallsEmitted,
      phaseRetryCount,
      phaseFailures,
    }));
```

---

## Phase 4 — Unit tests

Two new test files. Both use mocked Bedrock — no live calls.

### Task 4.1: Create `phase-node.test.ts`

**Files:**
- Create: `services/investor/onboarding-bff/test/unit/agent/phase-node.test.ts`

- [ ] **Step 1: Write the test file**

Write `services/investor/onboarding-bff/test/unit/agent/phase-node.test.ts` with:

```typescript
import { AIMessage, HumanMessage } from '@langchain/core/messages';
import { createPhaseNode, OnboardingToolCallFailure, phaseToRenderTool } from '../../../src/agent/phase-node';
import { PHASE_ORDER, type Phase } from '../../../src/agent/state';
import { RENDER_TOOLS } from '../../../src/agent/tools/render-ui';

interface FakeModel {
  invoke: jest.Mock;
  bindTools: jest.Mock;
}

function makeModel(responses: AIMessage[]): { model: FakeModel; defaultBound: FakeModel; pinnedBound: FakeModel } {
  const defaultInvoke = jest.fn();
  const pinnedInvoke = jest.fn();
  const defaultBound: FakeModel = { invoke: defaultInvoke, bindTools: jest.fn() };
  const pinnedBound: FakeModel = { invoke: pinnedInvoke, bindTools: jest.fn() };
  // First bindTools call (in node body) returns defaultBound (tool_choice: 'any').
  // Second bindTools call (in retry path) returns pinnedBound (tool_choice: { tool: ... }).
  const bindTools = jest.fn().mockReturnValueOnce(defaultBound).mockReturnValue(pinnedBound);
  const model: FakeModel = { invoke: jest.fn(), bindTools };
  // Distribute responses: first to defaultBound, rest to pinnedBound (per call sequencing).
  for (const r of responses) {
    if (defaultInvoke.mock.results.length === 0 && !defaultInvoke.mock.calls.length) {
      defaultInvoke.mockResolvedValueOnce(r);
      continue;
    }
    pinnedInvoke.mockResolvedValueOnce(r);
  }
  return { model, defaultBound, pinnedBound };
}

function aiMsgWithToolCall(toolName: string, args: Record<string, unknown> = {}): AIMessage {
  return new AIMessage({
    content: '',
    tool_calls: [{ id: 'tc-1', name: toolName, args, type: 'tool_call' }],
  });
}

function aiMsgEmpty(): AIMessage {
  return new AIMessage({ content: '', tool_calls: [] });
}

const baseDeps = (model: FakeModel) => ({
  model: model as any,
  tools: [],
  toolsByName: {
    commit_phase: { invoke: jest.fn().mockResolvedValue('committed') },
    search_knowledge_base: { invoke: jest.fn().mockResolvedValue('kb result') },
  },
});

describe('phase-node — named-tool retry guard', () => {
  it('first attempt succeeds — exactly one model invocation, no retry', async () => {
    const { model, defaultBound, pinnedBound } = makeModel([aiMsgWithToolCall('render_options')]);
    const node = createPhaseNode('goal', baseDeps(model));

    const result = await node({
      messages: [new HumanMessage('Iniziamo.')],
    });

    expect(defaultBound.invoke).toHaveBeenCalledTimes(1);
    expect(pinnedBound.invoke).not.toHaveBeenCalled();
    expect(result['phaseRetryCount']).toBe(0);
    expect(result['phaseFailures']).toBeUndefined();
  });

  it('empty tool_calls → retry pinned to render_X for the phase', async () => {
    const { model, defaultBound, pinnedBound } = makeModel([
      aiMsgEmpty(),
      aiMsgWithToolCall('render_options'),
    ]);
    const node = createPhaseNode('goal', baseDeps(model));

    const result = await node({
      messages: [new HumanMessage('Iniziamo.')],
    });

    expect(defaultBound.invoke).toHaveBeenCalledTimes(1);
    expect(pinnedBound.invoke).toHaveBeenCalledTimes(1);
    // Second bindTools call must have used the pinned named tool_choice.
    expect((model.bindTools as jest.Mock).mock.calls[1][1]).toEqual({
      tool_choice: { tool: 'render_options' },
    });
    expect(result['phaseRetryCount']).toBe(1);
    expect(result['phaseFailures']).toEqual([
      { phase: 'goal', firstAttemptTool: null, expectedTool: 'render_options' },
    ]);
  });

  it('wrong tool name on phase entry → retry pinned to render_X', async () => {
    const { model, pinnedBound } = makeModel([
      aiMsgWithToolCall('search_knowledge_base'), // wrong tool for phase entry
      aiMsgWithToolCall('render_options'),
    ]);
    const node = createPhaseNode('goal', baseDeps(model));

    const result = await node({
      messages: [new HumanMessage('Iniziamo.')],
    });

    expect(pinnedBound.invoke).toHaveBeenCalledTimes(1);
    expect((model.bindTools as jest.Mock).mock.calls[1][1]).toEqual({
      tool_choice: { tool: 'render_options' },
    });
    expect(result['phaseRetryCount']).toBe(1);
    expect((result['phaseFailures'] as any[])[0]).toMatchObject({
      firstAttemptTool: 'search_knowledge_base',
      expectedTool: 'render_options',
    });
  });

  it('retry also returns wrong tool → throws OnboardingToolCallFailure', async () => {
    const { model } = makeModel([aiMsgEmpty(), aiMsgEmpty()]);
    const node = createPhaseNode('goal', baseDeps(model));

    await expect(
      node({ messages: [new HumanMessage('Iniziamo.')] }),
    ).rejects.toMatchObject({
      name: 'OnboardingToolCallFailure',
      phase: 'goal',
      expectedTool: 'render_options',
      attempts: 2,
    });
  });

  it('user response branch → expectedTool = commit_phase', async () => {
    const { model, pinnedBound } = makeModel([
      aiMsgWithToolCall('render_options'), // wrong tool — user just answered
      aiMsgWithToolCall('commit_phase', { phase: 'goal', data: { goal: 'growth' } }),
    ]);
    const node = createPhaseNode('goal', baseDeps(model));

    const result = await node({
      messages: [
        new HumanMessage('Iniziamo.'),
        new AIMessage({ content: '', tool_calls: [{ id: 't', name: 'render_options', args: {}, type: 'tool_call' }] }),
        new HumanMessage('growth'),
      ],
    });

    expect(pinnedBound.invoke).toHaveBeenCalledTimes(1);
    expect((model.bindTools as jest.Mock).mock.calls[1][1]).toEqual({
      tool_choice: { tool: 'commit_phase' },
    });
    expect(result['phaseRetryCount']).toBe(1);
  });

  it('product question branch → expectedTool = search_knowledge_base', async () => {
    const { model, pinnedBound } = makeModel([
      aiMsgWithToolCall('commit_phase'), // wrong tool — user asked a question
      aiMsgWithToolCall('search_knowledge_base', { query: 'come funziona Nestfolio per gli investimenti?' }),
    ]);
    const deps = baseDeps(model);
    // The KB-result follow-up uses the bare model (no bindTools wrap). Stub
    // model.invoke directly for that follow-up call so the node body completes.
    (model.invoke as jest.Mock).mockResolvedValue(new AIMessage({ content: 'risposta breve' }));
    const node = createPhaseNode('goal', deps);

    const result = await node({
      messages: [
        new HumanMessage('Iniziamo.'),
        new AIMessage({ content: '', tool_calls: [{ id: 't', name: 'render_options', args: {}, type: 'tool_call' }] }),
        new HumanMessage('come funziona Nestfolio per gli investimenti?'),
      ],
    });

    expect(pinnedBound.invoke).toHaveBeenCalledTimes(1);
    expect((model.bindTools as jest.Mock).mock.calls[1][1]).toEqual({
      tool_choice: { tool: 'search_knowledge_base' },
    });
    expect(result['phaseRetryCount']).toBe(1);
  });
});

describe('phaseToRenderTool — phase coverage', () => {
  it('covers every phase in PHASE_ORDER', () => {
    for (const phase of PHASE_ORDER) {
      expect(phaseToRenderTool).toHaveProperty(phase);
    }
  });

  it('every value is a real tool name in RENDER_TOOLS', () => {
    const renderToolNames = new Set(RENDER_TOOLS.map((t) => t.name));
    for (const phase of PHASE_ORDER) {
      const toolName = phaseToRenderTool[phase as Phase];
      expect(renderToolNames.has(toolName)).toBe(true);
    }
  });
});
```

---

### Task 4.2: Create `prompts.test.ts`

**Files:**
- Create: `services/investor/onboarding-bff/test/unit/agent/prompts.test.ts`

- [ ] **Step 1: Write the test file**

Write `services/investor/onboarding-bff/test/unit/agent/prompts.test.ts` with:

```typescript
import { SYSTEM_PROMPT } from '../../../src/agent/prompts/system';
import { PHASE_INSTRUCTIONS } from '../../../src/agent/prompts/phase-instructions';
import { PHASE_ORDER } from '../../../src/agent/state';

describe('SYSTEM_PROMPT invariants', () => {
  it('does not contain the dropped confirm directive', () => {
    expect(SYSTEM_PROMPT).not.toMatch(/Confermi\?/);
    expect(SYSTEM_PROMPT).not.toMatch(/Ho capito bene/);
    expect(SYSTEM_PROMPT).not.toMatch(/ON CONFIRMATION/i);
    expect(SYSTEM_PROMPT).not.toMatch(/restate it once/i);
  });

  it('explicitly forbids listing options in the assistant message text', () => {
    // Allow either phrasing (singular/plural, hyphens vs em-dash). The rule
    // must mention BOTH render_* tool args AND a prohibition on prose.
    expect(SYSTEM_PROMPT).toMatch(/render_\* tool arguments/);
    expect(SYSTEM_PROMPT).toMatch(/NEVER in the assistant message text/);
  });

  it('keeps Italian-output rule', () => {
    expect(SYSTEM_PROMPT).toMatch(/MUST be written in Italian/);
  });

  it('keeps the persona block', () => {
    expect(SYSTEM_PROMPT).toMatch(/Name: Nestfolio\./);
  });
});

describe('PHASE_INSTRUCTIONS invariants', () => {
  it('has an entry for every phase in PHASE_ORDER', () => {
    for (const phase of PHASE_ORDER) {
      expect(PHASE_INSTRUCTIONS).toHaveProperty(phase);
    }
  });

  it('every entry contains the OPTIONS (tool args only) marker', () => {
    // mandate_cta is the one phase without a separate OPTIONS block (it has
    // inline tool args in the ON ENTRY line). Allow that exception.
    for (const phase of PHASE_ORDER) {
      const body = PHASE_INSTRUCTIONS[phase];
      if (phase === 'mandate_cta') continue;
      expect(body).toMatch(/OPTIONS \(tool args only/);
    }
  });

  it('every entry has an Italian TITLE line', () => {
    for (const phase of PHASE_ORDER) {
      expect(PHASE_INSTRUCTIONS[phase]).toMatch(/TITLE \(Italian\):/);
    }
  });

  it('every entry has an ON ENTRY directive', () => {
    for (const phase of PHASE_ORDER) {
      expect(PHASE_INSTRUCTIONS[phase]).toMatch(/ON ENTRY:/);
    }
  });

  it('mandate_cta explicitly does NOT call commit_phase', () => {
    expect(PHASE_INSTRUCTIONS['mandate_cta']).toMatch(/DO NOT call commit_phase/);
  });

  it('preserves option ids verbatim from the original schema (goal phase)', () => {
    const goal = PHASE_INSTRUCTIONS['goal'];
    expect(goal).toMatch(/"growth"/);
    expect(goal).toMatch(/"real_estate"/);
    expect(goal).toMatch(/"family"/);
    expect(goal).toMatch(/"education"/);
    expect(goal).toMatch(/"retirement"/);
    expect(goal).toMatch(/"other"/);
  });

  it('preserves operating_mode card ids verbatim', () => {
    const mode = PHASE_INSTRUCTIONS['operating_mode'];
    expect(mode).toMatch(/"conservative"/);
    expect(mode).toMatch(/"balanced"/);
    expect(mode).toMatch(/"aggressive"/);
  });

  it('preserves slider bounds and capital presets verbatim', () => {
    expect(PHASE_INSTRUCTIONS['horizon']).toMatch(/min: 1, max: 30, step: 1/);
    expect(PHASE_INSTRUCTIONS['capital']).toMatch(/\[5000, 10000, 25000, 50000\]/);
  });
});
```

---

### Task 4.3: Run the new test files in isolation to confirm they pass

- [ ] **Step 1: Run `phase-node.test.ts`**

Run: `pnpm nx test onboarding-bff -- --testPathPattern=phase-node`

Expected: PASS — 8 tests green (6 retry-guard cases + 2 phase-coverage cases).

- [ ] **Step 2: Run `prompts.test.ts`**

Run: `pnpm nx test onboarding-bff -- --testPathPattern=prompts`

Expected: PASS — 9 tests green.

- [ ] **Step 3: Run the full onboarding-bff suite**

Run: `pnpm nx test onboarding-bff`

Expected: PASS — all unit tests green (including the new phase-node + prompts files plus all pre-existing tests).

If any pre-existing test fails, the most likely cause is a state-annotation collision (Phase 2 added two new annotations). Inspect `services/investor/onboarding-bff/test/unit/agent/state.test.ts` and adjust if it asserts on the exact annotation keys present.

---

## Phase 5 — Pre-deploy verification gate

No code changes. Confirm the build, lint, and full affected test surface all pass before touching AWS.

### Task 5.1: Run nx affected build + test + lint

- [ ] **Step 1: Run nx affected from current HEAD (uncommitted changes are picked up by nx via working-tree diff)**

Run: `pnpm nx affected -t build,test,lint`

Expected: PASS for all affected projects. Affected scope should include at minimum: `onboarding-bff`. Other downstream consumers (e.g. e2e-feature-tests, libs that import onboarding-bff) should also pass.

If anything fails here, fix before continuing. Do not skip this gate.

- [ ] **Step 2: Confirm the working tree still matches the spec's file-by-file change list**

Run: `git status --short`

Expected output (4 modified, 2 created):

```
 M services/investor/onboarding-bff/agents/onboarding/agent.ts
 M services/investor/onboarding-bff/src/agent/phase-node.ts
 M services/investor/onboarding-bff/src/agent/prompts/phase-instructions.ts
 M services/investor/onboarding-bff/src/agent/prompts/system.ts
 M services/investor/onboarding-bff/src/agent/state.ts
?? services/investor/onboarding-bff/test/unit/agent/phase-node.test.ts
?? services/investor/onboarding-bff/test/unit/agent/prompts.test.ts
```

(`state.ts` is the additional modify from Task 2.3 — added retry telemetry annotations. Six files total in the working tree.)

If the output differs (extra files, missing files), reconcile before proceeding.

---

## Phase 6 — Deploy to dev sandbox (REQUIRES USER CONFIRMATION)

> **STOP — confirmation gate.** This phase modifies the dev sandbox AWS account (771924376645). Confirm with the user before running.
>
> Suggested message to user: *"Phase 5 verification passed. Ready to redeploy onboarding-bff to dev sandbox via `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=onboarding-bff`. This rebuilds the AgentCore container (the prompts and phase-node code are bundled inside the container, so a redeploy is required for the changes to take effect). Confirm to proceed."*

### Task 6.1: Deploy onboarding-bff

- [ ] **Step 1: Run the deploy command**

Run: `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=onboarding-bff`

Expected: deploy script runs the esbuild → ARM64 Docker → ECR push → CDK deploy pipeline. Final output includes:
- `dev-onboarding-bff: UPDATE_COMPLETE` (CFN stack update)
- A new ECR image tag pushed for the AgentCore container
- The AgentCore runtime URL re-exported via SSM `/nestfolio/dev-onboarding-bff/agent/runtimeUrl` (unchanged value — same endpoint, new image)

Deploy time: typically 5-10 minutes.

- [ ] **Step 2: Verify the AgentCore runtime is serving the new image**

Run: `aws bedrock-agentcore-control list-agent-runtimes --query 'agentRuntimes[?contains(name, \`dev-onboarding-bff\`)].{name:name,version:agentRuntimeVersion,updatedAt:lastUpdatedAt}' --output table`

Expected: a recent `lastUpdatedAt` (within the last 10 minutes) and a bumped version number relative to pre-deploy.

- [ ] **Step 3: Smoke-test the runtime with a single direct invocation**

Run: `aws bedrock-agentcore invoke-agent-runtime --agent-runtime-arn $(aws ssm get-parameter --name /nestfolio/dev-onboarding-bff/agent/runtimeArn --query Parameter.Value --output text) --runtime-session-id smoke-tenant/smoke-session-$(date +%s) --payload '{"threadId":"smoke","runId":"smoke","messages":[{"role":"user","content":"Iniziamo."}],"state":{"phase":"goal","phaseIndex":0}}' --content-type application/json --accept text/event-stream /tmp/onboarding-smoke.out 2>&1 | head -20`

Expected: HTTP 200 with a streaming response body. Inspect `/tmp/onboarding-smoke.out` — should contain `RUN_STARTED` and a `TOOL_CALL_START` event with `toolCallName: "render_options"`. If the smoke fails (no tool call, RUN_ERROR), the deploy is broken and the e2e gate (Phase 7) is pointless — debug first.

(If `/agent/runtimeArn` SSM param is missing, fall back to using the runtime URL parameter and the AgentCore HTTP endpoint directly. The e2e gate in Phase 7 is the authoritative check; this smoke is just an early canary.)

---

## Phase 7 — E2E validation gate (5 consecutive runs, REQUIRES USER CONFIRMATION)

> **STOP — validation gate.** This phase runs the Playwright e2e journey 5 times consecutively against the deployed dev sandbox. Each run takes ~3-5 minutes; total wall-clock ~15-25 minutes. It will consume real Bedrock + AgentCore time on dev. Confirm with the user before starting.
>
> Suggested message to user: *"Phase 6 deploy succeeded and the smoke invocation returned a render_options tool call. Ready to run the e2e validation gate: 5 consecutive runs of `nestfolio-e2e:e2e`, all must reach step 10 (decision detail page rendered with explanation populated). Total wall-clock ~15-25 minutes. Confirm to proceed."*

### Task 7.1: Run the Playwright e2e journey 5 times consecutively

- [ ] **Step 1: Run the journey 5 times in a single shell, capturing each run's exit code**

Run:

```bash
for i in 1 2 3 4 5; do
  echo "=== Run $i / 5 ==="
  NX_DAEMON=false NX_SOCKET_DIR=/tmp/nx-tmp NESTFOLIO_INTEG_PREFIX=dev \
    AWS_REGION=us-east-1 \
    pnpm nx run nestfolio-e2e:e2e \
    && echo "Run $i: PASS" \
    || { echo "Run $i: FAIL — aborting gate"; break; }
done
```

Expected: 5 sequential `Run N: PASS` lines. Each run drives the journey through onboarding phases 1-7 and into the decision detail page (step 10). The renderer-`render_*` testids must appear without timeout at every phase boundary.

If any run fails:
- Capture the test artifacts (Playwright traces are written under `apps/nestfolio-e2e/test-results/`).
- Read `apps/nestfolio-e2e/test-results/.../error-context.md` for the page snapshot at failure (per `feedback_check_screenshot_first.md` — read this BEFORE forming network/transport hypotheses).
- Inspect CloudWatch `/aws/bedrock-agentcore/runtimes/dev-onboarding-bff` for `OnboardingToolCallFailure` log lines around the failure timestamp.
- If the throw fired and the browser surfaced 'Riprova', that is the *intended* failure mode — but it still counts as a failed gate run. Investigate why retry didn't catch the case (e.g. Bedrock not honoring `tool_choice: { tool: ... }`).

- [ ] **Step 2: Capture `phaseRetryCount` aggregates from CloudWatch for the 5 runs**

Run:

```bash
aws logs filter-log-events \
  --log-group-name /aws/bedrock-agentcore/runtimes/dev-onboarding-bff \
  --filter-pattern '"OnboardingAgent stream complete"' \
  --start-time $(($(date +%s%N) / 1000000 - 1800000)) \
  --query 'events[*].message' \
  --output text \
  | grep -oE '"phaseRetryCount":[0-9]+' \
  | sort | uniq -c
```

Expected: predominantly `"phaseRetryCount":0`. A small number of `"phaseRetryCount":1` is acceptable (the retry is what makes the gate pass); a `"phaseRetryCount":2` would mean two retries fired in a single browser turn (still recoverable). Any count of `OnboardingToolCallFailure` log lines means the throw fired — those should be zero on a clean run.

Run additionally:

```bash
aws logs filter-log-events \
  --log-group-name /aws/bedrock-agentcore/runtimes/dev-onboarding-bff \
  --filter-pattern '"OnboardingToolCallFailure"' \
  --start-time $(($(date +%s%N) / 1000000 - 1800000)) \
  --query 'events[*].message' \
  --output text | wc -l
```

Expected: `0`. Any non-zero count means the retry's named-pin also failed at least once across the 5 runs — record the count for the ship commit message and topic memory.

Record both numbers (retry-count distribution + failure-count) for use in the ship commit message and `project_onboarding_tool_call_reliability.md` (Phase 8).

---

## Phase 8 — Single ship commit + memory updates

If Phase 7 passed (5/5 runs reached step 10), commit the work as a single ship commit on `main`. If Phase 7 failed, do NOT commit — debug instead.

### Task 8.1: Stage the 6 modified/created files

- [ ] **Step 1: Stage the working tree**

Run:

```bash
git add services/investor/onboarding-bff/agents/onboarding/agent.ts \
        services/investor/onboarding-bff/src/agent/phase-node.ts \
        services/investor/onboarding-bff/src/agent/prompts/phase-instructions.ts \
        services/investor/onboarding-bff/src/agent/prompts/system.ts \
        services/investor/onboarding-bff/src/agent/state.ts \
        services/investor/onboarding-bff/test/unit/agent/phase-node.test.ts \
        services/investor/onboarding-bff/test/unit/agent/prompts.test.ts
```

- [ ] **Step 2: Verify the staged set matches Phase 5's expected status**

Run: `git status --short`

Expected: 7 staged entries (5 `M`, 2 `A`), zero unstaged or untracked. (If new test files surfaced from Phase 4 weren't committed yet, they should appear here.)

---

### Task 8.2: Create the single ship commit

- [ ] **Step 1: Commit**

Substitute `<retry-distribution>` and `<failure-count>` with the numbers captured in Task 7.1 Step 2. Example placeholders: `5/5 runs phaseRetryCount=0` or `4/5 runs phaseRetryCount=0, 1/5 runs phaseRetryCount=1`.

Run:

```bash
git commit -m "$(cat <<'EOF'
fix(onboarding-bff): harden phase-node tool calling — prompt cleanup + named-tool retry guard

Two coupled fixes against the same root cause: the Sonnet 4.6 model
running inside the onboarding AgentCore runtime occasionally returned an
AIMessage with zero tool_calls despite tool_choice: 'any', dead-ending
the renderer-render_* AG-UI events the browser waits on. Eighth-session
Playwright runs saw this in 3 of 6 attempts on different phases.

Prompt cleanup:
- system.ts: dropped the SYSTEM↔TURN-CONTEXT contradiction (the
  "restate for confirmation, then commit on confirmation" sentence
  conflicted with phase-node's "you MUST call commit_phase now"
  guidance). Tightened TOOL USE to three numbered rules. Added
  explicit "options/sliders/presets ONLY in render_* tool args, NEVER
  in assistant message text".
- phase-instructions.ts: restructured all 7 phases to a uniform
  TITLE / ON ENTRY / OPTIONS (tool args only) / ON RESPONSE shape.
  Schema content (option ids, Italian labels, slider bounds, currency
  presets) preserved verbatim. Dropped redundant commit_phase
  sentences — SYSTEM rules cover the response branch.

Named-tool retry guard:
- phase-node.ts: added phaseToRenderTool map + OnboardingToolCallFailure
  error class. After the first invoke, if the returned tool name does
  not match the expected tool for the turn (render_X on entry,
  commit_phase on response, search_knowledge_base on a product
  question), retry once with tool_choice: { tool: <expectedTool> }. If
  the retry also fails, throw OnboardingToolCallFailure → AbstractAgent
  emits RUN_ERROR → existing 'Riprova' UX. Happy-path latency and cost
  unchanged.
- state.ts: added phaseRetryCount + phaseFailures annotations
  (summed/concatenated across phase nodes within a browser turn).
- agents/onboarding/agent.ts: extended OnboardingAgent stream complete
  log with the two aggregates. Steady-state expectation: 0. Non-zero
  signals model-behavior change or prompt regression.

Tests:
- phase-node.test.ts (new): 8 cases covering happy path, empty
  tool_calls retry, wrong tool retry, double-fail throw, response
  branch, question branch, phase coverage.
- prompts.test.ts (new): 9 cases asserting SYSTEM_PROMPT no longer
  contains the dropped confirm directive, every PHASE_INSTRUCTIONS
  entry follows the new TITLE/ON ENTRY/OPTIONS shape, schema content
  preserved.

Validation gate (one-time): 5 consecutive Playwright e2e runs all
reached step 10 cleanly. CloudWatch aggregate: <retry-distribution>.
OnboardingToolCallFailure log count: <failure-count>.

Spec: docs/superpowers/specs/2026-05-01-onboarding-tool-call-reliability-design.md.
Plan: docs/superpowers/plans/2026-05-01-onboarding-tool-call-reliability-plan.md.
EOF
)"
```

- [ ] **Step 2: Verify the commit**

Run: `git log -1 --stat`

Expected: one commit on `main`, 7 files in the diff (5 modified, 2 created), no `Co-Authored-By` line.

---

### Task 8.3: Update `MEMORY.md` — Recently Completed Work entry

User auto-memory lives at `/Users/fabiovitali/.claude/projects/-Users-fabiovitali-WebstormProjects-nestfolio/memory/` and is **not in the repo** — no git operations.

**Files:**
- Modify: `/Users/fabiovitali/.claude/projects/-Users-fabiovitali-WebstormProjects-nestfolio/memory/MEMORY.md`

- [ ] **Step 1: Insert a new "Recently Completed Work" entry at the top of that block**

The block currently starts (post-Spec-2) with "Advisory pipeline consolidation (Spec 2) — SHIPPED 2026-04-30...". Insert ABOVE that entry:

```markdown
- **Onboarding agent tool-call reliability (Spec 3) — SHIPPED 2026-05-01** on `main`: hardened `services/investor/onboarding-bff/src/agent/phase-node.ts` against Sonnet 4.6's intermittent zero-tool-call returns. Prompt cleanup removed the SYSTEM↔TURN-CONTEXT contradiction in `prompts/system.ts` (dropped the "restate for confirmation" directive) and restructured `prompts/phase-instructions.ts` so option lists live as tool-arguments, not prose. Named-tool retry guard: when first invoke returns wrong/zero tool name, retry once with `tool_choice: { tool: <expectedTool> }`; double-fail throws `OnboardingToolCallFailure` → AbstractAgent `RUN_ERROR` → existing 'Riprova' UX. Telemetry: `phaseRetryCount` + `phaseFailures` aggregates added to the `OnboardingAgent stream complete` CloudWatch log line (steady-state 0; non-zero alarms a regression). Validation gate: 5 consecutive Playwright e2e runs reached step 10. Single ship commit on `main`. Spec: `docs/superpowers/specs/2026-05-01-onboarding-tool-call-reliability-design.md`. Plan: `docs/superpowers/plans/2026-05-01-onboarding-tool-call-reliability-plan.md`. See [project_onboarding_tool_call_reliability.md](./project_onboarding_tool_call_reliability.md). Closes the "Onboarding Sonnet tool-call flakiness remaining intermittent blocker" item from `project_playwright_e2e_ui.md`. Spec 4 (recover originating specs per §21 OQ #11) remains.
```

- [ ] **Step 2: Add the topic file pointer in the "Topic Files" section**

In the "Topic Files" section, insert (alphabetical position near other `project_o*` entries — after `[Operating mode]`):

```markdown
- [Onboarding tool-call reliability](./project_onboarding_tool_call_reliability.md) — Spec 3 SHIPPED 2026-05-01: prompt cleanup + named-tool retry guard; `phaseRetryCount` telemetry now exposed in CloudWatch.
```

- [ ] **Step 3: Update the [System architecture docs] pointer to mention Spec 3 shipped**

Find the existing line:

```markdown
- [System architecture docs](./project_system_architecture_docs.md) — Spec 1 SHIPPED 2026-04-30 (canonical `docs/architecture/SYSTEM-ARCHITECTURE.md` + `SERVICE-INVENTORY.md`); Spec 2 SHIPPED same day (advisory pipeline consolidation — see below); Spec 3 + OQ #11 remain.
```

Replace with:

```markdown
- [System architecture docs](./project_system_architecture_docs.md) — Spec 1 SHIPPED 2026-04-30 (canonical `docs/architecture/SYSTEM-ARCHITECTURE.md` + `SERVICE-INVENTORY.md`); Spec 2 SHIPPED same day (advisory pipeline consolidation); Spec 3 SHIPPED 2026-05-01 (onboarding tool-call reliability); OQ #11 (recover originating specs) remains.
```

---

### Task 8.4: Update `project_playwright_e2e_ui.md` — mark onboarding flakiness resolved

**Files:**
- Modify: `/Users/fabiovitali/.claude/projects/-Users-fabiovitali-WebstormProjects-nestfolio/memory/project_playwright_e2e_ui.md`

- [ ] **Step 1: Find the open-blocker section**

Use Grep on the file: `grep -n "Onboarding\|Sonnet\|tool-call\|flakiness" /Users/fabiovitali/.claude/projects/-Users-fabiovitali-WebstormProjects-nestfolio/memory/project_playwright_e2e_ui.md`

Locate the section currently described (per MEMORY.md) as:
*"Onboarding Sonnet tool-call flakiness remaining intermittent blocker."*

- [ ] **Step 2: Replace that section with a resolution note**

Replace the open-blocker paragraph with text along these lines (preserve surrounding section structure):

```markdown
### Onboarding Sonnet tool-call flakiness — RESOLVED 2026-05-01 (Spec 3)

The intermittent failure mode where Sonnet 4.6 returned an AIMessage with
zero tool_calls (despite `tool_choice: 'any'`) — observed in the eighth
Playwright session on 2026-04-30 in 3 of 6 runs across different phases —
is closed by Spec 3.

Fix: prompt cleanup (removed SYSTEM↔TURN-CONTEXT contradiction;
restructured `phase-instructions.ts` so options live as tool args)
+ named-tool retry guard in `phase-node.ts` with structured
`OnboardingToolCallFailure` throw on double-fail.

Validation gate: 5 consecutive Playwright e2e runs reached step 10
without renderer timeout.

Spec: `docs/superpowers/specs/2026-05-01-onboarding-tool-call-reliability-design.md`.
See `project_onboarding_tool_call_reliability.md` for fix-shape details
and the `phaseRetryCount` telemetry CloudWatch query for regression watch.
```

(Adjust prose to fit the existing topic-file's voice. The required content is: status change, fix shape, validation result, link to topic file.)

---

### Task 8.5: Create `project_onboarding_tool_call_reliability.md` topic file

**Files:**
- Create: `/Users/fabiovitali/.claude/projects/-Users-fabiovitali-WebstormProjects-nestfolio/memory/project_onboarding_tool_call_reliability.md`

- [ ] **Step 1: Write the topic file**

Substitute `<retry-distribution>` and `<failure-count>` with the numbers from Task 7.1 Step 2.

Write `/Users/fabiovitali/.claude/projects/-Users-fabiovitali-WebstormProjects-nestfolio/memory/project_onboarding_tool_call_reliability.md` with:

```markdown
# Onboarding tool-call reliability

**Status:** SHIPPED 2026-05-01 (Spec 3 of system architecture docs workstream).

## Problem

Playwright UI e2e journey at `apps/nestfolio-e2e/src/journeys/new-investor-happy-path.spec.ts` intermittently failed between onboarding steps 2-4 because the Sonnet 4.6 model running inside the onboarding AgentCore runtime occasionally returned an `AIMessage` with zero tool_calls — despite the phase node using `tool_choice: 'any'`. When this happened the browser never received a `renderer-render_*` testid event from the AG-UI stream, so Playwright's `waitFor` timed out at the affected phase.

Eighth-session (2026-04-30) saw the failure in 3 of 6 runs, each on a different phase (`render_options`, `render_amount`, `render_summary`). Two prior runs in the same session passed cleanly through the same code path. Intermittent, not a regression.

## Root cause (per Spec 3 §"Root-cause diagnosis")

Two converging issues:

1. **Prompt-level contradiction.** `SYSTEM_PROMPT` told the model to "restate for confirmation, then commit on confirmation". `phase-node.ts` `CURRENT TURN CONTEXT` told the model "you MUST call commit_phase now". Sonnet sometimes resolved the conflict by emitting prose with no tool call.
2. **Code-level gap.** `phase-node.ts` did a single `modelWithTools.invoke(messages)` with no retry on a failed tool extraction. Zero `tool_calls` → AIMessage flowed back as text-only stream → phase silently dead-ended.

Inline option lists in `phase-instructions.ts` (bulleted prose listing of ids and Italian labels) compounded the failure mode by giving the model a pattern-matchable enumeration to reproduce in chat instead of via the render tool.

## Fix shape

Two coupled changes:

1. **Prompt cleanup.**
   - `services/investor/onboarding-bff/src/agent/prompts/system.ts`: dropped the confirm-restate directive, tightened TOOL USE to three numbered rules, added explicit "options ONLY in render_* tool args".
   - `services/investor/onboarding-bff/src/agent/prompts/phase-instructions.ts`: restructured all 7 phases to TITLE / ON ENTRY / OPTIONS (tool args only) / ON RESPONSE. Schema content (option ids, Italian labels, slider bounds, currency presets) preserved verbatim.

2. **Named-tool retry guard.**
   - `services/investor/onboarding-bff/src/agent/phase-node.ts`: added `phaseToRenderTool: Record<Phase, string>` map covering all 7 phases, computed `expectedTool` from existing turn-classification branches (`isProductQuestion → search_knowledge_base`, `userHasResponded → commit_phase`, otherwise → `phaseToRenderTool[phaseName]`). If the first invoke returns a different tool name (or zero tool calls), retry once with `tool_choice: { tool: expectedTool }`. If the retry also fails, throw `OnboardingToolCallFailure` (carrying `{ phase, expectedTool, attempts: 2 }`).
   - Error propagation already worked: `AbstractAgent.runStream` catches the throw → emits `RUN_ERROR` AG-UI event → browser shows existing 'Riprova' alert (wired in sixth Playwright session). User clicks Riprova → next browser turn re-enters the same phase fresh. No half-state in DDB because the throw happens before `updates.messages` is committed.

3. **Telemetry.**
   - `services/investor/onboarding-bff/src/agent/state.ts`: added `phaseRetryCount` (sum reducer) + `phaseFailures` (concat reducer) annotations.
   - `services/investor/onboarding-bff/agents/onboarding/agent.ts`: extended the `OnboardingAgent stream complete` CloudWatch log with both aggregates.

## Validation gate result

5 consecutive runs of `pnpm nx run nestfolio-e2e:e2e` (against deployed dev sandbox) all reached step 10 (decision detail page rendered with explanation populated) without the renderer-`render_*` testid timing out.

CloudWatch aggregate across the 5 runs: `<retry-distribution>`.
`OnboardingToolCallFailure` log count: `<failure-count>`.

## Steady-state CI

Unchanged — single-run posture preserved. The 5-run validation was one-time, not a recurring CI cost.

## Out of scope (not part of this fix)

- **Advisory agents** (`investor-profile-ctrl`, `market-intelligence-ctrl`, `portfolio-engine-ctrl`, `advisory-narrative-ctrl`). They use `agent-orchestrator.invoke()` (single-shot), do not have the same prompt contradictions, and pass their `AgentTraceEnvelope.toolCalls` assertions reliably. The named-tool retry pattern is a candidate to hoist into `libs/agent-orchestrator` if advisory flake ever surfaces; it has not.
- `OnboardingRepository.updatePhase` ValidationException on non-mandate commits. Separate latent bug tracked in `project_playwright_e2e_ui.md`.
- AgentCore Memory namespace mismatch — resolved 2026-04-30 by Spec 2 (`project_advisory_pipeline_consolidation.md`).
- Switching the onboarding model away from Sonnet — Sonnet remains the default.

## Regression watch

Non-zero `phaseRetryCount` in CloudWatch is the canary. Steady-state expectation is 0. Any non-zero count signals either:
- A model behavior change (e.g. a Sonnet bump that re-introduces zero-tool-call returns).
- A prompt regression (e.g. someone re-introduced contradictory instructions).
- Bedrock Converse not honoring `tool_choice: { tool: <name> }` in some corner case.

CloudWatch query (1h window):

\`\`\`bash
aws logs filter-log-events \\
  --log-group-name /aws/bedrock-agentcore/runtimes/dev-onboarding-bff \\
  --filter-pattern '"OnboardingAgent stream complete"' \\
  --start-time $(($(date +%s%N) / 1000000 - 3600000)) \\
  --query 'events[*].message' --output text \\
  | grep -oE '"phaseRetryCount":[0-9]+' | sort | uniq -c
\`\`\`

`OnboardingToolCallFailure` log lines should remain absolutely zero in steady state. Any occurrence is investigation-worthy.

## References

- Spec: `docs/superpowers/specs/2026-05-01-onboarding-tool-call-reliability-design.md` (commit `23135844`).
- Plan: `docs/superpowers/plans/2026-05-01-onboarding-tool-call-reliability-plan.md`.
- Ship commit: see `git log --grep="harden phase-node tool calling"`.
- Related: `project_playwright_e2e_ui.md` (eighth-session diagnosis), `project_advisory_pipeline_consolidation.md` (Spec 2, sibling fix), `project_agent_contract_tests.md` (advisory agents that use the single-shot pattern this fix doesn't touch).
```

---

## Self-review checklist

After saving the plan, verify:

**1. Spec coverage:**
- Spec §"Approach" — prompt cleanup → Phase 1; retry guard → Phase 2. ✓
- Spec §"Architecture / Prompt cleanup" — system.ts changes → Task 1.1; phase-instructions.ts changes → Task 1.2. ✓
- Spec §"Architecture / Named-tool retry guard" — phaseToRenderTool map → Task 2.1; expectedTool + retry control flow → Task 2.2; OnboardingToolCallFailure → Task 2.1. ✓
- Spec §"Architecture / Error propagation" — already-existing path, no change needed. (Verified in Task 2.2 notes.) ✓
- Spec §"Architecture / Telemetry" — phaseRetryCount + phaseFailures → Task 2.3 (state) + Task 3.1 (log). ✓
- Spec §"File-by-file change list" — 4 modified + 2 added → Phases 1-4 + Phase 5 file-list verification. ✓ (Note: state.ts is the additional 5th modify needed to surface telemetry annotations; called out explicitly in Task 5.1 Step 2.)
- Spec §"Testing" — phase-node.test.ts cases 1-7 → Task 4.1; prompts.test.ts cases 8-9 → Task 4.2. ✓
- Spec §"Validation gate" — 5 consecutive e2e runs → Phase 7. ✓
- Spec §"Steady-state CI" — preserved (no change to CI config). ✓
- Spec §"Ship plan" — single commit on main → Phase 8 Task 8.2. ✓
- Spec §"Memory updates after ship" — MEMORY.md, project_playwright_e2e_ui.md, new project_onboarding_tool_call_reliability.md → Tasks 8.3, 8.4, 8.5. ✓
- Spec §"Risks and mitigations" — covered by validation gate (Phase 7) + 5-run gate + smoke test (Phase 6 Step 3) + telemetry watch (Task 7.1 Step 2).
- Spec §"Open questions" — none. ✓

**2. Placeholder scan:** Two intentional `<retry-distribution>` + `<failure-count>` placeholders in Task 8.2 + Task 8.5 — these are filled in by the executor from Phase 7 Step 2 actuals. Called out explicitly. No other placeholders.

**3. Type consistency:**
- `phaseToRenderTool: Record<Phase, string>` — used consistently in Tasks 2.1, 4.1.
- `OnboardingToolCallFailure` — defined in Task 2.1 with `{ phase, expectedTool, attempts }`; tested in Task 4.1 with same shape.
- `phaseRetryCount` (number) + `phaseFailures` (array of `{ phase, firstAttemptTool, expectedTool }`) — annotated in Task 2.3, written in Task 2.2, read in Task 3.1.
- Render tool names (`render_options`, `render_mode_cards`, `render_slider`, `render_amount`, `render_summary`, `render_consent`, `render_cta`) — match exactly between phase-instructions.ts (Task 1.2), phaseToRenderTool map (Task 2.1), and RENDER_TOOLS (referenced in Task 4.1's coverage test). Verified against `services/investor/onboarding-bff/src/agent/tools/render-ui.ts` at plan-write time.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-01-onboarding-tool-call-reliability-plan.md`.

Per workstream convention, this plan commits directly to `main` for review. Stop here for user approval before executing any phase. The user will choose execution mode (subagent-driven vs inline) when approving.
