import { readFile } from 'node:fs/promises';

import {
  ContinuityLevel2Error,
  REUSABLE_FORBIDDEN_MARKERS,
  computeAggregateDigest,
  stableJson
} from './core.mjs';
import { hashFile, listFiles, readJson, resolveWithin } from './repository-infrastructure.mjs';

const EXPECTED_ROOTS = Object.freeze([
  'continuity.repository-tools@1.0.0',
  'nestfolio.level-1@1.0.1'
]);
const EXPECTED_PROCEDURES = Object.freeze([
  'continuity.repository-status@1.0.0',
  'nestfolio.backlog-next@1.0.1'
]);
const HOST_CAPABILITIES = new Set(['local-process-execution', 'git-read-metadata']);
const REUSABLE_PERMISSIONS = Object.freeze({ network: 'forbidden', reads: ['git-repository-metadata'], writes: [] });

function assert(condition, code, message, details) {
  if (!condition) throw new ContinuityLevel2Error(code, message, details);
}

function sameArray(left, right) {
  return stableJson(left) === stableJson(right);
}

async function verifyDeclaredFile(workspaceRoot, declaration, role) {
  assert(declaration?.path && declaration?.sha256 && Number.isInteger(declaration?.bytes), 'MISSING_DECLARATION', `${role} lacks an exact local path, digest, or byte size.`, declaration);
  const actual = await hashFile(workspaceRoot, declaration.path);
  assert(actual.sha256 === declaration.sha256 && actual.bytes === declaration.bytes, 'SOURCE_DIGEST_MISMATCH', `${role} differs from the composed lock.`, { role, expected: declaration, actual });
  return actual;
}

function validateCompatibility(pack, adoptionLevel, executorFamily, availableCapabilities) {
  const compatibility = pack.compatibility;
  assert(compatibility && Array.isArray(compatibility.adoptionLevels) && Array.isArray(compatibility.executorFamilies), 'MISSING_COMPATIBILITY', `Pack ${pack.identity} has no recognized compatibility declaration.`);
  assert(compatibility.adoptionLevels.includes(adoptionLevel), 'UNSUPPORTED_ADOPTION_LEVEL', `Pack ${pack.identity} does not support adoption Level ${adoptionLevel}.`, compatibility);
  assert(compatibility.executorFamilies.includes(executorFamily), 'UNSUPPORTED_EXECUTOR', `Pack ${pack.identity} does not support executor ${executorFamily}.`, compatibility);
  assert(Array.isArray(compatibility.requiredCapabilities), 'MISSING_COMPATIBILITY', `Pack ${pack.identity} lacks required capability declarations.`);
  const missing = compatibility.requiredCapabilities.filter((capability) => !availableCapabilities.has(capability));
  assert(missing.length === 0, 'MISSING_REQUIRED_CAPABILITY', `Pack ${pack.identity} requires unavailable local capabilities.`, { missing });
  assert(compatibility.deprecated === false, 'NEWLY_SELECTED_DEPRECATED_PACK', `Newly selected Pack ${pack.identity} is deprecated.`, compatibility);
}

function validatePermissions(pack) {
  assert(pack.permissions && Array.isArray(pack.permissions.reads) && Array.isArray(pack.permissions.writes), 'MISSING_PERMISSION_DECLARATION', `Pack ${pack.identity} lacks an exact permission declaration.`);
  if (pack.identity === 'continuity.repository-tools@1.0.0') {
    assert(stableJson(pack.permissions) === stableJson(REUSABLE_PERMISSIONS), 'UNDECLARED_OR_WIDENED_PERMISSION', 'The reusable Pack permission set is missing, undeclared, or wider than its read-only contract.', { expected: REUSABLE_PERMISSIONS, actual: pack.permissions });
  }
}

