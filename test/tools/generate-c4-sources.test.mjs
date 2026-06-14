import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { discoverServices, discoverMfes, parseStack, serviceLabel, generateC1, generateC2, generateC3 } from '../../tools/generate-c4-sources.mjs';

describe('discoverServices', () => {
  it('returns services grouped by domain', () => {
    const services = discoverServices();
    // Must find 4 domains
    const domains = [...new Set(services.map(s => s.domain))];
    assert.ok(domains.includes('investor'));
    assert.ok(domains.includes('advisory'));
    assert.ok(domains.includes('execution'));
    assert.ok(domains.includes('ledger'));
    // Must find known services
    const names = services.map(s => s.service);
    assert.ok(names.includes('investor-ctrl'));
    assert.ok(names.includes('dashboard-bff'));
    assert.ok(names.includes('broker-ctrl'));
    // Each entry has stackPath pointing to a real file
    for (const s of services) {
      assert.ok(s.stackPath.endsWith('service.stack.ts'));
    }
  });
});

describe('discoverMfes', () => {
  it('discovers 5 MFEs from host routes', () => {
    const services = discoverServices();
    const mfes = discoverMfes(services);
    assert.equal(mfes.length, 5);
    const names = mfes.map(m => m.mfe);
    assert.ok(names.includes('investor-mfe'));
    assert.ok(names.includes('dashboard-mfe'));
    assert.ok(names.includes('onboarding-mfe'));
    assert.ok(names.includes('advisory-mfe'));
    assert.ok(names.includes('ledger-mfe'));
  });

  it('maps each MFE to its BFF', () => {
    const services = discoverServices();
    const mfes = discoverMfes(services);
    const byName = Object.fromEntries(mfes.map(m => [m.mfe, m]));
    assert.equal(byName['investor-mfe'].bff, 'investor-bff');
    assert.equal(byName['dashboard-mfe'].bff, 'dashboard-bff');
    assert.equal(byName['onboarding-mfe'].bff, 'onboarding-bff');
    assert.equal(byName['advisory-mfe'].bff, 'advisory-bff');
    assert.equal(byName['ledger-mfe'].bff, 'ledger-bff');
  });

  it('resolves domain from BFF service location', () => {
    const services = discoverServices();
    const mfes = discoverMfes(services);
    const byName = Object.fromEntries(mfes.map(m => [m.mfe, m]));
    assert.equal(byName['investor-mfe'].domain, 'investor');
    assert.equal(byName['dashboard-mfe'].domain, 'investor');
    assert.equal(byName['onboarding-mfe'].domain, 'investor');
    assert.equal(byName['advisory-mfe'].domain, 'advisory');
    assert.equal(byName['ledger-mfe'].domain, 'ledger');
  });

  it('extracts route paths', () => {
    const services = discoverServices();
    const mfes = discoverMfes(services);
    const byName = Object.fromEntries(mfes.map(m => [m.mfe, m]));
    assert.equal(byName['investor-mfe'].route, '/investor');
    assert.equal(byName['onboarding-mfe'].route, '/onboarding');
    assert.equal(byName['advisory-mfe'].route, '/advisory');
  });

  it('handles MFE without provideGraphqlFor (onboarding)', () => {
    const services = discoverServices();
    const mfes = discoverMfes(services);
    const onboarding = mfes.find(m => m.mfe === 'onboarding-mfe');
    assert.equal(onboarding.bff, 'onboarding-bff');
    assert.equal(onboarding.domain, 'investor');
  });
});

