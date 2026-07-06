// runtime/engine/backward/lib/reconcile-dossiers.mjs — the topic_memory↔related_workstreams reconcile
// side-car (spec §7 Hole #3). The runtime analogue of legacy lint --fix's syncDossiers: derived-and-
// reconciled, never hand-edited (same contract reconcile-lesson.mjs cites in its header). Source of truth =
// each Item's topic_memory[] (dossier filenames); target = each project_*.md's related_workstreams (sorted
// item ids). Full-truth rewrite: every project_*.md is rewritten each run; zero incoming pointers → [].
// memDir is INJECTED (ring-1 purity — no hardcoded ~/.claude path), mirroring reconcile-lesson's dossierRoot.
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { readDossier, writeDossierFile } from './dossier-io.mjs';

export function reconcileDossiers({ items, memDir }) {
  // 1. dossier filename → [workstream ids], from each item's topic_memory[].
  const map = new Map();
  for (const item of items) {
    for (const dossierFile of item.topic_memory ?? []) {
      if (!map.has(dossierFile)) map.set(dossierFile, []);
      map.get(dossierFile).push(item.id);
    }
  }
  if (!existsSync(memDir)) return { updated: [] };
  // 2. Rewrite every project_*.md with the current truth (empty clears stale). feedback_* untouched.
  const updated = [];
  for (const file of readdirSync(memDir).filter((f) => f.startsWith('project_') && f.endsWith('.md'))) {
    const path = join(memDir, file);
    const { front, body } = readDossier(path);
    front.related_workstreams = [...(map.get(file) ?? [])].sort();
    writeDossierFile(path, front, body);
    updated.push(file);
  }
  // 3. Warn about pointers targeting a missing dossier (parity with legacy behavior — warn, don't crash).
  for (const [dossierFile, workstreams] of map) {
    if (!existsSync(join(memDir, dossierFile))) console.warn(`[reconcile-dossiers] target missing: ${dossierFile} (referenced by ${workstreams.join(', ')})`);
  }
  return { updated };
}