async function scanReusableSeparation(workspaceRoot, pack) {
  const declarations = [pack.manifest, ...pack.procedures.flatMap((procedure) => [procedure.spec, procedure.asset])];
  const findings = [];
  for (const declaration of declarations) {
    const text = (await readFile(resolveWithin(workspaceRoot, declaration.path), 'utf8')).toLowerCase();
    for (const marker of REUSABLE_FORBIDDEN_MARKERS) {
      if (text.includes(marker.toLowerCase())) findings.push({ path: declaration.path, marker });
    }
  }
  assert(findings.length === 0, 'PROHIBITED_PROJECT_SEMANTIC', 'The reusable Pack references prohibited project semantics or paths.', findings);
  return { status: 'pass', scanned: declarations.map((item) => item.path).sort(), findings };
}

async function validateReusableDeclarations(workspaceRoot, pack) {
  const manifest = await readJson(workspaceRoot, pack.manifest.path);
  const procedureEntry = pack.procedures[0];
  const procedure = await readJson(workspaceRoot, procedureEntry.spec.path);
  assert(`${manifest.identity?.id}@${manifest.identity?.version}` === pack.identity, 'PACK_DECLARATION_MISMATCH', 'Reusable Pack manifest identity differs from the composed lock.');
  assert(manifest.class === pack.class, 'PACK_DECLARATION_MISMATCH', 'Reusable Pack class differs from the composed lock.');
  assert(stableJson(manifest.permissions) === stableJson(pack.permissions), 'UNDECLARED_OR_WIDENED_PERMISSION', 'Reusable Pack manifest permissions differ from the composed lock.');
  assert(`${procedure.identity?.id}@${procedure.identity?.version}` === procedureEntry.identity, 'PROCEDURE_DECLARATION_MISMATCH', 'Reusable Procedure specification identity differs from the composed lock.');
  assert(procedure.entryPoint === procedureEntry.entryPoint && procedure.behaviorAuthority?.path === procedureEntry.asset.path, 'PROCEDURE_ASSET_MAPPING_MISMATCH', 'Reusable Procedure entry point or executor asset differs from the composed lock.');
  assert(stableJson(procedure.permissions) === stableJson(procedureEntry.permissions), 'UNDECLARED_OR_WIDENED_PERMISSION', 'Reusable Procedure permissions differ from the composed lock.');
  assert(sameArray(procedure.requiredCapabilities, procedureEntry.requiredCapabilities), 'MISSING_REQUIRED_CAPABILITY', 'Reusable Procedure capability declaration differs from the composed lock.');
  assert(Array.isArray(procedure.prerequisites) && procedure.prerequisites.includes('local Git executable') && procedure.prerequisites.includes('explicit local repository working directory'), 'MISSING_DECLARED_PREREQUISITE', 'Reusable Procedure lacks one of its two required local prerequisites.', procedure.prerequisites);
  const sourceFiles = await listFiles(workspaceRoot, 'continuity/level-2/packs/continuity.repository-tools/1.0.0');
  assert(sameArray(sourceFiles, [pack.manifest.path, procedureEntry.spec.path].sort()), 'UNENUMERATED_OR_MULTIPLY_SOURCED_ASSET', 'Reusable Pack version directory contains an undeclared source file.', { sourceFiles });
  return { status: 'pass', manifest: pack.manifest.path, procedure: procedureEntry.spec.path, asset: procedureEntry.asset.path };
}