describe('parseStack', () => {
  it('detects State construct', () => {
    const src = `const state = new State(this, 'State');`;
    const result = parseStack(src);
    assert.equal(result.constructs.state.length, 1);
    assert.equal(result.constructs.state[0].id, 'State');
  });

  it('detects State with withBucket prop', () => {
    const src = `const state = new State(this, 'State', { withBucket: true });`;
    const result = parseStack(src);
    assert.equal(result.constructs.state[0].withBucket, true);
  });

  it('detects multiple Ingress constructs with eventTypes', () => {
    const src = `
      const ingress = new Ingress(this, 'Ingress', {
        state,
        eventTypes: ['BALANCE_UPDATED', 'PORTFOLIO_UPDATED'],
      });
      const callbackIngress = new Ingress(this, 'CallbackIngress', {
        state,
        eventTypes: ['SIM_ORDER_FILLED', 'SIM_ORDER_REJECTED'],
        entry: join(__dirname, 'handlers', 'callback-resolver.ts'),
      });
    `;
    const result = parseStack(src);
    assert.equal(result.constructs.ingress.length, 2);
    assert.deepEqual(result.constructs.ingress[0].eventTypes, ['BALANCE_UPDATED', 'PORTFOLIO_UPDATED']);
    assert.equal(result.constructs.ingress[0].id, 'Ingress');
    assert.deepEqual(result.constructs.ingress[1].eventTypes, ['SIM_ORDER_FILLED', 'SIM_ORDER_REJECTED']);
  });

  it('detects Ingress eventTypes from enum references', () => {
    const src = `
      new Ingress(this, 'Ingress', {
        state,
        eventTypes: [BrokerSimEventTypes.SIM_ORDER_REQUESTED, BrokerSimEventTypes.SIM_DEPOSIT_INITIATED],
      });
    `;
    const result = parseStack(src);
    assert.deepEqual(result.constructs.ingress[0].eventTypes, ['SIM_ORDER_REQUESTED', 'SIM_DEPOSIT_INITIATED']);
  });

  it('detects Ingress eventTypes from spread variables', () => {
    const src = `
      const TRIGGER_EVENT_TYPES = ['MANDATE_GRANTED', 'GOAL_UPDATED'];
      new Ingress(this, 'TriggerIngress', {
        state,
        eventTypes: [...TRIGGER_EVENT_TYPES],
      });
    `;
    const result = parseStack(src);
    assert.deepEqual(result.constructs.ingress[0].eventTypes, ['MANDATE_GRANTED', 'GOAL_UPDATED']);
  });

  it('detects Egress with eventTypes base name and expands', () => {
    const src = `new Egress(this, 'Egress', { state, eventTypes: { 'Order': 'ORDER' } });`;
    const result = parseStack(src);
    assert.equal(result.constructs.egress.length, 1);
    assert.deepEqual(result.constructs.egress[0].allEventTypes.sort(), ['ORDER_CREATED', 'ORDER_UPDATED']);
  });

  it('detects Egress with eventTypes explicit per-action', () => {
    const src = `new Egress(this, 'Egress', { state, eventTypes: { 'Payment': { insert: 'PAYMENT_RECEIVED' } } });`;
    const result = parseStack(src);
    assert.deepEqual(result.constructs.egress[0].allEventTypes, ['PAYMENT_RECEIVED']);
  });

  it('detects Egress with eventTypes field dispatch', () => {
    const src = `new Egress(this, 'Egress', { state, eventTypes: { 'Result': { insert: { field: 'status', map: { OK: 'CHECK_PASSED', FAIL: 'CHECK_FAILED' }, default: 'CHECK_UNKNOWN' } } } });`;
    const result = parseStack(src);
    assert.deepEqual(result.constructs.egress[0].allEventTypes.sort(), ['CHECK_FAILED', 'CHECK_PASSED', 'CHECK_UNKNOWN']);
  });

  it('detects Egress with eventTypes containing digits', () => {
    const src = `new Egress(this, 'Egress', { state, eventTypes: { 'SecFiling': { insert: { field: 'formType', map: { '8-K': 'SEC_8K_FILED', '10-K': 'SEC_10K_UPDATED' }, default: 'SEC_8K_FILED' } } } });`;
    const result = parseStack(src);
    assert.deepEqual(result.constructs.egress[0].allEventTypes.sort(), ['SEC_10K_UPDATED', 'SEC_8K_FILED']);
  });

  it('detects Egress with eventTypes passthrough emits', () => {
    const src = `new Egress(this, 'Egress', { state, eventTypes: { 'NormalizedEvent': { insert: { field: 'sk', passthrough: true, emits: ['ORDER_FILLED', 'ORDER_REJECTED'] } } } });`;
    const result = parseStack(src);
    assert.deepEqual(result.constructs.egress[0].allEventTypes.sort(), ['ORDER_FILLED', 'ORDER_REJECTED']);
  });

  it('detects Facade with jsResolvers', () => {
    const src = `new Facade(this, 'Facade', { state, jsResolvers: discoverJsResolvers(__dirname) });`;
    const result = parseStack(src);
    assert.equal(result.constructs.facade.length, 1);
    assert.equal(result.constructs.facade[0].hasJsResolvers, true);
  });

  it('detects Orchestration with triggers', () => {
    const src = `
      const orderOrchestration = new Orchestration(this, 'OrderStateMachine', {
        state,
        definitionBody: orderWorkflow.definitionBody,
        triggers: [BrokerCtrlInboundEventTypes.ORDER_SUBMITTED],
        timeout: Duration.hours(1),
      });
    `;
    const result = parseStack(src);
    assert.equal(result.constructs.orchestration.length, 1);
    assert.equal(result.constructs.orchestration[0].id, 'OrderStateMachine');
  });

  it('detects AgentRuntime', () => {
    const src = `new AgentRuntime(this, 'OnboardingAgent', { runtimeName: 'onboarding-agent' });`;
    const result = parseStack(src);
    assert.equal(result.constructs.agentRuntime.length, 1);
  });

  it('detects KnowledgeBase', () => {
    const src = `const kb = new KnowledgeBase(this, 'OnboardingKB', { kbName: 'nestfolio-docs' });`;
    const result = parseStack(src);
    assert.equal(result.constructs.knowledgeBase.length, 1);
  });

  it('detects agentcore.Memory', () => {
    const src = `const memory = new agentcore.Memory(this, 'AgentMemory', { memoryName: 'test' });`;
    const result = parseStack(src);
    assert.equal(result.constructs.agentMemory.length, 1);
    assert.equal(result.constructs.agentMemory[0].id, 'AgentMemory');
  });

  it('detects Broadcaster construct', () => {
    const src = `
      const broadcaster = new Broadcaster(this, 'DashboardBroadcaster', {
        state,
        entry: join(__dirname, 'handlers', 'dashboard-publisher.ts'),
        facade,
      });
    `;
    const result = parseStack(src);
    assert.equal(result.constructs.broadcaster.length, 1);
    assert.equal(result.constructs.broadcaster[0].id, 'DashboardBroadcaster');
  });
});

