// Uniform structured-output prompt builder for advisory agents.
//
// Spec 3 onboarding precedent (services/investor/onboarding-bff, commit
// fa78514c, 2026-05-01) showed that prompt cleanup — explicit schema shape +
// MUST/MUST-NOT rules + a forbid-empty directive — is the decisive fix for
// Sonnet 4.6's intermittent zero-tool-call failure mode. This helper applies
// the same playbook to the advisory `agent-orchestrator` callers (Spec 4,
// 2026-05-06). Every advisory prompt routes through it so the discipline is
// uniform across investor-profile, market-intelligence, portfolio-engine, and
// advisory-narrative.

export interface StructuredOutputPromptSpec {
  readonly role: string;
  readonly task: string;
  // Multi-line JSON example matching the Zod schema. Rendered verbatim so
  // comments and formatting cues survive into the model context.
  readonly schemaShape: string;
  readonly rules: readonly string[];
  readonly examples?: readonly string[];
  // Default true. Emits the explicit forbid-empty paragraph that Spec 3
  // validated as the actual fix.
  readonly forbidEmpty?: boolean;
}

const FORBID_EMPTY_PARAGRAPH =
  'You MUST call the structured-output tool with non-empty arguments. Returning empty fields is a hard failure — every required field above MUST be populated.';

export function formatStructuredOutputPrompt(spec: StructuredOutputPromptSpec): string {
  const sections: string[] = [];

  sections.push(`ROLE: ${spec.role}`);
  sections.push(`TASK: ${spec.task}`);
  sections.push(`SCHEMA SHAPE — populate EVERY field:\n${spec.schemaShape}`);

  const rulesBlock = spec.rules.map((r) => `- ${r}`).join('\n');
  sections.push(`RULES:\n${rulesBlock}`);

  if (spec.examples && spec.examples.length > 0) {
    sections.push(`EXAMPLES:\n${spec.examples.join('\n')}`);
  }

  if (spec.forbidEmpty !== false) {
    sections.push(FORBID_EMPTY_PARAGRAPH);
  }

  sections.push('Input: {input}');

  return sections.join('\n\n');
}
