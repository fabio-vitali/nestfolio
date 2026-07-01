#!/usr/bin/env node
// resolve-evaluator.mjs — resolveEvaluator(): parse evaluator.run against the closed run-grammar
// (§4 dispatch table) and return { kind, invoke }. Sync structural resolution; deep cmd/eslint
// existence is invoke-time. module: existence is checked (absent file ⇒ EvaluatorUnresolved).
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { isAbsolute, resolve as resolvePath } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { parseRun } from '../schema/check.schema.ts';
import { EvaluatorUnresolved, JudgmentContractMissing, JudgeCapabilityUnavailable } from './errors.mjs';

/** Normalize any evaluator return into Finding-ish objects; empty array = passed. */
function toFindings(result, check) {
  if (!Array.isArray(result)) return [];
  return result.map((r) => ({ kind: check.kind, ...r }));
}

export function resolveEvaluator({ check }) {
  const parsed = parseRun(check.evaluator.run);
  if (!parsed) throw new EvaluatorUnresolved(check.evaluator.run, 'no valid scheme');
  const { scheme, target } = parsed;

  if (scheme === 'skill') {
    if (!check.flake_contract) throw new JudgmentContractMissing(check.id);
    return { kind: 'judgment', invoke: () => { throw new JudgeCapabilityUnavailable(check.evaluator.run); } };
  }
  if (scheme === 'cmd') {
    return { kind: 'deterministic', invoke: () => {
      const r = spawnSync(target, { shell: true, encoding: 'utf8' });
      if (r.status === 0) return [];
      return toFindings([{ detail: check.property, evidence: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim(), scope: check.scope.paths }], check);
    } };
  }
  if (scheme === 'module') {
    const [spec, exportName] = target.split('#');
    if (!spec || !exportName) throw new EvaluatorUnresolved(check.evaluator.run, 'module ref needs <specifier>#<export>');
    const abs = isAbsolute(spec) ? spec : resolvePath(process.cwd(), spec);
    if (!existsSync(abs)) throw new EvaluatorUnresolved(check.evaluator.run, `module not found: ${abs}`);
    return { kind: 'deterministic', invoke: async () => {
      const mod = await import(pathToFileURL(abs).href);
      const fn = mod[exportName];
      if (typeof fn !== 'function') throw new EvaluatorUnresolved(check.evaluator.run, `export ${exportName} is not a function`);
      return toFindings(await fn(), check);   // ring-1 calling convention: zero-arg core → violation array
    } };
  }
  // eslint:
  if (!target.length) throw new EvaluatorUnresolved(check.evaluator.run, 'empty eslint rule id');
  return { kind: 'deterministic', invoke: () => {
    const r = spawnSync('npx', ['eslint', '--rule', `{"${target}":"error"}`, ...check.scope.paths], { encoding: 'utf8' });
    return r.status === 0 ? [] : toFindings([{ detail: check.property, evidence: (r.stdout ?? '').trim(), scope: check.scope.paths }], check);
  } };
}

function main() { console.error('resolve-evaluator.mjs is a library; import resolveEvaluator'); process.exit(2); }
if (process.argv[1] === fileURLToPath(import.meta.url)) main();