export async function validateComposedLock(workspaceRoot, lock, options = {}) {
  assert(lock?.schemaVersion === 1 && lock.kind === 'continuity.level2.composed-lock', 'INVALID_COMPOSED_LOCK', 'The composed lock schema or kind is unsupported.');
  assert(lock.adoptionLevel === 2, 'UNSUPPORTED_ADOPTION_LEVEL', 'The composed lock must declare adoption Level 2.');
  assert(lock.executorFamily === 'claude-code', 'UNSUPPORTED_EXECUTOR', 'The composed lock must declare the supported Claude Code executor family.');
  assert(Array.isArray(lock.rootPacks) && sameArray(lock.rootPacks, EXPECTED_ROOTS), 'ROOT_PACK_SET_MISMATCH', 'The composed lock must select exactly the two reviewed root Pack identities.', { expected: EXPECTED_ROOTS, actual: lock.rootPacks });
  assert(Array.isArray(lock.packs), 'PACK_CARDINALITY_MISMATCH', 'The composed lock must contain a Pack list.');
  assert((lock.overrides ?? []).length === 0, 'OVERRIDE_NOT_PERMITTED', 'MI-002 permits no override.');
  assert((lock.registries ?? []).length === 0, 'REGISTRY_NOT_PERMITTED', 'MI-002 permits no Pack registry.');
  assert((lock.remoteSources ?? []).length === 0, 'REMOTE_SOURCE_NOT_PERMITTED', 'MI-002 permits no remote Pack source.');
  assert(lock.sourcePolicy?.exactVersionsOnly === true && lock.sourcePolicy?.networkLookup === 'forbidden', 'INVALID_SOURCE_POLICY', 'The composed lock must require exact local versions and forbid network lookup.');

  const expectedAggregate = computeAggregateDigest(lock);
  assert(lock.aggregate?.algorithm === 'sha256' && lock.aggregate?.digest === expectedAggregate, 'AGGREGATE_LOCK_DIGEST_MISMATCH', 'The aggregate composed-lock digest does not match canonical resolved material.', { expected: expectedAggregate, actual: lock.aggregate?.digest });

  const packIdentities = lock.packs.map((pack) => pack.identity);
  assert(new Set(packIdentities).size === packIdentities.length, 'DUPLICATE_PACK_IDENTITY', 'A Pack identity resolves from multiple selected sources.', { packIdentities });
  const rawProcedureIdentities = lock.packs.flatMap((pack) => (pack.procedures ?? []).map((procedure) => procedure.identity));
  assert(new Set(rawProcedureIdentities).size === rawProcedureIdentities.length, 'DUPLICATE_PROCEDURE_IDENTITY', 'A Procedure identity resolves more than once.', { identities: rawProcedureIdentities });
  assert(lock.packs.length === 2, 'PACK_CARDINALITY_MISMATCH', 'Exactly two Pack versions must resolve.');
  assert(sameArray([...packIdentities].sort(), EXPECTED_ROOTS), 'ROOT_PACK_SET_MISMATCH', 'Resolved Pack identities differ from the exact selected roots.', { packIdentities });

  const availableCapabilities = new Set(options.availableCapabilities ?? [...HOST_CAPABILITIES]);
  const verifiedFiles = [];
  const procedures = [];
  for (const pack of lock.packs) {
    assert(pack.source?.type === 'local-immutable' && !pack.source?.registry && !pack.source?.remote, 'REMOTE_SOURCE_NOT_PERMITTED', `Pack ${pack.identity} is not an exact local immutable source.`, pack.source);
    validateCompatibility(pack, lock.adoptionLevel, lock.executorFamily, availableCapabilities);
    validatePermissions(pack);
    verifiedFiles.push(await verifyDeclaredFile(workspaceRoot, pack.manifest, `Pack manifest ${pack.identity}`));
    assert(Array.isArray(pack.procedures) && pack.procedures.length === 1, 'PROCEDURE_CARDINALITY_MISMATCH', `Pack ${pack.identity} must contribute exactly one Procedure.`);
    for (const procedure of pack.procedures) {
      verifiedFiles.push(await verifyDeclaredFile(workspaceRoot, procedure.spec, `Procedure specification ${procedure.identity}`));
      verifiedFiles.push(await verifyDeclaredFile(workspaceRoot, procedure.asset, `Primary executor asset ${procedure.identity}`));
      if (procedure.binding) verifiedFiles.push(await verifyDeclaredFile(workspaceRoot, procedure.binding, `Project binding ${procedure.identity}`));
      for (const asset of procedure.lockedAssets ?? []) verifiedFiles.push(await verifyDeclaredFile(workspaceRoot, asset, `Locked behavior asset ${procedure.identity}`));
      assert(Array.isArray(procedure.requiredCapabilities) && procedure.requiredCapabilities.every((item) => availableCapabilities.has(item)), 'MISSING_REQUIRED_CAPABILITY', `Procedure ${procedure.identity} requires an unavailable capability.`, procedure.requiredCapabilities);
      assert(procedure.permissions && Array.isArray(procedure.permissions.reads) && Array.isArray(procedure.permissions.writes), 'MISSING_PERMISSION_DECLARATION', `Procedure ${procedure.identity} lacks exact permissions.`);
      procedures.push({ ...procedure, pack: pack.identity, class: pack.class });
    }
  }

  const identities = procedures.map((procedure) => procedure.identity);
  assert(sameArray([...identities].sort(), EXPECTED_PROCEDURES), 'PROCEDURE_SET_MISMATCH', 'The composed lock must resolve exactly the two reviewed Procedure identities.', { expected: EXPECTED_PROCEDURES, actual: identities });
  assert(new Set(identities).size === identities.length, 'DUPLICATE_PROCEDURE_IDENTITY', 'A Procedure identity resolves more than once.', { identities });
  const entryPoints = procedures.map((procedure) => procedure.entryPoint);
  assert(new Set(entryPoints).size === entryPoints.length, 'COMPETING_ENTRY_POINT', 'Two Procedures claim the same adapter entry point.', { entryPoints });
  const assetPaths = procedures.map((procedure) => procedure.asset.path);
  assert(new Set(assetPaths).size === assetPaths.length, 'MULTIPLE_ASSET_RESOLUTION', 'A Procedure executor asset is multiply sourced.', { assetPaths });
  const writableClaims = procedures.flatMap((procedure) => procedure.permissions.writes.map((path) => ({ identity: procedure.identity, path })));
  const writablePaths = writableClaims.map((item) => item.path);
  assert(new Set(writablePaths).size === writablePaths.length, 'COMPETING_WRITABLE_ASSET', 'Two Procedures claim the same writable asset or path.', writableClaims);

  const level1 = procedures.find((procedure) => procedure.identity === 'nestfolio.backlog-next@1.0.1');
  assert(level1.lockedAssets?.length === 19, 'LEVEL1_ASSET_SET_MISMATCH', 'The retained Level 1 Procedure must preserve all 19 locked behavior assets.', { count: level1.lockedAssets?.length });
  const actualLevel1Paths = await listFiles(workspaceRoot, '.claude/skills/backlog-next');
  assert(sameArray(level1.lockedAssets.map((asset) => asset.path).sort(), actualLevel1Paths), 'UNENUMERATED_OR_MULTIPLY_SOURCED_ASSET', 'The retained Level 1 behavior root differs from the exact 19-asset composed mapping.', { locked: level1.lockedAssets.map((asset) => asset.path).sort(), actual: actualLevel1Paths });

  const reusable = lock.packs.find((pack) => pack.identity === 'continuity.repository-tools@1.0.0');
  const reusableDeclarations = await validateReusableDeclarations(workspaceRoot, reusable);
  const separation = await scanReusableSeparation(workspaceRoot, reusable);
  return {
    status: 'pass',
    aggregateDigest: expectedAggregate,
    packs: [...packIdentities].sort(),
    procedures: procedures.sort((left, right) => Buffer.from(left.identity).compare(Buffer.from(right.identity))),
    verifiedFiles: [...new Map(verifiedFiles.map((item) => [item.path, item])).values()].sort((left, right) => Buffer.from(left.path).compare(Buffer.from(right.path))),
    reusableDeclarations,
    separation
  };
}

export async function selfValidatePack(workspaceRoot, lock, identity) {
  const validation = await validateComposedLock(workspaceRoot, lock);
  const pack = lock.packs.find((candidate) => candidate.identity === identity);
  assert(pack, 'PACK_NOT_FOUND', `Pack ${identity} is not selected by the composed lock.`);
  const procedureIds = pack.procedures.map((procedure) => procedure.identity).sort();
  return {
    status: 'pass',
    identity,
    manifest: await hashFile(workspaceRoot, pack.manifest.path),
    procedures: procedureIds,
    selectedAggregateDigest: validation.aggregateDigest
  };
}
