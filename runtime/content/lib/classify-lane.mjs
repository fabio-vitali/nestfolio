// runtime/content/lib/classify-lane.mjs — deterministic lane classifier (doc-layer|simple|complex),
// the runtime analogue of backlog-next SKILL.md §3. Pure: (item, diffPaths) → lane. Graded by the
// next-lane-* parity twins; laneToTrigger feeds the worker's pre-ship batch (null = skip, doc-layer).
const DOC_ONLY = [/^docs\//, /^MEMORY\.md$/, /^[^/]+\.md$/, /^BACKLOG\.md$/];
const PUBLIC_INTERFACE = [/^libs\/event-types\//, /^libs\/cdk-constructs\//, /\/domain\//, /\.flow\.ya?ml$/];
const DEPLOYED_LIB = [/^libs\/(event-processor|cdk-constructs|agent-orchestrator|event-types)\//];
// runtime/tools/skill-.mjs are CODE (Simple lane per SKILL.md §3) even though nothing deploys from
// those trees — deploys stay service-bound via the deploy-gate check's own scope. SKILL.md prose stays doc-layer.
const CODE_OR_INFRA = [/^services\//, /^libs\//, /^apps\//, /^infrastructure\//, /^runtime\//, /^tools\//, /^\.claude\/skills\/.+\.mjs$/];

const serviceOf = (p) => (p.match(/^services\/[^/]+\/([^/]+)\//) || [])[1] ?? null;

export function classifyLane(item, diffPaths) {
  const paths = diffPaths ?? [];
  if (paths.length > 0 && paths.every((p) => DOC_ONLY.some((re) => re.test(p)))) return 'doc-layer';
  const services = new Set(paths.map(serviceOf).filter(Boolean));
  const complex =
    item?.requires_deploy === true ||
    paths.some((p) => PUBLIC_INTERFACE.some((re) => re.test(p))) ||
    paths.some((p) => DEPLOYED_LIB.some((re) => re.test(p))) ||
    paths.some((p) => /^infrastructure\//.test(p)) ||
    services.size > 1;
  if (complex) return 'complex';
  if (paths.some((p) => CODE_OR_INFRA.some((re) => re.test(p)))) return 'simple';
  return 'doc-layer';   // nothing recognizable to deploy
}

export function laneToTrigger(lane) {
  if (lane === 'doc-layer') return null;
  return { contexts: ['audit'], cost_ceiling: 'expensive', on: 'item-pre-ship' };
}
