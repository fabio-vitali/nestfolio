// runtime/engine/backward/lib/dossier-io.mjs — the shared frontmatter read/write for memory dossiers
// (project_*.md workstream dossiers AND feedback_*.md lesson dossiers). Extracted from reconcile-lesson.mjs
// so every dossier reconciler shares one implementation. The FM_RE is the repo-wide frontmatter regex.
import { readFileSync, writeFileSync } from 'node:fs';
import { parse, stringify } from 'yaml';

export const FM_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

export function readDossier(path) {
  const raw = readFileSync(path, 'utf8');
  const m = FM_RE.exec(raw);
  if (!m) throw new Error(`dossier has no YAML frontmatter: ${path}`);
  return { front: parse(m[1]) ?? {}, body: m[2] };
}

export function writeDossierFile(path, front, body) {
  writeFileSync(path, `---\n${stringify(front).trimEnd()}\n---\n${body}`, 'utf8');
}
