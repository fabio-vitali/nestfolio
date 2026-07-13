import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sha256, writeTextAtomic } from './utils.mjs';
import { fail } from './errors.mjs';

function scalar(value) {
  const trimmed = value.trim();
  if (trimmed === 'null') return null;
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (/^-?\d+$/.test(trimmed)) return Number(trimmed);
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const inner = trimmed.slice(1, -1).trim();
    return inner ? inner.split(',').map((part) => scalar(part)) : [];
  }
  return trimmed;
}

export function parseFrontmatter(text) {
  if (!text.startsWith('---\n')) fail('INVALID_BACKLOG', 'Backlog item has no YAML frontmatter');
  const close = text.indexOf('\n---\n', 4);
  if (close < 0) fail('INVALID_BACKLOG', 'Backlog item has unterminated YAML frontmatter');
  const yaml = text.slice(4, close);
  const body = text.slice(close + 5);
  const data = {};
  let currentList = null;
  for (const rawLine of yaml.split('\n')) {
    if (!rawLine.trim()) continue;
    const listMatch = rawLine.match(/^\s+-\s+(.*)$/);
    if (listMatch && currentList) {
      data[currentList].push(scalar(listMatch[1]));
      continue;
    }
    const match = rawLine.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!match) continue;
    const [, key, value] = match;
    if (value === '') {
      data[key] = [];
      currentList = key;
    } else {
      data[key] = scalar(value);
      currentList = null;
    }
  }
  return { data, body, frontmatter_end: close + 5 };
}

export function loadBacklogItem(root, workId) {
  const relative_path = `docs/backlog/${workId}.md`;
  const path = join(root, relative_path);
  if (!existsSync(path)) fail('WORK_NOT_FOUND', `Nestfolio backlog item not found: ${workId}`, { work_id: workId, path: relative_path });
  const text = readFileSync(path, 'utf8');
  const parsed = parseFrontmatter(text);
  if (parsed.data.id !== workId) fail('BACKLOG_ID_MISMATCH', `Backlog id does not match filename`, { expected: workId, actual: parsed.data.id });
  return {
    relative_path,
    path,
    text,
    sha256: sha256(text),
    frontmatter: parsed.data,
    body: parsed.body,
  };
}

function replaceScalarField(text, key, value) {
  const line = `${key}: ${value}`;
  const regex = new RegExp(`^${key}:.*$`, 'm');
  if (regex.test(text)) return text.replace(regex, line);
  const close = text.indexOf('\n---\n', 4);
  return `${text.slice(0, close)}\n${line}${text.slice(close)}`;
}

export function updateBacklogItem(root, workId, {
  expected_sha256,
  status,
  closed,
  validation_gate,
}) {
  const current = loadBacklogItem(root, workId);
  if (current.sha256 !== expected_sha256) {
    fail('REVISION_CONFLICT', `Backlog item changed since selection`, {
      work_id: workId,
      expected_sha256,
      actual_sha256: current.sha256,
    });
  }
  let text = current.text;
  if (status) text = replaceScalarField(text, 'status', status);
  if (closed) text = replaceScalarField(text, 'closed', closed);
  if (validation_gate) text = replaceScalarField(text, 'validation_gate', JSON.stringify(validation_gate));
  writeTextAtomic(current.path, text);
  return loadBacklogItem(root, workId);
}
