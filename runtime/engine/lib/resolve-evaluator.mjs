#!/usr/bin/env node
// resolve-evaluator.mjs — resolveEvaluator(): parse evaluator.run against the closed run-grammar
// (§4 dispatch table) and return { kind, invoke }. Sync structural resolution; deep cmd/eslint
// existence is invoke-time. module: existence is checked (absent file ⇒ EvaluatorUnresolved).
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { isAbsolute, resolve as resolvePath } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { parseRun } from '../schema/check.schema.ts';
import { globsOverlap } from './glob-overlap.mjs';
import { EvaluatorUnresolved, JudgmentContractMissing, JudgeCapabilityUnavailable } from './errors.mjs';

// SPEC 3 §-delta (diff-scoping): resolveEvaluator takes an optional concrete `stagedFiles` list and narrows
// attribution — cmd via RUNTIME_STAGED_PATHS env, eslint via staged∩scope file args. Additive; audit path
// (stagedFiles undefined) unchanged. NOT a frozen-schema/capability change → no SPEC 1 re-freeze.

/** Normalize any evaluator return into Finding-ish objects; empty array = passed. */
function toFindings(result, check) {
  if (!Array.isArray(result)) return [];
  return result.map((r) => ({ kind: check.kind, ...r }));
}

/** staged files (if provided) that match this check's scope globs; else the check's whole scope (audit path). */
export function scopedStagedFiles(check, stagedFiles) {
  if (stagedFiles == null) return check.scope.paths;
  return stagedFiles.filter((f) => check.scope.paths.some((p) => globsOverlap(f, p)));
}

export function resolveEvaluator({ check, judge, stagedFiles }) {
  const parsed = parseRun(check.evaluator.run);
  if (!parsed) throw new EvaluatorUnresolved(check.evaluator.run, 'no valid scheme');
  const { scheme, target } = parsed;

  if (scheme === 'skill') {
    if (!check.flake_contract) throw new JudgmentContractMissing(check.id);
    // SPEC 3 seam #1 (§15 delta): only INVOCATION defers. An injected judge realizes it; without one the throw is unchanged.
    return { kind: 'judgment', invoke: judge
      ? async () => toFindings(await judge(check), check)
      : () => { throw new JudgeCapabilityUnavailable(check.evaluator.run); } };
  }
  if (scheme === 'cmd') {
    return { kind: 'deterministic', invoke: () => {
      const scoped = stagedFiles == null ? null : scopedStagedFiles(check, stagedFiles);   // staged ∩ scope
      const env = scoped == null ? process.env : { ...process.env, RUNTIME_STAGED_PATHS: scoped.join('\n') };
      const r = spawnSync(target, { shell: true, encoding: 'utf8', env });
      if (r.status === 0) return [];
      return toFindings([{ detail: check.property, evidence: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim(),
        scope: scoped ?? check.scope.paths }], check);
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
    const files = scopedStagedFiles(check, stagedFiles);
    if (!files.length) return [];
    const r = spawnSync('npx', ['eslint', '--rule', `{"${target}":"error"}`, ...files], { encoding: 'utf8' });
    return r.status === 0 ? [] : toFindings([{ detail: check.property, evidence: (r.stdout ?? '').trim(), scope: check.scope.paths }], check);
  } };
}

function main() { console.error('resolve-evaluator.mjs is a library; import resolveEvaluator'); process.exit(2); }
if (process.argv[1] === fileURLToPath(import.meta.url)) main();
