#!/usr/bin/env node

/**
 * Generates Markdown documentation with Mermaid diagrams from flow YAML specs.
 *
 * Usage:
 *   node tools/generate-flow-docs.mjs              # all flows + README
 *   node tools/generate-flow-docs.mjs deposit       # single flow
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { parseDocument } from 'yaml';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const FLOWS_DIR = join(ROOT, 'flows');
const OUT_DIR = join(ROOT, 'docs', 'data-flows');

// ── YAML helpers ──────────────────────────────────────────────────────────────

function loadFlow(filePath) {
  const raw = readFileSync(filePath, 'utf-8');
  const doc = parseDocument(raw);
  return doc.toJSON();
}

// ── Mermaid diagram generation ────────────────────────────────────────────────

const DOMAIN_STYLES = {
  investor: { fill: '#dbeafe', stroke: '#3b82f6' },
  advisory: { fill: '#fef3c7', stroke: '#f59e0b' },
  execution: { fill: '#d1fae5', stroke: '#10b981' },
  ledger: { fill: '#ede9fe', stroke: '#8b5cf6' },
};

const BUS_LABELS = {
  InvestorBus: 'InvestorBus',
  AdvisoryBus: 'AdvisoryBus',
  ExecutionBus: 'ExecutionBus',
  LedgerBus: 'LedgerBus',
};

function serviceDomain(serviceName, domains) {
  const mapping = {
    'investor-bff': 'investor',
    'investor-ctrl': 'investor',
    'investor-adpt': 'investor',
    'investor-mfe': 'investor',
    'onboarding-bff': 'investor',
    'dashboard-bff': 'investor',
    'advisory-ctrl': 'advisory',
    'advisory-adpt': 'advisory',
    'decision-workflow-ctrl': 'advisory',
    'compliance-ctrl': 'advisory',
    'market-intelligence-ctrl': 'advisory',
    'portfolio-engine-ctrl': 'advisory',
    'advisory-narrative-ctrl': 'advisory',
    'execution-ctrl': 'execution',
    'execution-adpt': 'execution',
    'execution-hub': 'execution',
    'broker-ctrl': 'execution',
    'broker-sim-adpt': 'execution',
    'broker-alpaca-adpt': 'execution',
    'alpha-vantage-adpt': 'execution',
    'fred-adpt': 'execution',
    'marketwatch-adpt': 'execution',
    'sec-edgar-adpt': 'execution',
    'ledger-ctrl': 'ledger',
    'ledger-adpt': 'ledger',
    'reconciliation-ctrl': 'ledger',
  };
  if (mapping[serviceName]) return mapping[serviceName];
  // fallback: try to match by domain prefix
  for (const d of domains || []) {
    if (serviceName.startsWith(d)) return d;
  }
  return domains?.[0] ?? 'execution';
}

function sanitizeId(name) {
  return name.replace(/[^a-zA-Z0-9]/g, '_');
}

function parseEvents(str) {
  return str
    .replace(/\s*\(.*?\)/g, '')
    .split(/\s*(?:,|\bor\b|\|)\s*/i)
    .map((e) => e.trim())
    .filter(Boolean);
}

// ── Flowchart diagram generation ─────────────────────────────────────────────

