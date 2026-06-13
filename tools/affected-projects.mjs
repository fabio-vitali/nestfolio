#!/usr/bin/env node
/**
 * tools/affected-projects.mjs — compute the TRUE affected project set.
 *
 * nx 22.5.4 `affected` over-approximates: it returns event-processor's entire
 * dependent closure (~33 projects) for ANY project that transitively imports
 * event-processor — a read-model sink like dashboard-bff reports 33 when the
 * truth is 1. The `nx graph` JSON itself is correct; only `affected`'s
 * consumption of it is wrong (nx discussion #5580 / issue #1169; not fixed in
 * 22.7.5; projectsAffectedByDependencyUpdates has no effect). This tool computes
 *   affected = touched ∪ reverse-reachability(touched)
 * over the graph's dependency edges — exactly what `affected` should return.
 *
 * Usage:
 *   node tools/affected-projects.mjs [--base=<ref>] [--head=<ref>]
 *        [--files=a,b] [--with-target=<t>] [--type=app|lib] [--graph=<path>]
 *
 *   # drop-in for `nx affected -t test-integration`:
 *   AFFECTED=$(node tools/affected-projects.mjs --base=origin/main --with-target=test-integration | paste -sd, -)
 *   [ -n "$AFFECTED" ] && pnpm nx run-many -t test-integration -p "$AFFECTED"
 *
 * Output: affected project names, newline-separated, sorted. Empty output ⇒
 * nothing affected (callers MUST guard run-many against an empty -p list).
 * Exit 0 on success (even when empty); 1 on error.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Workspace-global files: a change here legitimately affects EVERY project.
export const GLOBAL_FILES = [
  'tsconfig.base.json',
  'nx.json',
  'package.json',
  'pnpm-lock.yaml',
  'tools/affected-projects.mjs', // the resolver itself — conservative
];

/** graph -> Map(target -> Set(sources that depend on it)). */
export function reverseDependents(graph) {
  const dependents = new Map();
  for (const src of Object.keys(graph.dependencies || {})) {
    for (const edge of graph.dependencies[src]) {
      if (!dependents.has(edge.target)) dependents.set(edge.target, new Set());
      dependents.get(edge.target).add(edge.source);
    }
  }
  return dependents;
}

/** changed files -> Set(owning project names), via longest-prefix root match. */
export function mapFilesToProjects(graph, files, globals = GLOBAL_FILES) {
  const all = Object.keys(graph.nodes);
  const byRoot = all
    .map((name) => ({ name, root: graph.nodes[name].data.root }))
    .filter((e) => e.root && e.root !== '.')
    .sort((a, b) => b.root.length - a.root.length); // longest root first
  const touched = new Set();
  for (const file of files) {
    if (globals.includes(file)) return new Set(all); // global → everything
    const hit = byRoot.find((e) => file === e.root || file.startsWith(e.root + '/'));
    if (hit) touched.add(hit.name);
    // unmapped (docs/, .github/, random root files) → no project
  }
  return touched;
}

/** affected = touched ∪ reverse-reachability(touched), with optional filters. */
export function affectedProjects(graph, { files, withTarget, type, globals } = {}) {
  const touched = mapFilesToProjects(graph, files || [], globals);
  const dependents = reverseDependents(graph);
  const affected = new Set(touched);
  const stack = [...touched];
  while (stack.length) {
    const cur = stack.pop();
    for (const dep of dependents.get(cur) || []) {
      if (!affected.has(dep)) { affected.add(dep); stack.push(dep); }
    }
  }
  let out = [...affected];
  if (type) out = out.filter((n) => graph.nodes[n]?.type === type);
  if (withTarget) out = out.filter((n) => graph.nodes[n]?.data?.targets?.[withTarget] != null);
  return out.sort();
}
