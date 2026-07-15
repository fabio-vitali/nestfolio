import { createHash } from 'node:crypto';
import { readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

import { sha256Text, stableJson } from './core.mjs';

export const LEVEL1_PATHS = Object.freeze({
  manifest: 'continuity/level-1/pack-manifest.json',
  procedure: 'continuity/level-1/procedure-contract.json',
  binding: 'continuity/level-1/project-binding.json',
  lock: 'continuity/level-1/pack-lock.json',
  activation: 'continuity/level-1/activation.json'
});

export async function readJson(repoRoot, path) {
  const full = resolveWithin(repoRoot, path);
  try {
    return JSON.parse(await readFile(full, 'utf8'));
  } catch (error) {
    const wrapped = new Error(`Cannot read valid JSON at ${path}: ${error.message}`);
    wrapped.code = 'CORRUPT_OR_MISSING_CONFIGURATION';
    throw wrapped;
  }
}

export function resolveWithin(repoRoot, path) {
  const root = resolve(repoRoot);
  const full = resolve(root, path);
  if (full !== root && !full.startsWith(`${root}${sep}`)) {
    const error = new Error(`Path escapes repository root: ${path}`);
    error.code = 'PATH_ESCAPE';
    throw error;
  }
  return full;
}

export async function hashFile(repoRoot, path) {
  const full = resolveWithin(repoRoot, path);
  const content = await readFile(full);
  return {
    path: path.split(sep).join('/'),
    sha256: createHash('sha256').update(content).digest('hex'),
    bytes: content.byteLength
  };
}

export async function identifyRepository(repoRoot, binding) {
  const markers = binding?.project?.repositoryMarkers ?? [];
  const present = markers.filter((path) => existsSync(resolveWithin(repoRoot, path)));
  const missing = markers.filter((path) => !present.includes(path));
  const packageJson = present.includes('package.json') ? await readJson(repoRoot, 'package.json') : {};
  const identityMaterial = JSON.stringify({ id: binding?.project?.id, name: packageJson.name ?? null, markers: present });
  return {
    id: binding?.project?.id ?? 'unknown',
    packageName: packageJson.name ?? null,
    root: resolve(repoRoot),
    fingerprint: createHash('sha256').update(identityMaterial).digest('hex'),
    markers: { present, missing },
    recognized: missing.length === 0
  };
}

async function listFiles(repoRoot, relativeRoot) {
  const root = resolveWithin(repoRoot, relativeRoot);
  const files = [];
  async function visit(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) await visit(full);
      else files.push(relative(resolve(repoRoot), full).split(sep).join('/'));
    }
  }
  await visit(root);
  return files.sort();
}

export async function verifyLock(repoRoot, lock) {
  const failures = [];
  const verified = [];
  if (!lock || lock.schemaVersion !== 1 || lock.algorithm !== 'sha256' || !Array.isArray(lock.assets) || !lock.assetRoot) {
    const error = new Error('Pack lock is missing required schemaVersion, assetRoot, or assets.');
    error.code = 'CORRUPT_LOCK';
    throw error;
  }
  const lockIdentity = {
    pack: lock.pack,
    procedure: lock.procedure,
    algorithm: lock.algorithm,
    assets: lock.assets
  };
  const expectedLockDigest = sha256Text(stableJson(lockIdentity));
  if (lock.lockDigest !== expectedLockDigest) {
    failures.push({ code: 'LOCK_DIGEST_MISMATCH', expected: expectedLockDigest, actual: lock.lockDigest });
  }
  const paths = new Set();
  for (const asset of lock.assets) {
    if (paths.has(asset.path)) failures.push({ code: 'DUPLICATE_ASSET_SOURCE', path: asset.path });
    paths.add(asset.path);
    try {
      const actual = await hashFile(repoRoot, asset.path);
      if (actual.sha256 !== asset.sha256 || actual.bytes !== asset.bytes) {
        failures.push({ code: 'ASSET_DIGEST_MISMATCH', path: asset.path, expected: asset, actual });
      } else {
        verified.push(actual);
      }
    } catch (error) {
      failures.push({ code: 'ASSET_MISSING', path: asset.path, message: error.message });
    }
  }
  try {
    const actualPaths = await listFiles(repoRoot, lock.assetRoot);
    const lockedPaths = [...paths].sort();
    for (const path of actualPaths.filter((path) => !paths.has(path))) {
      failures.push({ code: 'UNLOCKED_ASSET', path });
    }
    for (const path of lockedPaths.filter((path) => !actualPaths.includes(path))) {
      if (!failures.some((failure) => failure.code === 'ASSET_MISSING' && failure.path === path)) {
        failures.push({ code: 'ASSET_MISSING', path });
      }
    }
  } catch (error) {
    failures.push({ code: 'ASSET_ROOT_MISSING', path: lock.assetRoot, message: error.message });
  }
  return { ok: failures.length === 0, verified, failures, expectedLockDigest };
}

export async function writeJsonAtomic(repoRoot, path, value) {
  const full = resolveWithin(repoRoot, path);
  const temporary = `${full}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, full);
  return path;
}

export async function pathMetadata(repoRoot, path) {
  const full = resolveWithin(repoRoot, path);
  const info = await stat(full);
  return { path, bytes: info.size };
}