function buildFlowchart(flow) {
  const steps = flow.steps || [];
  const domains = flow.domains || [];
  const lines = ['flowchart TD'];

  // Collect unique services preserving order
  const seen = new Set();
  const services = [];
  for (const step of steps) {
    if (step.service && !seen.has(step.service)) {
      seen.add(step.service);
      services.push(step.service);
    }
  }

  // Group by domain for subgraphs
  const byDomain = new Map();
  for (const svc of services) {
    const d = serviceDomain(svc, domains);
    if (!byDomain.has(d)) byDomain.set(d, []);
    byDomain.get(d).push(svc);
  }

  // Domain subgraphs with nodes
  for (const [domain, svcs] of byDomain) {
    lines.push(`    subgraph ${domain}["${titleCase(domain)} Domain"]`);
    for (const svc of svcs) {
      lines.push(`        ${sanitizeId(svc)}["${svc}"]`);
    }
    lines.push(`    end`);
  }

  // Build edges: for each emitted event, find the closest receiver
  // Collect raw edges first, then deduplicate by service pair
  const rawEdges = []; // { from, to, label, dashed }
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];

    // cross_domain step: connect previous service emitter to next service receiver
    if (step.cross_domain) {
      const eventName = step.cross_domain;
      // Find the last service-based step before this one
      let fromSvc = null;
      for (let j = i - 1; j >= 0; j--) {
        if (steps[j].service) { fromSvc = steps[j].service; break; }
      }
      // Find the first service-based step after this one that receives this event
      for (let j = i + 1; j < steps.length; j++) {
        const receiver = steps[j];
        if (!receiver.receives || !receiver.service) continue;
        const receivedEvents = parseEvents(receiver.receives);
        if (receivedEvents.includes(eventName) && fromSvc && receiver.service !== fromSvc) {
          rawEdges.push({ from: fromSvc, to: receiver.service, label: eventName, dashed: true });
          break;
        }
      }
      continue;
    }

    if (!step.emits || !step.service) continue;

    const emittedEvents = parseEvents(step.emits);
    for (const evt of emittedEvents) {
      for (let j = i + 1; j < steps.length; j++) {
        const receiver = steps[j];
        if (!receiver.receives || !receiver.service) continue;
        if (receiver.service === step.service) continue; // skip self-edges
        const receivedEvents = parseEvents(receiver.receives);
        if (receivedEvents.includes(evt)) {
          rawEdges.push({
            from: step.service,
            to: receiver.service,
            label: evt,
            dashed: false,
          });
          break; // only the first (closest) receiver
        }
      }
    }
  }

  // Deduplicate: merge edges between the same service pair into one label
  const pairMap = new Map(); // "from|to" -> { from, to, labels[], dashed }
  for (const e of rawEdges) {
    const key = `${e.from}|${e.to}`;
    if (!pairMap.has(key)) {
      pairMap.set(key, { from: e.from, to: e.to, labels: [], dashed: e.dashed });
    }
    pairMap.get(key).labels.push(e.label);
  }

  for (const edge of pairMap.values()) {
    const arrow = edge.dashed ? '-.->' : '-->';
    const label =
      edge.labels.length > 2 ? edge.labels.slice(0, 2).join(', ') + ' ...' : edge.labels.join(', ');
    lines.push(
      `    ${sanitizeId(edge.from)} ${arrow}|"${truncate(label, 45)}"| ${sanitizeId(edge.to)}`,
    );
  }

  return lines.join('\n');
}

// ── Sequence diagram generation ──────────────────────────────────────────────

function buildMermaid(flow) {
  const steps = flow.steps || [];
  const domains = flow.domains || [];
  const lines = ['sequenceDiagram'];

  // Collect unique services in order
  const seen = new Set();
  const participants = [];
  for (const step of steps) {
    const svc = step.service;
    if (svc && !seen.has(svc)) {
      seen.add(svc);
      participants.push(svc);
    }
  }

  // Add participants with domain grouping
  const byDomain = new Map();
  for (const p of participants) {
    const d = serviceDomain(p, domains);
    if (!byDomain.has(d)) byDomain.set(d, []);
    byDomain.get(d).push(p);
  }
  for (const [domain, svcs] of byDomain) {
    lines.push(`    box ${domain} domain`);
    for (const svc of svcs) {
      lines.push(`        participant ${sanitizeId(svc)} as ${svc}`);
    }
    lines.push(`    end`);
  }

  /** Find the service that emitted one of the received events, looking only at prior steps */
  function findSource(receivesStr, upToIndex) {
    const wanted = parseEvents(receivesStr);
    // Walk backwards through prior steps to find the most recent emitter
    for (let j = upToIndex - 1; j >= 0; j--) {
      const s = steps[j];
      if (!s.emits || !s.service) continue;
      const emitted = parseEvents(s.emits);
      for (const ev of wanted) {
        if (emitted.includes(ev)) return s.service;
      }
    }
    return null;
  }

  // Add interactions
  let prevService = null;
  let skipNextReceive = false;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];

    // cross_domain step: draw a dashed async arrow from prev service to next service
    if (step.cross_domain) {
      const eventName = truncate(step.cross_domain, 60);
      const hopLabel = `${eventName} (${step.from} → ${step.to})`;
      // Find next service-based step
      const next = steps.slice(i + 1).find((s) => s.service);
      if (prevService && next?.service) {
        lines.push(`    ${sanitizeId(prevService)}-)${sanitizeId(next.service)}: ${hopLabel}`);
        skipNextReceive = true;
      }
      continue;
    }

    const svc = step.service;
    if (!svc) continue;

    const svcId = sanitizeId(svc);

    if (skipNextReceive) {
      skipNextReceive = false;
    } else if (step.receives) {
      // Find correct source from prior steps, fall back to prevService
      const source = findSource(step.receives, i) ?? prevService;
      if (source && source !== svc) {
        const events = step.receives
          .split(/\s*[|,]\s*/)
          .map((e) => e.trim())
          .filter(Boolean);
        const label =
          events.length > 2 ? events.slice(0, 2).join(' | ') + ' ...' : events.join(' | ');
        lines.push(`    ${sanitizeId(source)}->>+${svcId}: ${label}`);
      }
    } else if (step.action && !step.receives) {
      lines.push(`    Note over ${svcId}: ${truncate(step.action, 50)}`);
    }

    prevService = svc;
  }

  return lines.join('\n');
}

