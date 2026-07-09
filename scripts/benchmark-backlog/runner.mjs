// scripts/benchmark-backlog/runner.mjs — re-export shim. The headless spawn machinery moved into
// ring-2 (runtime/adapters/claude-code/headless-run.mjs): the runtime must be self-contained (it
// ships without scripts/), and the dependency direction is project-tooling → runtime, never the
// reverse. This shim keeps the legacy comparator importing the single implementation until the
// comparator itself is retired (runtime-legacy-retirement).
export { classifyTerminal, parseStreamJson, buildClaudeArgs, runScenario } from '../../runtime/adapters/claude-code/headless-run.mjs';