describe('parseStack — raw resources', () => {
  it('detects EventBus creation (hub pattern)', () => {
    const src = `this.bus = new EventBus(this, 'InvestorBus', { eventBusName: name });`;
    const result = parseStack(src);
    assert.equal(result.raw.eventBuses.length, 1);
    assert.equal(result.raw.eventBuses[0].id, 'InvestorBus');
  });

  it('detects Archive (hub pattern)', () => {
    const src = `new Archive(this, 'Archive', { sourceEventBus: this.bus, retention: Duration.days(365) });`;
    const result = parseStack(src);
    assert.equal(result.raw.archives.length, 1);
  });

  it('detects cross-domain rules with EventBusTarget', () => {
    const src = `
      new Rule(this, 'ToAdvisory', {
        eventBus: investorBus,
        eventPattern: { detailType: ['GOAL_UPDATED', 'RISK_PROFILE_UPDATED'] },
        targets: [new EventBusTarget(advisoryBus, { deadLetterQueue: toAdvisoryDlq })],
      });
    `;
    const result = parseStack(src);
    assert.equal(result.raw.rules.length, 1);
    assert.equal(result.raw.rules[0].id, 'ToAdvisory');
    assert.ok(result.raw.rules[0].isCrossDomain);
  });

  it('detects resolveBusArn calls (adapter bus references)', () => {
    const src = `
      const advisoryBusArn = resolveBusArn(this, 'AdvisoryBus', prefix, 'advisory', domainAccounts);
      const executionBusArn = resolveBusArn(this, 'ExecutionBus', prefix, 'execution', domainAccounts);
    `;
    const result = parseStack(src);
    assert.deepEqual(result.raw.resolvedBuses, ['advisory', 'execution']);
  });

  it('detects resolveBusArn with multiline calls and this.prefix', () => {
    const src = `
      const advisoryBusArn = resolveBusArn(
        this,
        'AdvisoryBus',
        this.prefix,
        'advisory',
        domainAccounts,
      );
    `;
    const result = parseStack(src);
    assert.deepEqual(result.raw.resolvedBuses, ['advisory']);
  });

  it('detects UserPool (web pattern)', () => {
    const src = `const userPool = new UserPool(this, 'UserPool', { userPoolName: 'pool' });`;
    const result = parseStack(src);
    assert.equal(result.raw.userPools.length, 1);
  });

  it('detects Distribution (web pattern)', () => {
    const src = `const dist = new Distribution(this, 'Distribution', {});`;
    const result = parseStack(src);
    assert.equal(result.raw.distributions.length, 1);
  });

  it('detects standalone NodejsFunction', () => {
    const src = `
      const routeOrderFn = new NodejsFunction(this, 'RouteOrderFn', {
        entry: join(__dirname, 'handlers', 'route-order.ts'),
      });
    `;
    const result = parseStack(src);
    assert.equal(result.raw.lambdas.length, 1);
    assert.equal(result.raw.lambdas[0].id, 'RouteOrderFn');
  });

  it('detects AdapterSchedule', () => {
    const src = `new AdapterSchedule(this, 'FetchSchedule', { target: fetchTrigger });`;
    const result = parseStack(src);
    assert.equal(result.raw.schedules.length, 1);
  });

  it('detects MfeBucket with mfeKey', () => {
    const src = `new MfeBucket(this, 'MfeBucket', { mfeKey: 'dashboard' });`;
    const result = parseStack(src);
    assert.equal(result.raw.mfeBuckets.length, 1);
    assert.equal(result.raw.mfeBuckets[0].mfeKey, 'dashboard');
  });
});

