// runtime/content/lib/backlog-id-core.mjs — zero-arg core (runtime `module:` convention) wrapping the
// backlog-lint per-file rule ruleIdMatchesFilename, so backlog-id-matches-filename runs without args.
// Repo-integrity check: enforces the WHOLE backlog dir (not diff-scoped) — a wrong id is wrong regardless
// of what's staged. Reusable pattern: wrap a per-item lint rule in a zero-arg core for the runtime seam.
import { loadBacklogFiles } from '../../../.claude/skills/backlog-lint/lib/frontmatter.mjs';
import { ruleIdMatchesFilename } from '../../../.claude/skills/backlog-lint/lib/rules.mjs';

export function backlogIdViolations(dir = 'docs/backlog') {
  return loadBacklogFiles(dir)
    .flatMap(ruleIdMatchesFilename)
    .map((v) => ({ detail: v.message, scope: ['docs/backlog/*.md'], evidence: v.file }));
}
