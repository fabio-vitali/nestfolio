// runtime/adapters/claude-code/audit-procedures.mjs — Seam A (ring-2). Populates the runProcedure
// `procedures` map for the 4 audit-* skills, so deriveJudge yields a working judge. Each procedure
// runs its audit skill READ-ONLY headless via the ring-2 headless-run binding and returns
// structured findings.
import { runScenario as defaultRunScenario, parseFencedJson } from './headless-run.mjs';

export const AUDIT_SKILLS = ['audit-service', 'audit-domain', 'audit-system', 'audit-e2e-test', 'audit-integration-test'];
const READ_ONLY_TOOLS = ['Bash', 'Read', 'Glob', 'Grep', 'Skill'];   // no Write/Edit — a cadence audit never mutates

export function buildAuditPrompt(skillName, scopePaths) {
  return [
    `Run the \`${skillName}\` skill to audit this surface for consistency drift:`,
    scopePaths.map((p) => `  - ${p}`).join('\n'),
    'This is a READ-ONLY audit: do NOT modify, create, commit, or delete any files.',
    'When finished, emit ONLY the consistency violations you found as exactly one fenced json block',
    'and nothing else — no preamble, no prose before or after:',
    '```json',
    '{"findings":[{"detail":"<what is inconsistent>","evidence":"<file:line or command output>","scope":["<glob>"]}]}',
    '```',
    'An empty findings array means the property holds.',
  ].join('\n');
}

export function makeAuditProcedures({
  model = 'claude-opus-4-8', timeoutMs = 600000,
  cwd = process.cwd(), env = process.env, runScenario = defaultRunScenario,
} = {}) {
  const procedures = {};
  for (const skill of AUDIT_SKILLS) {
    procedures[skill] = async ({ check }) => {
      const prompt = buildAuditPrompt(skill, check.scope.paths);
      let lastErr;
      for (let attempt = 0; attempt < 2; attempt++) {
        const res = await runScenario({ prompt, denySubskills: [] }, 'HEAD',
          { model, cwd, env, pauseConvention: 'n/a', timeoutMs, allowedTools: READ_ONLY_TOOLS });
        try {
          const parsed = parseFencedJson(res.result ?? '');
          const findings = Array.isArray(parsed.findings) ? parsed.findings : [];
          return { taskId: skill, status: 'done', summary: `${skill}: ${findings.length} finding(s)`, findings };
        } catch (e) { lastErr = e; }
      }
      return { taskId: skill, status: 'failed', summary: `${skill}: unparseable findings — ${lastErr?.message ?? lastErr}`, findings: [] };
    };
  }
  return procedures;
}
