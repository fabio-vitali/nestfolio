import { appendFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { digestJson, isoNow, readJson, writeJsonAtomic } from './utils.mjs';
import { fail } from './errors.mjs';

export function createStore(root) {
  const durableRoot = join(root, 'continuity', 'artifacts');
  const operationalRoot = join(root, '.continuity');
  const artifactPath = (kind, id) => join(durableRoot, kind, `${id}.json`);
  const operationalPath = (runId, name) => join(operationalRoot, 'runs', runId, `${name}.json`);
  const auditPath = join(operationalRoot, 'audit.ndjson');

  const readArtifact = (kind, id, options) => readJson(artifactPath(kind, id), options);

  const writeArtifact = (kind, id, value, { expectedRevision = null, immutable = false } = {}) => {
    const path = artifactPath(kind, id);
    const current = readJson(path, { required: false });
    if (immutable && current) {
      fail('IMMUTABLE_ARTIFACT_EXISTS', `${kind}/${id} already exists`, { kind, id, revision: current.revision });
    }
    if (expectedRevision != null && (current?.revision ?? 0) !== Number(expectedRevision)) {
      fail('REVISION_CONFLICT', `Revision conflict for ${kind}/${id}`, {
        kind,
        id,
        expected_revision: Number(expectedRevision),
        actual_revision: current?.revision ?? 0,
      });
    }
    const revision = (current?.revision ?? 0) + 1;
    const envelope = {
      ...value,
      id,
      revision,
      updated_at: isoNow(),
    };
    const digest = digestJson(envelope);
    writeJsonAtomic(path, { ...envelope, digest });
    return readJson(path);
  };

  const writeImmutableArtifact = (kind, id, value) => writeArtifact(kind, id, value, { immutable: true });

  const readOperational = (runId, name, options) => readJson(operationalPath(runId, name), options);

  const writeOperational = (runId, name, value) => {
    const envelope = { ...value, updated_at: isoNow() };
    const digest = digestJson(envelope);
    writeJsonAtomic(operationalPath(runId, name), { ...envelope, digest });
    return readJson(operationalPath(runId, name));
  };

  const appendAudit = (record) => {
    mkdirSync(operationalRoot, { recursive: true });
    appendFileSync(auditPath, `${JSON.stringify({ ...record, timestamp: isoNow() })}\n`);
  };

  const listArtifacts = (kind) => {
    const dir = join(durableRoot, kind);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((name) => name.endsWith('.json'))
      .sort()
      .map((name) => readJson(join(dir, name)));
  };

  const rebuildIndex = () => {
    const kinds = existsSync(durableRoot)
      ? readdirSync(durableRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
      : [];
    const artifacts = {};
    for (const kind of kinds) {
      artifacts[kind] = listArtifacts(kind).map((artifact) => ({
        id: artifact.id,
        revision: artifact.revision,
        digest: artifact.digest,
        status: artifact.status ?? null,
      }));
    }
    const runsDir = join(operationalRoot, 'runs');
    const active_runs = existsSync(runsDir)
      ? readdirSync(runsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => {
        const head = readJson(join(runsDir, entry.name, 'head.json'), { required: false });
        return { id: entry.name, status: head?.status ?? 'unknown', digest: head?.digest ?? null };
      }).sort((a, b) => a.id.localeCompare(b.id))
      : [];
    const index = {
      schema_version: 1,
      derived: true,
      rebuilt_at: isoNow(),
      artifacts,
      active_runs,
    };
    writeJsonAtomic(join(operationalRoot, 'derived', 'index.json'), { ...index, digest: digestJson(index) });
    return readJson(join(operationalRoot, 'derived', 'index.json'));
  };

  const deleteDerivedIndex = () => rmSync(join(operationalRoot, 'derived', 'index.json'), { force: true });

  return {
    root,
    durableRoot,
    operationalRoot,
    artifactPath,
    operationalPath,
    readArtifact,
    writeArtifact,
    writeImmutableArtifact,
    listArtifacts,
    readOperational,
    writeOperational,
    appendAudit,
    rebuildIndex,
    deleteDerivedIndex,
  };
}
