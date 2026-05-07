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
