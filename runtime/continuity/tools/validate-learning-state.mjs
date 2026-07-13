#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, token, index, all) => {
  if (token.startsWith('--')) pairs.push([token.slice(2), all[index + 1]]);
  return pairs;
}, []));
const runId = args['run-id'];
if (!runId) throw new Error('--run-id is required');
const root = process.cwd();
const lessonsDir = join(root, 'continuity', 'artifacts', 'lessons');
const lessons = existsSync(lessonsDir)
  ? readdirSync(lessonsDir).filter((name) => name.endsWith('.json')).map((name) => JSON.parse(readFileSync(join(lessonsDir, name), 'utf8'))).filter((lesson) => lesson.run_id === runId)
  : [];
const candidate = lessons.find((lesson) => lesson.status === 'candidate' && lesson.promotion?.status === 'not_promoted');
const rejectedUnsafe = lessons.find((lesson) => lesson.status === 'rejected' && lesson.safety_review?.status === 'unsafe' && lesson.promotion?.status === 'not_promoted');
const targetChanges = lessons.flatMap((lesson) => lesson.promotion?.target_changes ?? []);
if (!candidate || !rejectedUnsafe || targetChanges.length) {
  console.error(JSON.stringify({
    candidate_found: Boolean(candidate),
    rejected_unsafe_found: Boolean(rejectedUnsafe),
    target_changes: targetChanges,
  }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({
  run_id: runId,
  candidate_lesson_id: candidate.id,
  rejected_unsafe_lesson_id: rejectedUnsafe.id,
  automatic_promotion: false,
  target_changes: [],
}, null, 2));
