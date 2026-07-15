import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';

import { ContinuityLevel2Error } from './core.mjs';

const execFileAsync = promisify(execFile);

async function git(cwd, args, { allowFailure = false } = {}) {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
      maxBuffer: 4 * 1024 * 1024
    });
    return stdout.trimEnd();
  } catch (error) {
    if (allowFailure) return null;
    throw new ContinuityLevel2Error('GIT_METADATA_UNAVAILABLE', `Cannot read Git metadata in ${cwd}: ${error.stderr || error.message}`);
  }
}

function parseStatus(output) {
  const paths = { staged: [], unstaged: [], untracked: [] };
  for (const line of output.split('\n').filter(Boolean)) {
    if (line.startsWith('? ')) {
      paths.untracked.push(line.slice(2));
      continue;
    }
    if (!line.startsWith('1 ') && !line.startsWith('2 ') && !line.startsWith('u ')) continue;
    const fields = line.split(' ');
    const xy = fields[1] ?? '..';
    const path = fields.slice(line.startsWith('2 ') ? 9 : 8).join(' ').split('\t').at(-1);
    if (xy[0] !== '.') paths.staged.push(path);
    if (xy[1] !== '.') paths.unstaged.push(path);
  }
  for (const key of Object.keys(paths)) paths[key] = [...new Set(paths[key])].sort();
  return paths;
}

export async function observeRepositoryStatus(repositoryWorkingDirectory) {
  const cwd = resolve(repositoryWorkingDirectory);
  const root = await git(cwd, ['rev-parse', '--show-toplevel']);
  const head = await git(cwd, ['rev-parse', 'HEAD']);
  const branch = await git(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { allowFailure: true });
  const upstream = await git(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], { allowFailure: true });
  let ahead = null;
  let behind = null;
  if (upstream) {
    const counts = await git(cwd, ['rev-list', '--left-right', '--count', `HEAD...${upstream}`], { allowFailure: true });
    if (counts) [ahead, behind] = counts.split(/\s+/).map(Number);
  }
  const statusOutput = await git(cwd, ['status', '--porcelain=v2', '--untracked-files=all']);
  const paths = parseStatus(statusOutput);
  const dirty = Object.values(paths).some((items) => items.length > 0);
  return {
    repository: {
      root,
      head,
      headState: branch ? 'branch' : 'detached',
      branch,
      upstream,
      ahead,
      behind
    },
    repositoryStatus: {
      classification: dirty ? 'dirty' : 'clean',
      paths
    }
  };
}