function truncate(s, max) {
  if (!s) return '';
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

// ── Markdown generation ───────────────────────────────────────────────────────

function titleCase(slug) {
  return slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function generateMarkdown(flow) {
  const lines = [];
  const title = titleCase(flow.flow);
  lines.push(`# ${title}`);
  lines.push('');
  lines.push(`> ${flow.description}`);
  lines.push('');
  lines.push(`**Domains:** ${(flow.domains || []).join(', ')}`);
  lines.push('');
  lines.push(`**Trigger:** ${flow.trigger}`);
  lines.push('');

  // Flowchart diagram
  lines.push('## Flowchart');
  lines.push('');
  lines.push('```mermaid');
  lines.push(buildFlowchart(flow));
  lines.push('```');
  lines.push('');

  // Sequence diagram
  lines.push('## Sequence Diagram');
  lines.push('');
  lines.push('```mermaid');
  lines.push(buildMermaid(flow));
  lines.push('```');
  lines.push('');

  // Steps table
  lines.push('## Steps');
  lines.push('');
  const steps = flow.steps || [];
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const num = i + 1;

    if (s.cross_domain) {
      lines.push(`### Step ${num}: Cross-domain hop`);
      lines.push('');
      lines.push(`- **Event:** \`${s.cross_domain}\``);
      lines.push(`- **From:** ${s.from}`);
      lines.push(`- **To:** ${s.to}`);
      lines.push(`- **Via:** ${s.via}`);
      lines.push('');
      continue;
    }

    lines.push(`### Step ${num}: ${s.service}`);
    lines.push('');

    if (s.receives) lines.push(`- **Receives:** \`${s.receives}\``);
    if (s.action) lines.push(`- **Action:** ${s.action}`);
    if (s.via) lines.push(`- **Via:** ${s.via}`);
    if (s.state_change) lines.push(`- **State change:** ${s.state_change}`);
    if (s.emits) lines.push(`- **Emits:** \`${s.emits}\``);
    if (s.idempotent !== undefined) lines.push(`- **Idempotent:** ${s.idempotent ? 'yes' : 'no'}`);
    lines.push('');
  }

  // Success criteria
  if (flow.success_criteria?.length) {
    lines.push('## Success Criteria');
    lines.push('');
    for (const c of flow.success_criteria) {
      lines.push(`- ${c}`);
    }
    lines.push('');
  }

  // Failure modes
  if (flow.failure_modes?.length) {
    lines.push('## Failure Modes');
    lines.push('');
    for (const f of flow.failure_modes) {
      if (typeof f === 'string') {
        lines.push(`- ${f}`);
      } else {
        // YAML parses "step N fails: description" as { "step N fails": "description" }
        for (const [key, val] of Object.entries(f)) {
          lines.push(`- **${key}:** ${val}`);
        }
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ── README generation ─────────────────────────────────────────────────────────

function generateReadme(flows) {
  const lines = [];
  lines.push('# Data Flow Documentation');
  lines.push('');
  lines.push(
    'End-to-end business flow specifications for Nestfolio, generated from `flows/*.flow.yaml`.',
  );
  lines.push('');
  lines.push(
    '> **Auto-generated** — do not edit manually. Run `node tools/generate-flow-docs.mjs` to regenerate.',
  );
  lines.push('');
  lines.push('## Flows');
  lines.push('');
  lines.push('| # | Flow | Domains | Description |');
  lines.push('|---|------|---------|-------------|');

  const sorted = [...flows].sort((a, b) => a.flow.localeCompare(b.flow));
  sorted.forEach((f, i) => {
    const num = String(i + 1).padStart(2, '0');
    const link = `[${titleCase(f.flow)}](./${f.flow}.md)`;
    const domains = (f.domains || []).map((d) => `\`${d}\``).join(', ');
    lines.push(`| ${num} | ${link} | ${domains} | ${f.description} |`);
  });

  lines.push('');
  lines.push('## Architecture Overview');
  lines.push('');
  lines.push('```mermaid');
  lines.push('graph LR');
  lines.push('    subgraph Investor Domain');
  lines.push('        IB[InvestorBus]');
  lines.push('    end');
  lines.push('    subgraph Advisory Domain');
  lines.push('        AB[AdvisoryBus]');
  lines.push('    end');
  lines.push('    subgraph Execution Domain');
  lines.push('        EB[ExecutionBus]');
  lines.push('    end');
  lines.push('    subgraph Ledger Domain');
  lines.push('        LB[LedgerBus]');
  lines.push('    end');
  lines.push('    IB <-->|investor-adpt| AB');
  lines.push('    IB <-->|investor-adpt| EB');
  lines.push('    AB <-->|advisory-adpt| EB');
  lines.push('    EB <-->|execution-adpt| LB');
  lines.push('    LB <-->|ledger-adpt| IB');
  lines.push('    LB <-->|ledger-adpt| AB');
  lines.push('```');
  lines.push('');
  lines.push('## Regenerating');
  lines.push('');
  lines.push('```bash');
  lines.push('# All flows');
  lines.push('node tools/generate-flow-docs.mjs');
  lines.push('');
  lines.push('# Single flow');
  lines.push('node tools/generate-flow-docs.mjs deposit');
  lines.push('```');
  lines.push('');

  return lines.join('\n');
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
  const targetFlow = process.argv[2]; // optional: flow name

  // Ensure output dir exists
  if (!existsSync(OUT_DIR)) {
    mkdirSync(OUT_DIR, { recursive: true });
  }

  // Discover flow files
  const allFiles = readdirSync(FLOWS_DIR)
    .filter((f) => f.endsWith('.flow.yaml'))
    .sort();

  const filesToProcess = targetFlow
    ? allFiles.filter((f) => f === `${targetFlow}.flow.yaml`)
    : allFiles;

  if (targetFlow && filesToProcess.length === 0) {
    console.error(`Flow not found: ${targetFlow}`);
    console.error(
      `Available flows: ${allFiles.map((f) => f.replace('.flow.yaml', '')).join(', ')}`,
    );
    process.exit(1);
  }

  // Process flows
  const allFlows = [];
  for (const file of filesToProcess) {
    const filePath = join(FLOWS_DIR, file);
    const flow = loadFlow(filePath);
    const md = generateMarkdown(flow);
    const outPath = join(OUT_DIR, `${flow.flow}.md`);
    writeFileSync(outPath, md);
    allFlows.push(flow);
    console.log(`  ✓ ${flow.flow}.md`);
  }

  // Generate README only when processing all flows
  if (!targetFlow) {
    // Load all flows for README even if we only processed some
    const allFlowsForReadme = allFiles.map((f) => loadFlow(join(FLOWS_DIR, f)));
    const readme = generateReadme(allFlowsForReadme);
    writeFileSync(join(OUT_DIR, 'README.md'), readme);
    console.log(`  ✓ README.md`);
  }

  console.log(`\nGenerated ${allFlows.length} flow doc(s) in docs/data-flows/`);
}

main();