describe('generateC3 — Broadcaster + MfeBucket', () => {
  const src = `
    const state = new State(this, 'State');
    const facade = new Facade(this, 'Facade', { state, jsResolvers: discoverJsResolvers(__dirname) });
    const ingress = new Ingress(this, 'Ingress', { state, eventTypes: ['BALANCE_UPDATED'] });
    const broadcaster = new Broadcaster(this, 'DashboardBroadcaster', {
      state,
      entry: join(__dirname, 'handlers', 'dashboard-publisher.ts'),
      facade,
    });
    new MfeBucket(this, 'MfeBucket', { mfeKey: 'dashboard' });
  `;

  it('renders a Broadcaster construct block', () => {
    const d2 = generateC3('dashboard-bff', 'investor', parseStack(src));
    assert.ok(d2.includes('broadcaster: "Broadcaster\\n[DashboardBroadcaster]"'));
    assert.ok(d2.includes('publisher: "Lambda"'));
  });

  it('wires State.stream → Broadcaster → AppSync flows', () => {
    const d2 = generateC3('dashboard-bff', 'investor', parseStack(src));
    assert.ok(d2.includes('state.stream -> broadcaster.publisher: CDC'));
    assert.ok(d2.includes('broadcaster.publisher -> facade.appsync: Broadcast'));
  });

  it('tags the service subtitle with Real-Time Push', () => {
    const d2 = generateC3('dashboard-bff', 'investor', parseStack(src));
    assert.ok(d2.includes('Real-Time Push'));
  });

  it('renders the MFE bundle bucket node', () => {
    const d2 = generateC3('dashboard-bff', 'investor', parseStack(src));
    assert.ok(d2.includes('mfe-bundle: "MFE Bundle\\n[/dashboard · via shared CDN]"'));
  });
});

describe('serviceLabel', () => {
  it('expands -mfe suffix to MFE', () => {
    assert.equal(serviceLabel('investor-mfe'), 'Investor\\nMFE');
    assert.equal(serviceLabel('dashboard-mfe'), 'Dashboard\\nMFE');
    assert.equal(serviceLabel('onboarding-mfe'), 'Onboarding\\nMFE');
  });
});

