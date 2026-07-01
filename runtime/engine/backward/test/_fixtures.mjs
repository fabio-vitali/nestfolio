// runtime/engine/backward/test/_fixtures.mjs — backward-local test helpers. Not ring-1 surface.
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { validCheck } from '../../test/_fixtures.mjs';   // reuse SPEC 1's canonical check factory

/** A minimal VALID CandidateDraft (deterministic). Override any field. entry has NO ratified (Δ2). */
export function validDraft(overrides = {}) {
  const entry = validCheck({
    id: 'sample-mint',
    status: 'candidate',
    kind: 'drift',
    evaluator: { type: 'deterministic', run: 'cmd:node tools/check-sample.mjs' },
    contexts: ['invariant', 'gate'],
    scope: { paths: ['services/**/src/**/*.ts'], dossiers: ['feedback_sample.md'] },
    provenance: { minted_by: 'sample-item', lesson: 'feedback_sample.md' },   // NO ratified
    ...(overrides.entry ?? {}),
  });
  const { entry: _drop, ...rest } = overrides;
  return {
    entry,
    eval_scenario: { path: 'runtime/eval/scenarios/sample-mint.scenario.mjs',
      fixtures: { good: ['fixtures/sample-mint/good/ok.ts'], bad: ['fixtures/sample-mint/bad/violation.ts'] },
      target_pass_rate: 1.0 },
    rationale: 'mechanizable, recurring, still intended — meets all three §8 gates',
    ...rest,
  };
}

/** Run `fn(dirs)` inside a fresh tmpdir with checks/, lessons/, scenarios/ subdirs. */
export function withTmpContent(fn) {
  const root = mkdtempSync(join(tmpdir(), 'nf-backward-'));
  const dirs = { root, checksDir: join(root, 'checks'), lessonsDir: join(root, 'lessons'), scenariosDir: join(root, 'scenarios') };
  for (const d of [dirs.checksDir, dirs.lessonsDir, dirs.scenariosDir]) mkdirSync(d, { recursive: true });
  try { return fn(dirs); } finally { rmSync(root, { recursive: true, force: true }); }
}

/** Write a lesson dossier `<name>.md` with YAML frontmatter + body under `dir`. */
export function writeDossier(dir, name, front, body = 'Lesson prose unchanged.\n') {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.md`), `---\n${stringify(front).trimEnd()}\n---\n${body}`, 'utf8');
}

export { validCheck };
