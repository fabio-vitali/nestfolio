import { readFileSync, existsSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';

const v = (rule, file, message) => ({ rule, file: file?.filename ?? null, message });

export function ruleIdMatchesFilename(file) {
  const expected = file.filename.replace(/\.md$/, '');
  if (file.frontmatter?.id !== expected) {
    return [v('id-matches-filename', file,
      `frontmatter id "${file.frontmatter?.id}" does not match filename "${file.filename}"`)];
  }
  return [];
}

export function ruleSingleActive(files) {
  const active = files.filter(f => f.frontmatter?.status === 'active');
  if (active.length === 0) return [v('single-active', null, 'no file with status: active')];
  if (active.length > 1) {
    const ids = active.map(f => f.id).join(', ');
    return [v('single-active', null, `multiple files with status: active — ${ids}`)];
  }
  return [];
}

export function ruleQueuedRanks(files) {
  const queued = files.filter(f => f.frontmatter?.status === 'queued');
  const violations = [];
  const seenRanks = new Map();
  for (const f of queued) {
    const r = f.frontmatter.rank;
    if (r == null) {
      violations.push(v('queued-rank', f, `${f.id}: queued item missing rank`));
    } else if (seenRanks.has(r)) {
      violations.push(v('queued-rank', f,
        `${f.id}: duplicate rank ${r} (also on ${seenRanks.get(r)})`));
    } else {
      seenRanks.set(r, f.id);
    }
  }
  return violations;
}

export function ruleActiveOutOfScope(file) {
  if (file.frontmatter?.status !== 'active') return [];
  const oos = file.frontmatter.out_of_scope;
  if (!Array.isArray(oos) || oos.length === 0) {
    return [v('active-out-of-scope', file,
      `${file.id}: active item — out_of_scope is empty (rule 4)`)];
  }
  return [];
}

export function ruleShippedValidationGate(file) {
  if (file.frontmatter?.status !== 'shipped') return [];
  const gate = file.frontmatter.validation_gate;
  if (typeof gate !== 'string' || gate.trim() === '') {
    return [v('shipped-validation-gate', file,
      `${file.id}: shipped item — validation_gate is empty (rule 5)`)];
  }
  return [];
}

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/^-|-$/g, '');
}

export function ruleReferencesValid(file, repoRoot) {
  if (!['design', 'spec'].includes(file.frontmatter?.type)) return [];
  const refs = file.frontmatter.references;
  if (!Array.isArray(refs) || refs.length === 0) {
    return [v('references-valid', file,
      `${file.id}: references are empty — ${file.frontmatter.type} type requires references (rule 3)`)];
  }
  const violations = [];
  for (const ref of refs) {
    const [pathPart, anchor] = ref.split('#');
    const fullPath = isAbsolute(pathPart) ? pathPart : join(repoRoot, pathPart);
    if (!existsSync(fullPath)) {
      violations.push(v('references-valid', file,
        `${file.id}: reference path not found: ${pathPart}`));
      continue;
    }
    if (anchor) {
      const content = readFileSync(fullPath, 'utf8');
      const headings = [...content.matchAll(/^#+\s+(.+)$/gm)].map(m => slugify(m[1]));
      if (!headings.includes(anchor.toLowerCase())) {
        violations.push(v('references-valid', file,
          `${file.id}: anchor "#${anchor}" not found in ${pathPart}`));
      }
    }
  }
  return violations;
}
