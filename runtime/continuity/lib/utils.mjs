import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fail } from './errors.mjs';

export const isoNow = () => new Date().toISOString();
export const newId = (prefix) => `${prefix}-${randomUUID()}`;

export function sha256(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
  return createHash('sha256').update(bytes).digest('hex');
}

export function stableStringify(value) {
  const stack = new WeakSet();
  const normalize = (input) => {
    if (input === null || typeof input !== 'object') return input;
    if (stack.has(input)) throw new TypeError('Cannot stringify cyclic value');
    stack.add(input);
    let output;
    if (Array.isArray(input)) {
      output = input.map(normalize);
    } else {
      output = {};
      for (const key of Object.keys(input).sort()) output[key] = normalize(input[key]);
    }
    stack.delete(input);
    return output;
  };
  return JSON.stringify(normalize(value), null, 2);
}

export function digestJson(value) {
  return sha256(stableStringify(value));
}

export function readJson(path, { required = true } = {}) {
  if (!existsSync(path)) {
    if (!required) return null;
    fail('MISSING_ARTIFACT', `Required JSON file is missing: ${path}`, { path });
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail('INVALID_JSON', `Invalid JSON file: ${path}`, { path, cause: error.message });
  }
}

export function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, `${stableStringify(value)}\n`);
  renameSync(tmp, path);
}

export function writeTextAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, value);
  renameSync(tmp, path);
}

export function assertInsideRoot(root, candidate) {
  const rootAbs = resolve(root);
  const candidateAbs = resolve(candidate);
  const rel = relative(rootAbs, candidateAbs);
  if (rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !rel.startsWith(sep))) {
    return candidateAbs;
  }
  fail('PATH_OUTSIDE_REPOSITORY', `Path escapes repository root: ${candidate}`, { root: rootAbs, candidate: candidateAbs });
}

export function walkFiles(root, relativePath) {
  const start = assertInsideRoot(root, join(root, relativePath));
  if (!existsSync(start)) return [];
  const output = [];
  const visit = (path) => {
    const stat = statSync(path);
    if (stat.isDirectory()) {
      for (const entry of readdirSync(path).sort()) {
        if (entry === '.git' || entry === 'node_modules') continue;
        visit(join(path, entry));
      }
    } else if (stat.isFile()) {
      output.push(path);
    }
  };
  visit(start);
  return output;
}

export function gitIdentity(root) {
  try {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    let branch = null;
    try {
      branch = execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
    } catch {}
    return { mode: 'git', head, branch };
  } catch {
    return { mode: 'archive', head: null, branch: null };
  }
}

export function repositoryFingerprint(root, fingerprintPaths) {
  const identity = gitIdentity(root);
  const files = [];
  for (const rel of fingerprintPaths) {
    for (const abs of walkFiles(root, rel)) {
      const relativePath = relative(root, abs).split(sep).join('/');
      if (
        relativePath.startsWith('.continuity/')
        || relativePath.startsWith('continuity/artifacts/')
        || relativePath.startsWith('continuity/evidence/')
      ) continue;
      const content = readFileSync(abs);
      files.push({ path: relativePath, sha256: sha256(content), size: content.length });
    }
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  const payload = { identity, files };
  return { ...payload, digest: digestJson(payload) };
}

export function fileDigest(root, relativePath) {
  const abs = assertInsideRoot(root, join(root, relativePath));
  if (!existsSync(abs)) {
    fail('MISSING_ASSET', `Required asset is missing: ${relativePath}`, { path: relativePath });
  }
  const bytes = readFileSync(abs);
  return { path: relativePath, sha256: sha256(bytes), size: bytes.length };
}

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  const args = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith('--')) fail('INVALID_ARGUMENT', `Unexpected argument: ${token}`);
    const key = token.slice(2).replaceAll('-', '_');
    const next = rest[index + 1];
    if (next == null || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      index += 1;
    }
  }
  return { command, args };
}

export function requireArgs(args, names) {
  for (const name of names) {
    if (args[name] == null || args[name] === '') fail('MISSING_ARGUMENT', `Missing required argument --${name.replaceAll('_', '-')}`);
  }
}
