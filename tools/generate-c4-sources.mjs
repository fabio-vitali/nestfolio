import { readdirSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const SERVICES_DIR = join(ROOT, 'services');
const ARCH_DIR = join(ROOT, 'docs', 'architecture');
const D2_SOURCE = join(ARCH_DIR, 'nestfolio.d2');
const C3_DIR = join(ARCH_DIR, 'c3');

/**
 * Scan services/{domain}/{service}/src/service.stack.ts
 * Returns array of { domain, service, stackPath }
 */
export function discoverServices() {
  const results = [];
  for (const domain of readdirSync(SERVICES_DIR, { withFileTypes: true })) {
    if (!domain.isDirectory()) continue;
    const domainDir = join(SERVICES_DIR, domain.name);
    for (const svc of readdirSync(domainDir, { withFileTypes: true })) {
      if (!svc.isDirectory()) continue;
      const stackPath = join(domainDir, svc.name, 'src', 'service.stack.ts');
      if (existsSync(stackPath)) {
        results.push({
          domain: domain.name,
          service: svc.name,
          stackPath,
        });
      }
    }
  }
  return results;
}

/**
 * Parse a service.stack.ts source string and extract construct usage.
 * Returns { constructs: { state[], ingress[], egress[], facade[], orchestration[], agentRuntime[], knowledgeBase[], agentMemory[] }, raw: { ... } }
 */
export function parseStack(src) {
  const result = {
    constructs: {
      state: [],
      ingress: [],
      egress: [],
      facade: [],
      orchestration: [],
      agentRuntime: [],
      knowledgeBase: [],
      agentMemory: [],
    },
    raw: {
      eventBuses: [],
      archives: [],
      rules: [],
      lambdas: [],
      buckets: [],
      userPools: [],
      distributions: [],
      schedules: [],
      resolvedBuses: [],
    },
  };

  // State: new State(this, 'Id') or new State(this, 'Id', { ... })
  for (const m of src.matchAll(
    /new\s+State\s*\(\s*this\s*,\s*['"](\w+)['"]\s*(?:,\s*(\{[^)]*\}))?\s*\)/gs,
  )) {
    const entry = { id: m[1], withBucket: false, withTable: true };
    const propsBlock = m[2] || '';
    if (/withBucket\s*:\s*true/.test(propsBlock)) entry.withBucket = true;
    if (/withTable\s*:\s*false/.test(propsBlock)) entry.withTable = false;
    result.constructs.state.push(entry);
  }

  // Ingress: new Ingress(this, 'Id', { eventTypes: [...], ... })
  for (const m of src.matchAll(/new\s+Ingress\s*\(\s*this\s*,\s*['"](\w+)['"]\s*,/g)) {
    const entry = { id: m[1], eventTypes: [] };
    const after = src.slice(m.index);
    const etMatch = after.match(/eventTypes\s*:\s*\[([\s\S]*?)\]/);
    if (etMatch) {
      // 1. Try string literals: ['EVT_A', 'EVT_B']
      entry.eventTypes = [...etMatch[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]);
      // 2. Try spread variables: [...VAR_NAME] (must check before enum refs since ... contains dots)
      if (entry.eventTypes.length === 0) {
        const spreads = [...etMatch[1].matchAll(/\.\.\.(\w+)/g)].map((x) => x[1]);
        if (spreads.length > 0) {
          for (const constName of spreads) {
            const constMatch = src.match(
              new RegExp(
                `(?:const|let|export\\s+const)\\s+${constName}\\s*(?::\\s*\\w+(?:\\[\\])?)?\\s*=\\s*\\[([\\s\\S]*?)\\]`,
              ),
            );
            if (constMatch) {
              const literals = [...constMatch[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]);
              if (literals.length > 0) entry.eventTypes.push(...literals);
              else
                entry.eventTypes.push(...[...constMatch[1].matchAll(/\.(\w+)/g)].map((x) => x[1]));
            }
          }
        }
      }
      // 3. Try enum references: EnumType.MEMBER
      if (entry.eventTypes.length === 0) {
        entry.eventTypes = [...etMatch[1].matchAll(/\w+\.(\w+)/g)].map((x) => x[1]);
      }
      // 4. Try single variable reference: eventTypes: VAR_NAME
      if (entry.eventTypes.length === 0) {
        const refMatch = after.match(/eventTypes\s*:\s*(\w+)\s*[,\n}]/);
        if (refMatch) {
          const constName = refMatch[1];
          const constMatch = src.match(
            new RegExp(`(?:const|let)\\s+${constName}\\s*=\\s*\\[([\\s\\S]*?)\\]`),
          );
          if (constMatch) {
            entry.eventTypes = [...constMatch[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]);
            if (entry.eventTypes.length === 0) {
              entry.eventTypes = [...constMatch[1].matchAll(/\.(\w+)/g)].map((x) => x[1]);
            }
          }
        }
      }
    }
    // Detect custom entry (handler file)
    const entryMatch = after.match(
      /entry\s*:\s*(?:join\s*\([^)]*['"]([^'"]+)['"]\s*\)|['"]([^'"]+)['"])/,
    );
    if (entryMatch) {
      entry.handlerFile = entryMatch[1] || entryMatch[2];
    }
    result.constructs.ingress.push(entry);
  }

  // Egress: new Egress(this, 'Id', { state, publishableTypes: [...] })
  for (const m of src.matchAll(/new\s+Egress\s*\(\s*this\s*,\s*['"](\w+)['"]\s*,/g)) {
    const entry = { id: m[1], publishableTypes: [] };
    const after = src.slice(m.index);
    const ptMatch = after.match(/publishableTypes\s*:\s*\[([\s\S]*?)\]/);
    if (ptMatch) {
      entry.publishableTypes = [...ptMatch[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]);
    }
    result.constructs.egress.push(entry);
  }

  // Facade: new Facade(this, 'Id', { ... })
  for (const m of src.matchAll(/new\s+Facade\s*\(\s*this\s*,\s*['"](\w+)['"]/g)) {
    const entry = { id: m[1], hasJsResolvers: false, hasLambdaResolvers: false };
    const after = src.slice(m.index, m.index + 500);
    if (/jsResolvers\s*:/.test(after)) entry.hasJsResolvers = true;
    if (/lambdaResolvers\s*:/.test(after)) entry.hasLambdaResolvers = true;
    result.constructs.facade.push(entry);
  }

  // Orchestration: new Orchestration(this, 'Id', { triggers: [...] })
  for (const m of src.matchAll(/new\s+Orchestration\s*\(\s*this\s*,\s*['"](\w+)['"]\s*,/g)) {
    const entry = { id: m[1], triggers: [] };
    const after = src.slice(m.index);
    const trMatch = after.match(/triggers\s*:\s*\[([\s\S]*?)\]/);
    if (trMatch) {
      entry.triggers = [...trMatch[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]);
      if (entry.triggers.length === 0) {
        entry.triggers = [...trMatch[1].matchAll(/\.(\w+)/g)].map((x) => x[1]);
      }
    }
    result.constructs.orchestration.push(entry);
  }

  // AgentRuntime
  for (const m of src.matchAll(/new\s+AgentRuntime\s*\(\s*this\s*,\s*['"](\w+)['"]/g)) {
    const entry = { id: m[1], hasToolTargets: false };
    const after = src.slice(m.index, m.index + 800);
    if (/toolTargets\s*:/.test(after)) entry.hasToolTargets = true;
    result.constructs.agentRuntime.push(entry);
  }

  // KnowledgeBase
  for (const m of src.matchAll(/new\s+KnowledgeBase\s*\(\s*this\s*,\s*['"](\w+)['"]/g)) {
    result.constructs.knowledgeBase.push({ id: m[1] });
  }

  // AgentCore Memory (agentcore.Memory)
  for (const m of src.matchAll(/new\s+agentcore\.Memory\s*\(\s*this\s*,\s*['"](\w+)['"]/g)) {
    result.constructs.agentMemory.push({ id: m[1] });
  }

  // --- Raw CDK resources (for hubs, adapters, web) ---

  // EventBus creation
  for (const m of src.matchAll(/new\s+EventBus\s*\(\s*this\s*,\s*['"](\w+)['"]/g)) {
    result.raw.eventBuses.push({ id: m[1] });
  }

  // Archive
  for (const m of src.matchAll(/new\s+Archive\s*\(\s*this\s*,\s*['"](\w+)['"]/g)) {
    result.raw.archives.push({ id: m[1] });
  }

  // Cross-domain rules (Rule with EventBusTarget)
  for (const m of src.matchAll(/new\s+Rule\s*\(\s*this\s*,\s*['"]([^'"]+)['"]\s*,/g)) {
    const after = src.slice(m.index, m.index + 1200);
    const isCrossDomain = /EventBusTarget/.test(after);
    const eventTypes = [];
    const dtMatch = after.match(/detailType\s*:\s*\[([\s\S]*?)\]/);
    if (dtMatch) {
      eventTypes.push(...[...dtMatch[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]));
      if (eventTypes.length === 0) {
        eventTypes.push(...[...dtMatch[1].matchAll(/\.(\w+)/g)].map((x) => x[1]));
      }
    }
    const targetMatch = after.match(/new\s+EventBusTarget\s*\(\s*(\w+)/);
    // Pull model: eventBus property references the foreign (source) bus
    const sourceBusMatch = after.match(/eventBus\s*:\s*(\w+)/);
    result.raw.rules.push({
      id: m[1],
      isCrossDomain,
      eventTypes,
      targetBusVar: targetMatch?.[1] || null,
      sourceBusVar: sourceBusMatch?.[1] || null,
    });
  }

  // resolveBusArn calls — extract domain name (4th string argument is the domain)
  for (const m of src.matchAll(/resolveBusArn\s*\([\s\S]*?['"](\w+)['"]\s*,\s*\w+\s*,?\s*\)/gs)) {
    result.raw.resolvedBuses.push(m[1]);
  }

  // UserPool
  for (const m of src.matchAll(/new\s+UserPool\s*\(\s*this\s*,\s*['"](\w+)['"]/g)) {
    result.raw.userPools.push({ id: m[1] });
  }

  // Distribution (CloudFront)
  for (const m of src.matchAll(/new\s+Distribution\s*\(\s*this\s*,\s*['"](\w+)['"]/g)) {
    result.raw.distributions.push({ id: m[1] });
  }

  // Standalone NodejsFunction
  for (const m of src.matchAll(
    /(?:const|let)\s+(\w+)\s*=\s*new\s+NodejsFunction\s*\(\s*this\s*,\s*['"](\w+)['"]/g,
  )) {
    result.raw.lambdas.push({ id: m[2], varName: m[1] });
  }

  // Bucket (standalone, outside State)
  for (const m of src.matchAll(
    /(?:const|let)\s+\w+\s*=\s*new\s+Bucket\s*\(\s*this\s*,\s*['"](\w+)['"]/g,
  )) {
    result.raw.buckets.push({ id: m[1] });
  }

  // AdapterSchedule
  for (const m of src.matchAll(/new\s+AdapterSchedule\s*\(\s*this\s*,\s*['"](\w+)['"]/g)) {
    result.raw.schedules.push({ id: m[1] });
  }

  return result;
}

// --- C3 D2 Generator ---

const COLORS = {
  facade: { fill: '#F3E5F5', stroke: '#9C27B0' },
  ingress: { fill: '#FFF8E1', stroke: '#FFC107' },
  state: { fill: '#E3F2FD', stroke: '#2196F3' },
  egress: { fill: '#FBE9E7', stroke: '#FF5722' },
  orchestration: { fill: '#E8F5E9', stroke: '#4CAF50' },
  agentRuntime: { fill: '#E8F5E9', stroke: '#4CAF50' },
  knowledgeBase: { fill: '#FFF3E0', stroke: '#FF9800' },
  agentMemory: { fill: '#E0F2F1', stroke: '#00695C' },
};

function groupStyle(type) {
  const c = COLORS[type];
  return `  style: { fill: "${c.fill}"; stroke: "${c.stroke}"; border-radius: 12; font-size: 28 }`;
}

function toD2Id(id) {
  return id.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
}

const SUFFIX_EXPANSIONS = {
  ctrl: 'Controller',
  bff: 'BFF',
  hub: 'Hub',
  adpt: 'Adapter',
};

export function serviceLabel(serviceName) {
  const parts = serviceName.split('-');
  const last = parts[parts.length - 1];
  if (SUFFIX_EXPANSIONS[last]) {
    parts[parts.length - 1] = SUFFIX_EXPANSIONS[last];
  } else {
    parts[parts.length - 1] = last.charAt(0).toUpperCase() + last.slice(1);
  }
  for (let i = 0; i < parts.length - 1; i++) {
    parts[i] = parts[i].charAt(0).toUpperCase() + parts[i].slice(1);
  }
  return parts.join(' ');
}

/**
 * Build a subtitle from the constructs a service uses.
 * Returns tags joined with ' · ', or 'Event-Driven Service' as fallback.
 */
export function serviceSubtitle(parsed) {
  const tags = [];
  const c = parsed.constructs;
  const r = parsed.raw;

  // Facade
  if (c.facade.length > 0) tags.push('GraphQL API');

  // Orchestration
  if (c.orchestration.length > 0) tags.push('State Machine');

  // AgentRuntime
  if (c.agentRuntime.length > 0) tags.push('AI Agent');

  // KnowledgeBase
  if (c.knowledgeBase.length > 0) tags.push('RAG');

  // AgentMemory
  if (c.agentMemory.length > 0) tags.push('Agent Memory');

  // Cross-domain bridge
  if (r.rules.some((rule) => rule.isCrossDomain)) tags.push('Cross-Domain Bridge');

  // State with bucket (notable — DynamoDB alone is too common to tag)
  if (c.state.some((s) => s.withBucket)) tags.push('S3 Storage');

  return tags.length > 0 ? tags.join(' · ') : 'Event-Driven Service';
}

/**
 * Read domain descriptions from services/{domain}/README.md files.
 * Returns a Map of domain → description string (trimmed, single line).
 */
export function readDomainDescriptions(servicesDir) {
  const descriptions = new Map();
  for (const entry of readdirSync(servicesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const readmePath = join(servicesDir, entry.name, 'README.md');
    if (existsSync(readmePath)) {
      descriptions.set(entry.name, readFileSync(readmePath, 'utf-8').trim());
    }
  }
  return descriptions;
}

/**
 * Read service descriptions from services/{domain}/{service}/README.md files.
 * Returns a Map of serviceName → description string.
 */
export function readServiceDescriptions(servicesDir) {
  const descriptions = new Map();
  for (const domain of readdirSync(servicesDir, { withFileTypes: true })) {
    if (!domain.isDirectory()) continue;
    const domainDir = join(servicesDir, domain.name);
    for (const svc of readdirSync(domainDir, { withFileTypes: true })) {
      if (!svc.isDirectory()) continue;
      const readmePath = join(domainDir, svc.name, 'README.md');
      if (existsSync(readmePath)) {
        descriptions.set(svc.name, readFileSync(readmePath, 'utf-8').trim());
      }
    }
  }
  return descriptions;
}

/**
 * Build a map of events routed INTO each domain from external cross-domain adapters.
 * Supports both push model (target = foreign bus) and pull model (source = foreign bus, target = own bus).
 * Returns Map<targetDomain, [{from: sourceDomain, events: string[]}]>
 */
export function buildInboundEventMap(allServices, parsedStacks) {
  const inbound = new Map();
  for (const svc of allServices) {
    if (!svc.service.endsWith('-adpt')) continue;
    const parsed = parsedStacks.get(svc.service);
    if (!parsed) continue;
    for (const rule of parsed.raw.rules) {
      if (!rule.isCrossDomain || !rule.targetBusVar) continue;
      const target = rule.targetBusVar.replace(/Bus$/, '').toLowerCase();
      // Pull model: sourceBusVar is the foreign bus (where events come from)
      // Push model: the adapter's own domain is the source
      const from = rule.sourceBusVar
        ? rule.sourceBusVar.replace(/Bus$/, '').toLowerCase()
        : svc.domain;
      if (from === target) continue; // skip if source equals target
      if (!inbound.has(target)) inbound.set(target, []);
      inbound.get(target).push({ from, events: [...rule.eventTypes] });
    }
  }
  return inbound;
}

function toScreamingSnake(s) {
  return s.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase();
}

/**
 * Fuzzy-match intra-domain producer→consumer event flows.
 * Converts Egress publishableTypes to SCREAMING_SNAKE prefixes and matches against Ingress eventTypes.
 * Returns [{from, to, events}]
 */
export function matchIntraDomainFlows(domainServices, parsedStacks) {
  const producers = [];
  const consumers = [];
  for (const svc of domainServices) {
    const p = parsedStacks.get(svc.service);
    if (!p) continue;
    if (p.raw.eventBuses.length > 0 || p.raw.rules.some(r => r.isCrossDomain)) continue;
    const pubTypes = p.constructs.egress.flatMap(e => e.publishableTypes);
    if (pubTypes.length) {
      producers.push({ service: svc.service, prefixes: pubTypes.map(toScreamingSnake) });
    }
    const subTypes = p.constructs.ingress.flatMap(i => i.eventTypes);
    if (subTypes.length) {
      consumers.push({ service: svc.service, events: subTypes });
    }
  }
  const flows = [];
  for (const prod of producers) {
    for (const cons of consumers) {
      if (prod.service === cons.service) continue;
      const matched = cons.events.filter(et => prod.prefixes.some(p => et.startsWith(p)));
      if (matched.length) {
        flows.push({ from: prod.service, to: cons.service, events: matched });
      }
    }
  }
  return flows;
}

/**
 * Detect external systems from adapter service names.
 * Convention: {role}-{external}-adpt where the last segment before -adpt
 * identifies the external system if it isn't a known domain name.
 * Cross-domain adapters like execution-adpt (where the only segment is a domain) are skipped.
 * Domains are derived from the services list itself — no hardcoded list.
 * Returns [{ name: 'Alpaca', service: 'broker-alpaca-adpt' }, ...]
 */
export function detectExternalSystems(services) {
  const knownDomains = new Set(services.map((s) => s.domain));
  const externals = [];
  for (const svc of services) {
    if (!svc.service.endsWith('-adpt')) continue;
    const parts = svc.service.replace(/-adpt$/, '').split('-');
    const lastPart = parts[parts.length - 1];
    if (!knownDomains.has(lastPart)) {
      const name = lastPart.charAt(0).toUpperCase() + lastPart.slice(1);
      externals.push({ name, service: svc.service });
    }
  }
  return externals;
}

function stateBlock(st) {
  const lines = ['state: "State" {', groupStyle('state')];
  if (st.withTable !== false) {
    lines.push('  table: "DynamoDB Table" { class: aws-dynamodb }');
    lines.push('  stream: "DynamoDB Stream\\n[CDC]" { class: aws-ddb-stream }');
    lines.push('  table -> stream: CDC');
  }
  if (st.withBucket) {
    lines.push('  bucket: "S3 Bucket" { class: aws-s3 }');
  }
  lines.push('}', '');
  return lines;
}

function ingressBlock(blockId, ing) {
  const evtLabel = ing.eventTypes.length > 0 ? `\\n[${ing.eventTypes.length} events]` : '';
  return [
    `${blockId}: "${ing.id}" {`,
    groupStyle('ingress'),
    `  rule: "EventBridge Rule${evtLabel}" { class: aws-eventbridge }`,
    '  sqs: "SQS Queue" { class: aws-sqs }',
    '  dlq: "DLQ" { class: aws-dlq }',
    '  handler: "Lambda" { class: aws-lambda }',
    '',
    '  rule -> sqs: Subscribe',
    '  sqs -> handler: Invoke',
    '  sqs -> dlq: On failure',
    '}',
    '',
  ];
}

function egressBlock(eg, domain) {
  return [
    'egress: "Egress" {',
    groupStyle('egress'),
    '  processor: "Lambda" { class: aws-lambda }',
    `  bus: "EventBridge\\n[${domain}-bus]" { class: aws-eventbridge }`,
    '  dlq: "DLQ" { class: aws-dlq }',
    '',
    '  processor -> bus: Publish',
    '}',
    '',
  ];
}

function facadeBlock(f) {
  const lines = [
    'facade: "Facade" {',
    groupStyle('facade'),
    '  appsync: "AppSync API" { class: aws-appsync }',
  ];
  if (f.hasJsResolvers) {
    lines.push('  resolvers: "JS Resolvers" { class: aws-lambda }');
    lines.push('  appsync -> resolvers: JS Resolve');
  }
  lines.push('  ssm: "SSM Parameters" { class: aws-ssm }');
  lines.push('}', '');
  return lines;
}

function orchestrationBlock(blockId, orch) {
  return [
    `${blockId}: "Orchestration" {`,
    groupStyle('orchestration'),
    `  state-machine: "Step Functions\\n[${orch.id}]" { class: aws-stepfunctions }`,
    '  dlq: "DLQ" { class: aws-dlq }',
    '}',
    '',
  ];
}

function agentRuntimeBlock(ar) {
  const lines = [
    'agent-runtime: "AgentRuntime" {',
    groupStyle('agentRuntime'),
    '  runtime: "Bedrock AgentCore" { class: aws-bedrock }',
  ];
  if (ar.hasToolTargets) {
    lines.push('  gateway: "MCP Gateway" { class: aws-lambda }');
    lines.push('  runtime -> gateway');
  }
  lines.push('}', '');
  return lines;
}

function knowledgeBaseBlock(kb) {
  return [
    'knowledge-base: "KnowledgeBase" {',
    groupStyle('knowledgeBase'),
    '  kb: "Bedrock Knowledge Base" { class: aws-bedrock }',
    '  s3: "S3 Bucket" { class: aws-s3 }',
    '  s3 -> kb',
    '}',
    '',
  ];
}

function agentMemoryBlock(mem) {
  return [
    'agent-memory: "AgentCore Memory" {',
    groupStyle('agentMemory'),
    '  memory: "Bedrock AgentCore\\n[Memory]" { class: aws-bedrock }',
    '}',
    '',
  ];
}

function generateC3Flows(c, r, domain) {
  const flows = [];
  const hasState = c.state.length > 0 && c.state[0].withTable !== false;

  // Facade → State
  if (c.facade.length > 0 && hasState) {
    const f = c.facade[0];
    const facadeNode =
      f.hasJsResolvers || f.hasLambdaResolvers ? 'facade.resolvers' : 'facade.appsync';
    flows.push(`${facadeNode} -> state.table: Read/Write`);
  }

  // Ingress → State
  for (const ing of c.ingress) {
    const blockId = c.ingress.length === 1 ? 'ingress' : toD2Id(ing.id);
    if (hasState) {
      flows.push(`${blockId}.handler -> state.table: Read/Write`);
    }
  }

  // State.stream → Egress
  if (hasState && c.egress.length > 0) {
    flows.push('state.stream -> egress.processor: Trigger');
  }

  // Ingress → Orchestration
  for (const orch of c.orchestration) {
    const orchId = toD2Id(orch.id);
    if (c.ingress.length > 0) {
      const ingId = c.ingress.length === 1 ? 'ingress' : toD2Id(c.ingress[0].id);
      flows.push(`${ingId}.handler -> ${orchId}.state-machine: Execute`);
    }
    if (hasState) {
      flows.push(`${orchId}.state-machine -> state.table: Read/Write`);
    }
  }

  // AgentMemory → Orchestration
  if (c.agentMemory.length > 0 && c.orchestration.length > 0) {
    const orchId = toD2Id(c.orchestration[0].id);
    flows.push(`${orchId}.state-machine -> agent-memory.memory: Store`);
  }

  // AgentRuntime flows
  if (c.agentRuntime.length > 0) {
    if (c.facade.length > 0) {
      flows.push('facade.appsync -> agent-runtime.runtime: Invoke');
    }
    if (c.knowledgeBase.length > 0) {
      flows.push('agent-runtime.runtime -> knowledge-base.kb: RAG Query');
    }
    if (hasState) {
      flows.push('agent-runtime.runtime -> state.table: Read/Write');
    }
  }

  return flows;
}

/**
 * Generate C3 D2 content for a single service.
 * @param {string} service - Service name
 * @param {string} domain - Domain name
 * @param {object} parsed - Output of parseStack()
 * @returns {string} D2 source
 */
export function generateC3(service, domain, parsed) {
  const lines = [];
  const c = parsed.constructs;
  const r = parsed.raw;

  // Direction
  const isAdapter = r.rules.some((rule) => rule.isCrossDomain);
  lines.push(`direction: ${isAdapter ? 'right' : 'down'}`);
  lines.push('');

  // Title
  const label = serviceLabel(service);
  const subtitle = serviceSubtitle(parsed);
  lines.push(`title: "${label}\\n[${subtitle}]" {`);
  lines.push('  style: { font-size: 40; bold: true; fill: transparent; stroke: transparent }');
  lines.push('}');
  lines.push('');

  // Facade
  for (const f of c.facade) {
    lines.push(...facadeBlock(f));
  }

  // Ingress(es)
  for (const ing of c.ingress) {
    const blockId = c.ingress.length === 1 ? 'ingress' : toD2Id(ing.id);
    lines.push(...ingressBlock(blockId, ing));
  }

  // State
  for (const st of c.state) {
    lines.push(...stateBlock(st));
  }

  // Egress
  for (const eg of c.egress) {
    lines.push(...egressBlock(eg, domain));
  }

  // Orchestration (always use id-derived blockId — names are meaningful)
  for (const orch of c.orchestration) {
    const blockId = toD2Id(orch.id);
    lines.push(...orchestrationBlock(blockId, orch));
  }

  // AgentRuntime
  for (const ar of c.agentRuntime) {
    lines.push(...agentRuntimeBlock(ar));
  }

  // KnowledgeBase
  for (const kb of c.knowledgeBase) {
    lines.push(...knowledgeBaseBlock(kb));
  }

  // AgentCore Memory
  for (const mem of c.agentMemory) {
    lines.push(...agentMemoryBlock(mem));
  }

  // --- Raw resources (no wrapper box) ---

  // Hub pattern: EventBus + Archive
  if (r.eventBuses.length > 0) {
    for (const bus of r.eventBuses) {
      const busId = toD2Id(bus.id);
      lines.push(`${busId}: "EventBridge\\n[${domain}-bus]" { class: aws-eventbridge }`);
    }
    for (const arch of r.archives) {
      lines.push(`archive: "Event Archive\\n[365 days]" { class: aws-s3 }`);
    }
    if (r.eventBuses.length > 0 && r.archives.length > 0) {
      const busId = toD2Id(r.eventBuses[0].id);
      lines.push(`${busId} -> archive`);
    }
    lines.push('');
  }

  // Cross-domain adapter pattern (pull model: source = foreign bus, target = own bus)
  const crossDomainRules = r.rules.filter((rule) => rule.isCrossDomain);
  if (crossDomainRules.length > 0) {
    lines.push(`target: "${domain}-bus\\n[Target]" { class: aws-eventbridge }`);
    lines.push('');
    for (const rule of crossDomainRules) {
      const ruleId = toD2Id(rule.id);
      const sourceDomain = rule.sourceBusVar?.replace(/Bus$/, '') || 'source';
      lines.push(`${ruleId}: "${sourceDomain}-bus\\n[Source]" { class: aws-eventbridge }`);
      lines.push(`${ruleId}-dlq: "DLQ" { class: aws-dlq }`);
      lines.push(`${ruleId} -> target`);
      lines.push('');
    }
  }

  // Web frontend pattern
  if (r.userPools.length > 0) {
    lines.push('cognito: "Cognito UserPool" { class: aws-cognito }');
  }
  if (r.distributions.length > 0) {
    lines.push('cdn: "CloudFront" { class: aws-cloudfront }');
  }
  if (r.buckets.length > 0 && c.state.length === 0) {
    lines.push('assets: "S3 Bucket" { class: aws-s3 }');
  }
  for (const fn of r.lambdas) {
    lines.push(`${toD2Id(fn.id)}: "Lambda\\n[${fn.id}]" { class: aws-lambda }`);
  }
  if (r.userPools.length > 0 || r.distributions.length > 0 || r.lambdas.length > 0) {
    lines.push('');
    if (r.distributions.length > 0 && r.buckets.length > 0) {
      lines.push('cdn -> assets');
    }
    if (r.userPools.length > 0 && r.lambdas.length > 0) {
      for (const fn of r.lambdas) {
        lines.push(`cognito -> ${toD2Id(fn.id)}`);
      }
    }
  }

  // Data adapter: schedule
  if (r.schedules.length > 0) {
    lines.push('schedule: "EventBridge Scheduler" { class: aws-eventbridge }');
    if (r.lambdas.length > 0) {
      lines.push(`schedule -> ${toD2Id(r.lambdas[0].id)}`);
    }
    lines.push('');
  }

  // --- Flows ---
  lines.push('# Flows');
  lines.push(...generateC3Flows(c, r, domain));

  return lines.join('\n');
}

// --- Cross-domain flow extraction ---

/**
 * Extract cross-domain event flows from adapter service stacks.
 * Supports both push model (target = foreign bus) and pull model (source = foreign bus, target = own bus).
 * Returns an array of { from, to, events[] } objects.
 */
export function extractCrossDomainFlows(services, parsedStacks) {
  const flowMap = new Map(); // "from→to" → events[]
  for (const svc of services) {
    if (!svc.service.endsWith('-adpt')) continue;
    const parsed = parsedStacks.get(svc.service);
    if (!parsed) continue;
    for (const rule of parsed.raw.rules) {
      if (!rule.isCrossDomain || !rule.targetBusVar) continue;
      const targetDomain = rule.targetBusVar.replace(/Bus$/, '').toLowerCase();
      // Pull model: sourceBusVar is the foreign bus, targetBusVar is the adapter's own bus
      // Push model: sourceBusVar is the adapter's own bus, targetBusVar is the foreign bus
      const sourceDomain = rule.sourceBusVar
        ? rule.sourceBusVar.replace(/Bus$/, '').toLowerCase()
        : svc.domain;
      const key = `${sourceDomain}→${targetDomain}`;
      if (!flowMap.has(key)) flowMap.set(key, []);
      flowMap.get(key).push(...rule.eventTypes);
    }
  }
  const flows = [];
  for (const [key, events] of flowMap) {
    const [from, to] = key.split('→');
    if (from === to) continue; // skip self-referencing (shouldn't happen but safety)
    flows.push({ from, to, events: [...new Set(events)] });
  }
  return flows;
}

// --- Frontend detection ---

/**
 * Detect frontend services from parsed stacks.
 * Returns [{ service, domain, label }] for services with CloudFront distributions or *-web suffix.
 */
export function detectFrontends(services, parsedStacks) {
  const frontends = [];
  for (const svc of services) {
    const parsed = parsedStacks.get(svc.service);
    if (!parsed) continue;
    const isFrontend = parsed.raw.distributions.length > 0 || svc.service.endsWith('-web');
    if (isFrontend) {
      frontends.push({
        service: svc.service,
        domain: svc.domain,
        label: serviceLabel(svc.service),
      });
    }
  }
  return frontends;
}

/**
 * Read system name and description from root package.json.
 * Returns { name, description }.
 */
export function readSystemMeta(rootDir) {
  const pkgPath = join(rootDir, 'package.json');
  if (!existsSync(pkgPath)) return { name: 'System', description: '' };
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  // Derive display name: prefer scope name (@nestfolio/source → Nestfolio)
  const scopeMatch = (pkg.name || '').match(/^@([^/]+)\//);
  const raw = scopeMatch ? scopeMatch[1] : (pkg.name || 'system').replace(/^@[^/]+\//, '');
  const name = raw.charAt(0).toUpperCase() + raw.slice(1);
  return { name, description: pkg.description || '' };
}

// --- C1 D2 Generator ---

/**
 * Generate C1 D2 content — system context with domains and inter-domain flows.
 * @param {object} opts
 * @param {string[]} opts.domains - List of domain names
 * @param {Map<string, string>} [opts.domainDescriptions] - Map of domain → README description
 * @param {Array<{from, to, events}>} [opts.crossDomainFlows] - Cross-domain event flows
 * @param {Array<{service, domain, label}>} [opts.frontends] - Frontend services
 * @param {{ name, description }} [opts.systemMeta] - System name and description
 * @returns {string} D2 source
 */
export function generateC1({
  domains,
  domainDescriptions,
  crossDomainFlows,
  frontends,
  systemMeta,
}) {
  const lines = [];
  const sysName = systemMeta?.name || 'System';
  lines.push('# System Boundary');
  lines.push(`${sysName.toLowerCase()}: "" {`);
  lines.push('  style: { fill: "#FFFFFF"; stroke: "#FFFFFF" }');
  lines.push('');

  for (const d of domains) {
    const title = d.charAt(0).toUpperCase() + d.slice(1);
    lines.push(`  ${d}-domain: "${title} Domain" {`);
    lines.push('    class: domain');
    lines.push(`    link: layers.c2-${d}`);
    const desc = domainDescriptions?.get(d);
    if (desc) {
      lines.push(`    tooltip: "${desc.replace(/"/g, '\\"')}"`);
    }
    lines.push('  }');
  }

  // Cross-domain flow pills
  if (crossDomainFlows?.length) {
    lines.push('');
    for (const flow of crossDomainFlows) {
      const eventList = flow.events.join('\\n');
      const nodeId = `${flow.from}-to-${flow.to}`;
      lines.push(`  ${nodeId}: "${flow.events.length} Events" {`);
      lines.push('    class: flow-label');
      lines.push(`    tooltip: "${eventList}"`);
      lines.push('  }');
      lines.push(
        `  ${flow.from}-domain -> ${nodeId} {style.stroke: "#999999"; style.stroke-width: 3; style.stroke-dash: 3}`,
      );
      lines.push(
        `  ${nodeId} -> ${flow.to}-domain {style.stroke: "#999999"; style.stroke-width: 3; style.stroke-dash: 3}`,
      );
    }
  }
  lines.push('}');

  // Actor for each domain that has a frontend
  const sys = sysName.toLowerCase();
  if (frontends?.length) {
    const domainsWithFrontend = [...new Set(frontends.map((fe) => fe.domain))];
    for (const d of domainsWithFrontend) {
      const title = d.charAt(0).toUpperCase() + d.slice(1);
      lines.push('');
      lines.push(`${d}-user: "${title} User" {class: person}`);
      lines.push(`${sys}.${d}-domain <-> ${d}-user {style.stroke-width: 3}`);
    }
  }

  return lines.join('\n');
}

// --- Global Styles ---

/**
 * Generate global D2 styles for all C4 levels (C1/C2 classes + C3 AWS resource classes).
 * @returns {string} D2 source
 */
export function generateGlobalStyles() {
  return `# Nestfolio C4 Architecture — Interactive Layers
# Generated by tools/generate-c4-sources.mjs — DO NOT EDIT
# Navigation: C1 → click domain → C2 → click service → C3 (AWS resources)

direction: down

style: {
  font-size: 34
  stroke-width: 2
}

classes: {
  person: {
    shape: person
    width: 100
    height: 120
    style: {
      fill: "#08427B"
      stroke: "#052E56"
      font-color: "#ffffff"
      font-size: 30
      stroke-width: 2
    }
  }
  system: {
    shape: rectangle
    style: {
      fill: "#D6E4F0"
      stroke: "#1168BD"
      font-color: "#0B4884"
      font-size: 30
      border-radius: 12
      stroke-width: 2
      shadow: true
    }
  }
  external: {
    shape: rectangle
    style: {
      fill: "#8B8B8B"
      stroke: "#666666"
      font-color: "#ffffff"
      font-size: 26
      border-radius: 10
      stroke-width: 1
      stroke-dash: 5
    }
  }
  flow-label: {
    shape: rectangle
    style: {
      fill: "#F5F5F5"
      stroke: "#999999"
      font-color: "#666666"
      font-size: 30
      border-radius: 20
      stroke-width: 1
    }
  }
  domain: {
    shape: rectangle
    style: {
      fill: "#438DD5"
      stroke: "#2E6295"
      font-color: "#ffffff"
      font-size: 44
      bold: true
      border-radius: 14
      stroke-width: 3
      shadow: true
    }
  }
  service: {
    shape: rectangle
    style: {
      fill: "#85BBF0"
      stroke: "#4A90D9"
      font-color: "#1A1A1A"
      font-size: 26
      border-radius: 10
      stroke-width: 2
    }
  }
  adapter: {
    shape: hexagon
    style: {
      fill: "#FFB74D"
      stroke: "#E09530"
      font-color: "#1A1A1A"
      font-size: 26
      stroke-width: 2
    }
  }
  frontend: {
    shape: rectangle
    style: {
      fill: "#81C784"
      stroke: "#4CAF50"
      font-color: "#ffffff"
      font-size: 26
      border-radius: 12
      stroke-width: 2
    }
  }
  bus: {
    shape: queue
    style: {
      fill: "#FF7043"
      stroke: "#D84315"
      font-color: "#ffffff"
      font-size: 24
      stroke-width: 2
    }
  }

  # --- AWS Resource Classes (C3) ---
  aws-lambda: {
    shape: rectangle
    icon: ./icons/lambda.svg
    style: { fill: "#FFF3E0"; stroke: "#FF9800"; font-size: 24; border-radius: 8; stroke-width: 2 }
  }
  aws-dynamodb: {
    shape: rectangle
    icon: ./icons/dynamodb.svg
    style: { fill: "#E3F2FD"; stroke: "#1565C0"; font-size: 24; border-radius: 8; stroke-width: 2 }
  }
  aws-sqs: {
    shape: rectangle
    icon: ./icons/sqs.svg
    style: { fill: "#FFF3E0"; stroke: "#E65100"; font-size: 24; border-radius: 8; stroke-width: 2 }
  }
  aws-eventbridge: {
    shape: rectangle
    icon: ./icons/eventbridge.svg
    style: { fill: "#FCE4EC"; stroke: "#C62828"; font-size: 24; border-radius: 8; stroke-width: 2 }
  }
  aws-appsync: {
    shape: rectangle
    icon: ./icons/appsync.svg
    style: { fill: "#F3E5F5"; stroke: "#7B1FA2"; font-size: 24; border-radius: 8; stroke-width: 2 }
  }
  aws-stepfunctions: {
    shape: rectangle
    icon: ./icons/stepfunctions.svg
    style: { fill: "#FCE4EC"; stroke: "#AD1457"; font-size: 24; border-radius: 8; stroke-width: 2 }
  }
  aws-s3: {
    shape: rectangle
    icon: ./icons/s3.svg
    style: { fill: "#E8F5E9"; stroke: "#2E7D32"; font-size: 24; border-radius: 8; stroke-width: 2 }
  }
  aws-ssm: {
    shape: rectangle
    icon: ./icons/ssm.svg
    style: { fill: "#E3F2FD"; stroke: "#1565C0"; font-size: 24; border-radius: 8; stroke-width: 2 }
  }
  aws-cloudwatch: {
    shape: rectangle
    icon: ./icons/cloudwatch.svg
    style: { fill: "#FCE4EC"; stroke: "#C62828"; font-size: 24; border-radius: 8; stroke-width: 2 }
  }
  aws-bedrock: {
    shape: rectangle
    icon: ./icons/bedrock.svg
    style: { fill: "#E0F2F1"; stroke: "#00695C"; font-size: 24; border-radius: 8; stroke-width: 2 }
  }
  aws-cognito: {
    shape: rectangle
    icon: ./icons/cognito.svg
    style: { fill: "#FBE9E7"; stroke: "#BF360C"; font-size: 24; border-radius: 8; stroke-width: 2 }
  }
  aws-ddb-stream: {
    shape: parallelogram
    style: { fill: "#E3F2FD"; stroke: "#1565C0"; font-size: 24; stroke-width: 2 }
  }
  aws-dlq: {
    shape: rectangle
    icon: ./icons/sqs.svg
    style: { fill: "#FFCDD2"; stroke: "#B71C1C"; font-size: 22; border-radius: 8; stroke-width: 2; stroke-dash: 4 }
  }
  aws-cloudfront: {
    shape: rectangle
    icon: ./icons/cloudfront.svg
    style: { fill: "#F3E5F5"; stroke: "#7B1FA2"; font-size: 24; border-radius: 8; stroke-width: 2 }
  }
}`;
}

/**
 * Generate C2 D2 layer for a domain.
 * @param {string} domain - Domain name
 * @param {Array} services - Services in this domain
 * @param {Map} parsedStacks - Map of serviceName → parsed stack
 * @returns {string} D2 layer content
 */
// Inline styles for C2 layers (D2 root classes don't cascade into layers)
const C2_STYLES = {
  system: 'fill: "#D6E4F0"; stroke: "#1168BD"; font-color: "#0B4884"; font-size: 30; border-radius: 12; stroke-width: 2; shadow: true',
  domain: 'fill: "#438DD5"; stroke: "#2E6295"; font-color: "#ffffff"; font-size: 34; bold: true; border-radius: 14; stroke-width: 3; shadow: true',
  external: 'fill: "#8B8B8B"; stroke: "#666666"; font-color: "#ffffff"; font-size: 26; border-radius: 10; stroke-width: 1; stroke-dash: 5',
  flowLabel: 'fill: "#F5F5F5"; stroke: "#999999"; font-color: "#666666"; font-size: 22; border-radius: 20; stroke-width: 1',
};
const EDGE_STYLE = 'style.stroke: "#999999"; style.stroke-width: 3; style.stroke-dash: 3';

export function generateC2(domain, services, parsedStacks, { serviceDescriptions, inboundEventMap }) {
  const lines = [];
  const title = domain.charAt(0).toUpperCase() + domain.slice(1);

  lines.push(`  c2-${domain}: {`);
  lines.push(`    style: { fill: "#FFFFFF"; stroke: "#FFFFFF" }`);
  lines.push('');

  // Classify services — skip hubs entirely
  const crossDomainAdapters = [];
  const dataAdapters = [];
  const frontends = [];
  const regular = [];

  for (const svc of services) {
    const parsed = parsedStacks.get(svc.service);
    if (!parsed) continue;
    if (parsed.raw.eventBuses.length > 0) continue; // skip hubs
    const isCrossDomain = parsed.raw.rules.some(r => r.isCrossDomain);
    const isDataAdapter = parsed.raw.schedules.length > 0 ||
      (svc.service.endsWith('-adpt') && parsed.constructs.state.length > 0);
    const isFrontend = parsed.raw.distributions.length > 0 || svc.service.endsWith('-web');

    if (isCrossDomain) crossDomainAdapters.push(svc);
    else if (isDataAdapter) dataAdapters.push(svc);
    else if (isFrontend) frontends.push(svc);
    else regular.push(svc);
  }

  // Render service boxes with README tooltips
  const I = '    '; // indent for layer children
  const renderBox = (svc) => {
    const label = serviceLabel(svc.service);
    lines.push(`${I}${svc.service}: "${label}" {`);
    lines.push(`${I}  style: { ${C2_STYLES.domain} }`);
    lines.push(`${I}  link: layers.c3-${svc.service}`);
    const desc = serviceDescriptions?.get(svc.service);
    if (desc) lines.push(`${I}  tooltip: "${desc.replace(/"/g, '\\"')}"`);
    lines.push(`${I}}`);
  };

  for (const svc of frontends) renderBox(svc);
  for (const svc of regular) renderBox(svc);
  for (const svc of dataAdapters) renderBox(svc);
  for (const svc of crossDomainAdapters) renderBox(svc);
  lines.push('');

  // External domain boxes for cross-domain adapter ingestion (pull model)
  const externalDomainIds = new Set();
  for (const svc of crossDomainAdapters) {
    const parsed = parsedStacks.get(svc.service);
    if (!parsed) continue;
    for (const rule of parsed.raw.rules) {
      if (!rule.isCrossDomain || !rule.sourceBusVar) continue;
      const sourceDomain = rule.sourceBusVar.replace(/Bus$/, '').toLowerCase();
      if (sourceDomain === domain) continue; // skip own-domain rules
      const sourceTitle = sourceDomain.charAt(0).toUpperCase() + sourceDomain.slice(1);
      const extId = `ext-${sourceDomain}`;
      if (!externalDomainIds.has(extId)) {
        externalDomainIds.add(extId);
        lines.push(`${I}${extId}: "${sourceTitle} Domain" {style: { ${C2_STYLES.external} }}`);
      }
      const eventList = rule.eventTypes.join('\\n');
      const pillId = `${sourceDomain}-to-${svc.service}`;
      lines.push(`${I}${pillId}: "${rule.eventTypes.length} Events" {style: { ${C2_STYLES.flowLabel} }; tooltip: "${eventList}"}`);
      lines.push(`${I}${extId} -> ${pillId} {${EDGE_STYLE}}`);
      lines.push(`${I}${pillId} -> ${svc.service} {${EDGE_STYLE}}`);
    }
  }

  // External domain boxes for inbound events (from other domains' adapters)
  const inbound = inboundEventMap?.get(domain) || [];
  for (const entry of inbound) {
    const srcTitle = entry.from.charAt(0).toUpperCase() + entry.from.slice(1);
    const extId = `ext-${entry.from}`;
    if (!externalDomainIds.has(extId)) {
      externalDomainIds.add(extId);
      lines.push(`${I}${extId}: "${srcTitle} Domain" {style: { ${C2_STYLES.external} }}`);
    }
    const internalConsumers = [];
    for (const svc of [...regular, ...dataAdapters, ...frontends]) {
      const parsed = parsedStacks.get(svc.service);
      if (!parsed) continue;
      const subTypes = parsed.constructs.ingress.flatMap(i => i.eventTypes);
      const matched = entry.events.filter(e => subTypes.includes(e));
      if (matched.length) internalConsumers.push({ service: svc.service, events: matched });
    }
    for (const cons of internalConsumers) {
      const eventList = cons.events.join('\\n');
      const pillId = `${entry.from}-to-${cons.service}`;
      lines.push(`${I}${pillId}: "${cons.events.length} Events" {style: { ${C2_STYLES.flowLabel} }; tooltip: "${eventList}"}`);
      lines.push(`${I}${extId} -> ${pillId} {${EDGE_STYLE}}`);
      lines.push(`${I}${pillId} -> ${cons.service} {${EDGE_STYLE}}`);
    }
  }

  // Intra-domain event flows (fuzzy matched)
  const intraFlows = matchIntraDomainFlows(
    [...regular, ...dataAdapters, ...frontends],
    parsedStacks,
  );
  for (const flow of intraFlows) {
    const eventList = flow.events.join('\\n');
    const pillId = `${flow.from}-to-${flow.to}`;
    lines.push(`${I}${pillId}: "${flow.events.length} Events" {style: { ${C2_STYLES.flowLabel} }; tooltip: "${eventList}"}`);
    lines.push(`${I}${flow.from} -> ${pillId} {${EDGE_STYLE}}`);
    lines.push(`${I}${pillId} -> ${flow.to} {${EDGE_STYLE}}`);
  }

  // External systems (data adapters → third-party APIs)
  const externals = detectExternalSystems(services);
  for (const ext of externals) {
    const extId = `ext-${ext.name.toLowerCase().replace(/\s+/g, '-')}`;
    lines.push(`${I}${extId}: "${ext.name}" {style: { ${C2_STYLES.external} }}`);
    lines.push(`${I}${ext.service} -> ${extId} {style.stroke-width: 2}`);
  }

  lines.push('');

  // Layer imports
  lines.push('    layers: {');
  for (const svc of services) {
    const parsed = parsedStacks.get(svc.service);
    if (parsed && parsed.raw.eventBuses.length > 0) continue;
    lines.push(`      c3-${svc.service}: { ...@./c3/${svc.service}.d2 }`);
  }
  lines.push('    }');
  lines.push('  }');

  return lines.join('\n');
}

function main() {
  console.log('Generating C4 D2 sources from CDK stacks...');

  // 1. Discover
  const services = discoverServices();
  console.log(
    `  found: ${services.length} services in ${[...new Set(services.map((s) => s.domain))].length} domains`,
  );

  // 2. Parse all stacks
  const parsedStacks = new Map();
  for (const svc of services) {
    const src = readFileSync(svc.stackPath, 'utf-8');
    parsedStacks.set(svc.service, parseStack(src));
  }
  console.log(`  parsed: ${parsedStacks.size} service stacks`);

  // 3. Generate C3 files
  mkdirSync(C3_DIR, { recursive: true });
  let c3Count = 0;
  for (const svc of services) {
    const parsed = parsedStacks.get(svc.service);
    if (!parsed) continue;
    const d2 = generateC3(svc.service, svc.domain, parsed);
    writeFileSync(join(C3_DIR, `${svc.service}.d2`), d2 + '\n');
    c3Count++;
  }
  console.log(`  wrote: ${c3Count} C3 files to ${C3_DIR}/`);

  // 4. Generate root nestfolio.d2
  const domains = [...new Set(services.map((s) => s.domain))].sort();
  const domainServices = new Map();
  for (const d of domains) {
    domainServices.set(
      d,
      services.filter((s) => s.domain === d),
    );
  }

  const domainDescriptions = readDomainDescriptions(SERVICES_DIR);
  const serviceDescriptions = readServiceDescriptions(SERVICES_DIR);
  const crossDomainFlows = extractCrossDomainFlows(services, parsedStacks);
  const inboundEventMap = buildInboundEventMap(services, parsedStacks);
  const frontends = detectFrontends(services, parsedStacks);
  const systemMeta = readSystemMeta(ROOT);
  console.log(
    `  flows: ${crossDomainFlows.length} cross-domain event flows (${crossDomainFlows.reduce((n, f) => n + f.events.length, 0)} events)`,
  );
  console.log(`  frontends: ${frontends.map((f) => f.service).join(', ') || 'none'}`);
  console.log(`  service descriptions: ${serviceDescriptions.size}`);

  const parts = [
    generateGlobalStyles(),
    '',
    '# ===========================================================================',
    '# LAYER: C1 — System Context',
    '# ===========================================================================',
    '',
    generateC1({ domains, domainDescriptions, crossDomainFlows, frontends, systemMeta }),
    '',
    '# ===========================================================================',
    '# LAYERS',
    '# ===========================================================================',
    'layers: {',
    '',
  ];

  const c2Opts = { serviceDescriptions, inboundEventMap };
  for (const d of domains) {
    parts.push('  # =========================================================================');
    parts.push(`  # C2 — ${d.charAt(0).toUpperCase() + d.slice(1)} Domain`);
    parts.push('  # =========================================================================');
    parts.push(generateC2(d, domainServices.get(d), parsedStacks, c2Opts));
    parts.push('');
  }

  parts.push('}');

  writeFileSync(D2_SOURCE, parts.join('\n') + '\n');
  console.log(`  wrote: ${D2_SOURCE}`);
  console.log('Done. Run `node tools/generate-c4-diagrams.mjs` to compile SVGs.');
}

// Run if invoked directly
const isMain =
  process.argv[1] &&
  new URL(process.argv[1], 'file://').pathname === new URL(import.meta.url).pathname;
if (isMain) main();
