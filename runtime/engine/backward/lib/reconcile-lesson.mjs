// reconcile-lesson.mjs — reconcileLesson(): the ONLY writer of a lesson's mints: pointer (§7.1).
// derived-and-reconciled, never hand-edited (same contract as topic_memory↔related_workstreams).
// Mutates the dossier frontmatter under an injected dossierRoot (D1 in-repo mirror).
import { readFileSync, writeFileSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { parse, stringify } from 'yaml';
import { validateMintsEntry } from '../schema/mints-entry.ts';
import { fileURLToPath } from 'node:url';

const FM_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

function readDossier(path) {
  const raw = readFileSync(path, 'utf8');
  const m = FM_RE.exec(raw);
  if (!m) throw new Error(`dossier has no YAML frontmatter: ${path}`);
  return { front: parse(m[1]) ?? {}, body: m[2] };
}
function writeDossierFile(path, front, body) {
  writeFileSync(path, `---\n${stringify(front).trimEnd()}\n---\n${body}`, 'utf8');
}

export function reconcileLesson({ lesson, check, transition, successor, ratified, dossierRoot, generation = 1 }) {
  const path = isAbsolute(lesson) ? lesson : join(dossierRoot, lesson);
  const { front, body } = readDossier(path);
  const mints = Array.isArray(front.mints) ? front.mints.map((e) => ({ ...e })) : [];
  const stamp = ratified ?? new Date().toISOString().slice(0, 10);
  const sameEpoch = (e) => e.check === check && (e.generation ?? 1) === generation;   // §2.4: keyed by (check, generation)

  if (transition === 'ratify') {
    if (!mints.some(sameEpoch)) mints.push({ check, ratified: stamp, status: 'active', ...(generation > 1 ? { generation } : {}) });
  } else if (transition === 'retire') {
    const e = mints.find(sameEpoch);
    if (e) e.status = 'retired';
  } else if (transition === 'supersede') {
    const e = mints.find(sameEpoch);
    if (e) { e.status = 'superseded'; e.superseded_by = successor; }
    if (successor && !mints.some((x) => x.check === successor)) mints.push({ check: successor, ratified: stamp, status: 'active' });
  } else {
    throw new Error(`reconcileLesson: unsupported transition '${transition}'`);
  }

  for (const e of mints) { const r = validateMintsEntry(e); if (!r.ok) throw new Error(`invalid mints entry: ${r.error}`); }
  front.mints = mints;
  writeDossierFile(path, front, body);
  return { lesson: path, mints };
}

function main() { console.error('reconcile-lesson.mjs is a library; import reconcileLesson'); process.exit(2); }
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();
