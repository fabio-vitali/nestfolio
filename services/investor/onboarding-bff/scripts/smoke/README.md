# Smoke Fixtures

`copilotkit-minimal-turn.json` — minimal body derived from the `@copilotkit/runtime@1.54.0` `GenerateCopilotResponseInput` GraphQL schema (see `node_modules/@copilotkit/runtime/src/graphql/inputs/generate-copilot-response.input.ts`). Sufficient to drive the `POST /invocations` handler end-to-end.

**Purpose of this fixture:** verify emission wiring, not CopilotKit correctness. The handler's try/finally in `agents/onboarding/server.ts` emits an `AgentTraceEnvelope` whether `CopilotRuntime.process()` returns successfully or throws — so the smoke only cares that EventBridge receives one event per invocation.

Regenerate when `@copilotkit/runtime` ships a major version bump or if the smoke needs to exercise specific graph branches.