describe('generateC1 with mfes', () => {
  const baseDomains = ['advisory', 'execution', 'investor', 'ledger'];
  const mfes = [
    { mfe: 'investor-mfe', bff: 'investor-bff', domain: 'investor', route: '/investor' },
    { mfe: 'dashboard-mfe', bff: 'dashboard-bff', domain: 'investor', route: '/dashboard' },
    { mfe: 'onboarding-mfe', bff: 'onboarding-bff', domain: 'investor', route: '/onboarding' },
    { mfe: 'advisory-mfe', bff: 'advisory-bff', domain: 'advisory', route: '/advisory' },
    { mfe: 'ledger-mfe', bff: 'ledger-bff', domain: 'ledger', route: '/ledger' },
  ];
  const systemMeta = { name: 'Nestfolio', description: '' };

  it('includes web-app node inside system boundary', () => {
    const d2 = generateC1({ domains: baseDomains, mfes, systemMeta });
    assert.ok(d2.includes('web-app:'));
    assert.ok(d2.includes('Nestfolio Web App'));
    assert.ok(d2.includes('class: frontend'));
  });

  it('adds user → web-app edge', () => {
    const d2 = generateC1({ domains: baseDomains, mfes, systemMeta });
    assert.ok(d2.includes('investor-user -> nestfolio.web-app'));
  });

  it('adds web-app → domain edges for domains with MFEs', () => {
    const d2 = generateC1({ domains: baseDomains, mfes, systemMeta });
    assert.ok(d2.includes('nestfolio.web-app -> nestfolio.investor-domain'));
    assert.ok(d2.includes('nestfolio.web-app -> nestfolio.advisory-domain'));
    assert.ok(d2.includes('nestfolio.web-app -> nestfolio.ledger-domain'));
  });

  it('does NOT add web-app → execution-domain edge', () => {
    const d2 = generateC1({ domains: baseDomains, mfes, systemMeta });
    assert.ok(!d2.includes('nestfolio.web-app -> nestfolio.execution-domain'));
  });

  it('does NOT include old direct user ↔ domain edge', () => {
    const d2 = generateC1({ domains: baseDomains, mfes, systemMeta });
    assert.ok(!d2.includes('<-> investor-user'));
  });
});

describe('generateC2 with mfes', () => {
  let investorServices, parsedStacks, mfes;

  before(() => {
    const allServices = discoverServices();
    mfes = discoverMfes(allServices);
    investorServices = allServices.filter(s => s.domain === 'investor');
    parsedStacks = new Map();
    for (const svc of investorServices) {
      parsedStacks.set(svc.service, parseStack(readFileSync(svc.stackPath, 'utf-8')));
    }
  });

  it('includes MFE nodes for investor domain', () => {
    const d2 = generateC2('investor', investorServices, parsedStacks, {
      mfes: mfes.filter(m => m.domain === 'investor'),
    });
    assert.ok(d2.includes('investor-mfe:'));
    assert.ok(d2.includes('Dashboard\\nMFE'));
    assert.ok(d2.includes('Onboarding\\nMFE'));
    assert.ok(d2.includes('class: frontend'));
  });

  it('adds GraphQL edges from MFEs to BFFs', () => {
    const d2 = generateC2('investor', investorServices, parsedStacks, {
      mfes: mfes.filter(m => m.domain === 'investor'),
    });
    assert.ok(d2.includes('investor-mfe -> investor-bff'));
    assert.ok(d2.includes('dashboard-mfe -> dashboard-bff'));
    assert.ok(d2.includes('onboarding-mfe -> onboarding-bff'));
    assert.ok(d2.includes('GraphQL'));
  });

  it('excludes investor-web from C2', () => {
    const d2 = generateC2('investor', investorServices, parsedStacks, {
      mfes: mfes.filter(m => m.domain === 'investor'),
    });
    assert.ok(!d2.includes('investor-web:'));
    assert.ok(!d2.includes('Investor Web'));
  });

  it('excludes investor-web C3 layer import', () => {
    const d2 = generateC2('investor', investorServices, parsedStacks, {
      mfes: mfes.filter(m => m.domain === 'investor'),
    });
    assert.ok(!d2.includes('c3-investor-web'));
  });

  it('includes 1 MFE for advisory domain', () => {
    const allServices = discoverServices();
    const advisoryServices = allServices.filter(s => s.domain === 'advisory');
    const advStacks = new Map();
    for (const svc of advisoryServices) {
      advStacks.set(svc.service, parseStack(readFileSync(svc.stackPath, 'utf-8')));
    }
    const d2 = generateC2('advisory', advisoryServices, advStacks, {
      mfes: mfes.filter(m => m.domain === 'advisory'),
    });
    assert.ok(d2.includes('advisory-mfe:'));
    assert.ok(d2.includes('advisory-mfe -> advisory-bff'));
  });

  it('includes 0 MFEs for execution domain', () => {
    const allServices = discoverServices();
    const execServices = allServices.filter(s => s.domain === 'execution');
    const execStacks = new Map();
    for (const svc of execServices) {
      execStacks.set(svc.service, parseStack(readFileSync(svc.stackPath, 'utf-8')));
    }
    const d2 = generateC2('execution', execServices, execStacks, {
      mfes: mfes.filter(m => m.domain === 'execution'),
    });
    assert.ok(!d2.includes('-mfe:'));
    assert.ok(!d2.includes('class: frontend'));
  });
});
