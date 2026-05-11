---
id: onboarding-mfe-chat-component-spec-drift
status: shipped
rank: null
type: bug
notes: "9+ unit tests in apps/onboarding-mfe/test/app/onboarding-chat.component.spec.ts fail against the current component; spec encodes an older streaming/headers/CTA contract."
references: []
out_of_scope:
  - "No component code changes — current shape (static headers, async mountRenderer, warn-then-navigate CTA) is intentional with inline comments justifying each"
spec: null
plan: null
topic_memory: []
validation_gate: "onboarding-mfe test 71/71 GREEN on main 2026-05-11. Component design choices kept (verified intentional via inline comments): headers static object literal, mountRenderer async via setTimeout 0, CTA warn-then-navigate-anyway. Spec rewrites: (a) added drainMicrotasks helper for runAgent's async fetchAuthSession boundary, (b) renamed phase_index → phaseIndex in STATE_SNAPSHOT, (c) updated timeout assertion 15s → 45s (TIMEOUT_MS), (d) toolName → toolCallName in TOOL_CALL_START (AG-UI contract), (e) headers factory → static object assertions, (f) CTA error-path: warns+navigates instead of error+abort, (g) claim-absent path: 1 local-mark updateUser call, not zero."
---

# `OnboardingChatComponent` unit spec is out of sync with the component

**Failing target:** `pnpm nx run onboarding-mfe:test` → `apps/onboarding-mfe/test/app/onboarding-chat.component.spec.ts`.

Multiple distinct failures, all pointing at a single drift between spec and implementation rather than independent bugs:

- `sets isStreaming false when stream completes` — expects `false`, receives `true` (the spec's mock-`HttpAgent` is not wired the way the component currently consumes it).
- `sets errorMessage on stream error` — `errorMessage()` stays `null`.
- `appends assistant text message on TEXT_MESSAGE_CONTENT event` — assistant message array stays empty.
- `updates phaseIndex from STATE_SNAPSHOT event` — `phaseIndex()` stays `0`.
- `shows loading indicator after 3s delay` / `shows timeout message after 15s` — timer wiring expectations no longer match.
- `provides a headers factory that includes Bearer token + session-id` — spec asserts `typeof headers === 'function'`, component currently passes a **static** object literal `{Authorization, x-amzn-bedrock-agentcore-runtime-session-id}` (see `onboarding-chat.component.ts:253`). After the access-token migration (`9134b1ed`) and the `HttpAgent` rebuild (`e79705ef`) the factory shape changed; spec was not updated.
- `persists the sessionId part across remounts via sessionStorage` — `firstCall.headers is not a function` (same root cause as above).
- `mountRenderer wires render_options output to submitUserContent` — output never flushes; renderer mount timing changed.
- CTA renderer click — `onCtaClick()` post-fetchAuthSession-rejection branches diverge from the spec's expectation.

**Root cause hypothesis:** the component has been rewritten several times in the last two weeks (commits `b890b52c`, `c1c8627a`, `9134b1ed`, `80b560f2`, `e79705ef`, `92ddaa92`, `5bdf287c`, `4174e00f`, `b72afc06`). The spec encodes the pre-rewrite contract: `headers` as a factory, mock agent emitting via the old `next/complete/error` shape, mountRenderer assumed synchronous, CTA error path returned earlier.

**Resolution path (no patch):** rebuild the spec from the current `onboarding-chat.component.ts`. Decide first whether the component's current shape is the intended one (headers static, mountRenderer async via `setTimeout 0`, fetchAuthSession-rejection in CTA path) — those are themselves design choices, not just test fixtures. If yes, rewrite the spec; if any of them are wrong design-wise, fix the component too.

Surfaced 2026-05-11 during full-system test sweep.
