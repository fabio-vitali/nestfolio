import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { digestJson, fileDigest, readJson } from './utils.mjs';
import { fail } from './errors.mjs';

export function resolvePacks(root, requiredCapabilities = []) {
  const packsRoot = join(root, 'continuity', 'packs');
  if (!existsSync(packsRoot)) fail('PACKS_MISSING', 'continuity/packs is missing');
  const manifests = readdirSync(packsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      directory: entry.name,
      manifest: readJson(join(packsRoot, entry.name, 'manifest.json')),
      manifest_path: `continuity/packs/${entry.name}/manifest.json`,
    }))
    .sort((a, b) => a.manifest.id.localeCompare(b.manifest.id));

  const capabilities = new Set();
  const lockedPacks = [];
  const procedures = [];
  for (const entry of manifests) {
    const manifest = entry.manifest;
    if (!manifest.id || !manifest.version || !Array.isArray(manifest.procedures)) {
      fail('INVALID_PACK', `Invalid Pack manifest: ${entry.manifest_path}`);
    }
    const manifestDigest = fileDigest(root, entry.manifest_path);
    const lockedProcedures = [];
    for (const proc of manifest.procedures) {
      const procedure = readJson(join(root, proc.procedure_path));
      if (procedure.id !== proc.id) {
        fail('PROCEDURE_ID_MISMATCH', `Procedure id mismatch for ${proc.procedure_path}`, {
          declared: proc.id,
          actual: procedure.id,
        });
      }
      const procedureDigest = fileDigest(root, proc.procedure_path);
      const executorAssetDigest = fileDigest(root, proc.executor_asset);
      for (const capability of proc.capabilities ?? []) capabilities.add(capability);
      const locked = {
        id: proc.id,
        pack_id: manifest.id,
        pack_version: manifest.version,
        procedure_path: proc.procedure_path,
        procedure_sha256: procedureDigest.sha256,
        executor: proc.executor,
        executor_asset: proc.executor_asset,
        executor_asset_sha256: executorAssetDigest.sha256,
        capabilities: proc.capabilities ?? [],
      };
      lockedProcedures.push(locked);
      procedures.push(locked);
    }
    lockedPacks.push({
      id: manifest.id,
      version: manifest.version,
      manifest_path: entry.manifest_path,
      manifest_sha256: manifestDigest.sha256,
      procedures: lockedProcedures,
    });
  }
  const missing = requiredCapabilities.filter((capability) => !capabilities.has(capability));
  if (missing.length) {
    fail('MISSING_CAPABILITY', `Required Pack capabilities are unavailable`, { missing });
  }
  const lock = {
    schema_version: 1,
    packs: lockedPacks,
    procedures,
    capabilities: [...capabilities].sort(),
  };
  return { ...lock, digest: digestJson(lock) };
}

export function verifyPackLock(root, lock) {
  for (const pack of lock.packs) {
    const manifest = fileDigest(root, pack.manifest_path);
    if (manifest.sha256 !== pack.manifest_sha256) {
      fail('PACK_LOCK_MISMATCH', `Pack manifest changed: ${pack.manifest_path}`, {
        expected_sha256: pack.manifest_sha256,
        actual_sha256: manifest.sha256,
      });
    }
    for (const procedure of pack.procedures) {
      const procedureDigest = fileDigest(root, procedure.procedure_path);
      const assetDigest = fileDigest(root, procedure.executor_asset);
      if (procedureDigest.sha256 !== procedure.procedure_sha256) {
        fail('PACK_LOCK_MISMATCH', `Procedure changed: ${procedure.procedure_path}`, {
          expected_sha256: procedure.procedure_sha256,
          actual_sha256: procedureDigest.sha256,
        });
      }
      if (assetDigest.sha256 !== procedure.executor_asset_sha256) {
        fail('SKILL_ASSET_MISMATCH', `Executor asset changed: ${procedure.executor_asset}`, {
          expected_sha256: procedure.executor_asset_sha256,
          actual_sha256: assetDigest.sha256,
        });
      }
    }
  }
  return true;
}
