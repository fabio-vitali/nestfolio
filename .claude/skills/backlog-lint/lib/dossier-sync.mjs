import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { parseFrontmatter } from './frontmatter.mjs';

function writeDossier(path, ids) {
  const content = readFileSync(path, 'utf8');
  let frontmatter, body;
  try {
    ({ frontmatter, body } = parseFrontmatter(content));
  } catch (e) {
    console.warn(`[dossier-sync] skipping ${path}: malformed YAML frontmatter (${e.message.split('\n')[0]})`);
    return;
  }
  const fm = frontmatter ?? {};
  fm.related_workstreams = [...ids].sort();
  const fmYaml = stringifyYaml(fm);
  const newContent = `---\n${fmYaml}---\n${body.startsWith('\n') ? '' : '\n'}${body}`;
  writeFileSync(path, newContent);
}

export function syncDossiers(backlogFiles, memDir) {
  // Build map: dossier filename → array of workstream ids referencing it
  const map = new Map();
  for (const bf of backlogFiles) {
    const tm = bf.frontmatter?.topic_memory ?? [];
    for (const dossierFile of tm) {
      if (!map.has(dossierFile)) map.set(dossierFile, []);
      map.get(dossierFile).push(bf.id);
    }
  }

  // Walk every project_*.md in memDir; set related_workstreams to current truth
  // (empty list if no backlog file points at it — clears stale ids)
  if (!existsSync(memDir)) return;
  const dossierFiles = readdirSync(memDir)
    .filter(f => f.startsWith('project_') && f.endsWith('.md'));
  for (const dossierFile of dossierFiles) {
    const path = join(memDir, dossierFile);
    const ids = map.get(dossierFile) ?? [];
    writeDossier(path, ids);
  }

  // Warn about backlog topic_memory pointers that target missing dossiers
  for (const [dossierFile, workstreams] of map) {
    if (!dossierFiles.includes(dossierFile)) {
      console.warn(`[dossier-sync] target missing: ${dossierFile} (referenced by ${workstreams.join(', ')})`);
    }
  }
}
