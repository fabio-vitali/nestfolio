// tools/lib/text-scan.mjs — reusable scaffold for deterministic drift gates (SPEC 2 §10 template).
// A gate = a pure findViolations(text, relPath) predicate + this walker. Mirrors the house string/regex
// style of tools/check-read-model-drift.mjs, factored so the 5 dogfood checks share one walker.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const DEFAULT_EXCLUDE = ['node_modules', 'dist', 'cdk.out', '.worktrees', '.nx', 'coverage'];

export function parseRootArg(argv) { const i = argv.indexOf('--root'); return i >= 0 ? argv[i + 1] : process.cwd(); }
export function lineOf(text, index) { return text.slice(0, index).split('\n').length; }

/** Attribution seam: RUNTIME_STAGED_PATHS (newline list, repo-relative) narrows the walk to those paths.
 *  Keyed on PRESENCE: unset → whole-tree (null); '' → nothing staged ([]); set → that list. */
export function stagedPaths() {
  if (!('RUNTIME_STAGED_PATHS' in process.env)) return null;
  return process.env.RUNTIME_STAGED_PATHS.split('\n').map((s) => s.trim()).filter(Boolean);
}

export function* walkFiles(root, { includeUnder = ['services'], ext = ['.ts'], excludeFragments = DEFAULT_EXCLUDE, excludeTest = false } = {}) {
  const staged = stagedPaths();
  if (staged) { yield* stagedWalk(root, staged, { includeUnder, ext, excludeTest }); return; }
  const seen = new Set();
  for (const u of includeUnder) {
    for (const abs of walk(join(root, u), excludeFragments)) {
      if (!ext.some((e) => abs.endsWith(e))) continue;
      const rel = relative(root, abs).split(sep).join('/');
      if (excludeTest && /(^|\/)test\//.test(rel)) continue;
      if (seen.has(rel)) continue;
      seen.add(rel);
      let text; try { text = readFileSync(abs, 'utf8'); } catch { continue; }
      yield { relPath: rel, text };
    }
  }
}

/** Staged mode: yield only the staged paths that pass this tool's own includeUnder/ext/excludeTest filters. */
function* stagedWalk(root, staged, { includeUnder, ext, excludeTest }) {
  const seen = new Set();
  for (const rel of staged) {
    if (!includeUnder.some((u) => rel === u || rel.startsWith(`${u}/`))) continue;
    if (!ext.some((e) => rel.endsWith(e))) continue;
    if (excludeTest && /(^|\/)test\//.test(rel)) continue;
    if (seen.has(rel)) continue;
    seen.add(rel);
    let text; try { text = readFileSync(join(root, rel), 'utf8'); } catch { continue; }
    yield { relPath: rel, text };
  }
}

function* walk(dir, excludeFragments) {
  let entries; try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (excludeFragments.includes(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p, excludeFragments);
    else if (e.isFile()) yield p;
  }
}

export function runGate(root, findViolations, walkOpts) {
  const all = [];
  for (const { relPath, text } of walkFiles(root, walkOpts)) all.push(...findViolations(text, relPath));
  return all;
}

export function reportAndExit(label, violations) {
  if (violations.length === 0) { console.log(`${label}: OK (0 violations)`); process.exit(0); }
  console.error(`${label}: FAIL — ${violations.length} violation(s):`);
  for (const v of violations) console.error(`  [${v.rule}] ${v.relPath}:${v.line} — ${v.token ?? v.detail ?? ''}`);
  process.exit(1);
}

/** Optional scope-narrowing sidecar: [{path, reason}] → Set<path>. Absent → empty; bad entry throws. */
export function parseExclusions(root, file) {
  let raw; try { raw = readFileSync(join(root, file), 'utf8'); } catch { return new Set(); }
  let parsed; try { parsed = JSON.parse(raw); } catch (e) { throw new Error(`${file}: invalid JSON — ${e.message}`); }
  const entries = Array.isArray(parsed) ? parsed : (parsed.exclusions ?? []);
  const set = new Set();
  for (const e of entries) {
    if (!e || typeof e.path !== 'string' || !e.path || typeof e.reason !== 'string' || !e.reason.trim())
      throw new Error(`${file}: each entry needs non-empty {path, reason} — bad: ${JSON.stringify(e)}`);
    set.add(e.path);
  }
  return set;
}
