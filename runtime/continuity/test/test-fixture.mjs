import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

export function createFixture() {
  const root = mkdtempSync(join(tmpdir(), 'continuity-vs001-'));
  const copy = (relativePath) => {
    const source = join(sourceRoot, relativePath);
    const target = join(root, relativePath);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(source, target, { recursive: true });
  };
  copy('runtime/continuity');
  copy('continuity/packs');
  copy('continuity/bindings');
  copy('.claude/skills/continuity-resumable-work');
  copy('.claude/skills/continuity-nestfolio-binding');
  copy('docs/backlog/continuity-vs001-resumable-agent-work-session.md');
  copy('docs/backlog/continuity-vs001a-claude-code-session-confirmation.md');
  for (const backlogItem of [
    'docs/backlog/continuity-vs001-resumable-agent-work-session.md',
    'docs/backlog/continuity-vs001a-claude-code-session-confirmation.md',
  ]) {
    const workItemPath = join(root, backlogItem);
    const selectableWorkItem = readFileSync(workItemPath, 'utf8')
      .replace(/^status: shipped$/m, 'status: active')
      .replace(/^closed: .*$/m, 'closed: null')
      .replace(/^validation_gate: .*$/m, 'validation_gate: null');
    writeFileSync(workItemPath, selectableWorkItem);
  }
  mkdirSync(join(root, 'docs'), { recursive: true });
  writeFileSync(join(root, 'docs', 'BACKLOG.md'), '# fixture\n');
  return root;
}
