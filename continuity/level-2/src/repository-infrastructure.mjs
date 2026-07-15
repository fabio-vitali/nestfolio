import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';

import { ContinuityLevel2Error, canonicalJson } from './core.mjs';

export const LEVEL2_PATHS = Object.freeze({
  activation: 'continuity/level-2/activation.json',
  lock: 'continuity/level-2/packs.lock.json',
  history: 'continuity/level-2/activation-history.ndjson',
  reusableManifest: 'continuity/level-2/packs/continuity.repository-tools/1.0.0/pack-manifest.json',
  reusableProcedure: 'continuity/level-2/packs/continuity.repository-tools/1.0.0/procedures/continuity.repository-status.json',
  reusableAsset: '.claude/skills/continuity-repository-status/SKILL.md'
});

export function resolveWithin(root, path) {
  const absoluteRoot = resolve(root);
  const full = resolve(absoluteRoot, path);
  if (full !== absoluteRoot && !full.startsWith(`${absoluteRoot}${sep}`)) {
    throw new ContinuityLevel2Error('PATH_ESCAPE', `Path escapes the bounded root: ${path}`);
  }
  return full;
}

export async function readBytes(root, path) {
  return readFile(resolveWithin(root, path));
}

export async function readJson(root, path) {
  try {
    return JSON.parse(await readFile(resolveWithin(root, path), 'utf8'));
  } catch (error) {
    throw new ContinuityLevel2Error('MISSING_OR_INVALID_SOURCE', `Cannot read valid JSON at ${path}: ${error.message}`, { path });
  }
}

export async function hashFile(root, path) {
  try {
    const bytes = await readBytes(root, path);
    return { path: path.split(sep).join('/'), sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.byteLength };
  } catch (error) {
    if (error instanceof ContinuityLevel2Error) throw error;
    throw new ContinuityLevel2Error('MISSING_SOURCE', `Required local source is missing: ${path}`, { path });
  }
}

export async function listFiles(root, path) {
  const base = resolveWithin(root, path);
  const output = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const full = resolve(directory, entry.name);
      if (entry.isDirectory()) await visit(full);
      else if (entry.isFile()) output.push(relative(resolve(root), full).split(sep).join('/'));
      else throw new ContinuityLevel2Error('UNSUPPORTED_SOURCE_TYPE', `Only regular files are allowed in Pack sources: ${full}`);
    }
  }
  await visit(base);
  return output.sort();
}

export async function writeJsonAtomic(root, path, value, options = {}) {
  const full = resolveWithin(root, path);
  await mkdir(dirname(full), { recursive: true });
  const temporary = `${full}.tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(temporary, canonicalJson(value), 'utf8');
    if (options.interruptBeforeRename) {
      throw new ContinuityLevel2Error('ATOMIC_REPLACEMENT_INTERRUPTED', 'Simulated interruption before atomic activation replacement.', { path });
    }
    await rename(temporary, full);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  return hashFile(root, path);
}

export async function writeBytesAtomic(root, path, bytes) {
  const full = resolveWithin(root, path);
  await mkdir(dirname(full), { recursive: true });
  const temporary = `${full}.tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(temporary, bytes);
    await rename(temporary, full);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

export async function appendHistory(root, entry) {
  const full = resolveWithin(root, LEVEL2_PATHS.history);
  await mkdir(dirname(full), { recursive: true });
  await appendFile(full, `${JSON.stringify(entry)}\n`, 'utf8');
}

export async function readHistory(root) {
  try {
    const text = await readFile(resolveWithin(root, LEVEL2_PATHS.history), 'utf8');
    return text.split('\n').filter(Boolean).map((line, index) => {
      try { return JSON.parse(line); }
      catch (error) { throw new ContinuityLevel2Error('INVALID_ACTIVATION_HISTORY', `Invalid activation history line ${index + 1}: ${error.message}`); }
    });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

export async function fileSize(root, path) {
  return (await stat(resolveWithin(root, path))).size;
}
