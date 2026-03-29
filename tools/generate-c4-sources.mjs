import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const SERVICES_DIR = join(ROOT, 'services');

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
    },
  };

  // State: new State(this, 'Id') or new State(this, 'Id', { ... })
  for (const m of src.matchAll(/new\s+State\s*\(\s*this\s*,\s*['"](\w+)['"]\s*(?:,\s*(\{[^)]*\}))?\s*\)/gs)) {
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
      entry.eventTypes = [...etMatch[1].matchAll(/['"]([^'"]+)['"]/g)].map(x => x[1]);
      // 2. Try spread variables: [...VAR_NAME] (must check before enum refs since ... contains dots)
      if (entry.eventTypes.length === 0) {
        const spreads = [...etMatch[1].matchAll(/\.\.\.(\w+)/g)].map(x => x[1]);
        if (spreads.length > 0) {
          for (const constName of spreads) {
            const constMatch = src.match(new RegExp(`(?:const|let|export\\s+const)\\s+${constName}\\s*(?::\\s*\\w+(?:\\[\\])?)?\\s*=\\s*\\[([\\s\\S]*?)\\]`));
            if (constMatch) {
              const literals = [...constMatch[1].matchAll(/['"]([^'"]+)['"]/g)].map(x => x[1]);
              if (literals.length > 0) entry.eventTypes.push(...literals);
              else entry.eventTypes.push(...[...constMatch[1].matchAll(/\.(\w+)/g)].map(x => x[1]));
            }
          }
        }
      }
      // 3. Try enum references: EnumType.MEMBER
      if (entry.eventTypes.length === 0) {
        entry.eventTypes = [...etMatch[1].matchAll(/\w+\.(\w+)/g)].map(x => x[1]);
      }
      // 4. Try single variable reference: eventTypes: VAR_NAME
      if (entry.eventTypes.length === 0) {
        const refMatch = after.match(/eventTypes\s*:\s*(\w+)\s*[,\n}]/);
        if (refMatch) {
          const constName = refMatch[1];
          const constMatch = src.match(new RegExp(`(?:const|let)\\s+${constName}\\s*=\\s*\\[([\\s\\S]*?)\\]`));
          if (constMatch) {
            entry.eventTypes = [...constMatch[1].matchAll(/['"]([^'"]+)['"]/g)].map(x => x[1]);
            if (entry.eventTypes.length === 0) {
              entry.eventTypes = [...constMatch[1].matchAll(/\.(\w+)/g)].map(x => x[1]);
            }
          }
        }
      }
    }
    // Detect custom entry (handler file)
    const entryMatch = after.match(/entry\s*:\s*(?:join\s*\([^)]*['"]([^'"]+)['"]\s*\)|['"]([^'"]+)['"])/);
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
      entry.publishableTypes = [...ptMatch[1].matchAll(/['"]([^'"]+)['"]/g)].map(x => x[1]);
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
      entry.triggers = [...trMatch[1].matchAll(/['"]([^'"]+)['"]/g)].map(x => x[1]);
      if (entry.triggers.length === 0) {
        entry.triggers = [...trMatch[1].matchAll(/\.(\w+)/g)].map(x => x[1]);
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

  return result;
}
