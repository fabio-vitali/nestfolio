import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { discoverServices, parseStack, generateC3, generateC2, generateC1, generateGlobalStyles } from '../../tools/generate-c4-sources.mjs';

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

  it('detects Egress with publishableTypes', () => {
    const src = `new Egress(this, 'Egress', { state, publishableTypes: ['NormalizedEvent'] });`;
    const result = parseStack(src);
    assert.equal(result.constructs.egress.length, 1);
    assert.deepEqual(result.constructs.egress[0].publishableTypes, ['NormalizedEvent']);
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
});

describe('generateC3', () => {
  it('generates State group with DynamoDB + stream', () => {
    const parsed = {
      constructs: {
        state: [{ id: 'State', withBucket: false, withTable: true }],
        ingress: [], egress: [], facade: [], orchestration: [],
        agentRuntime: [], knowledgeBase: [], agentMemory: [],
      },
      raw: { eventBuses: [], archives: [], rules: [], lambdas: [],
             buckets: [], userPools: [], distributions: [], schedules: [], resolvedBuses: [] },
    };
    const d2 = generateC3('investor-ctrl', 'investor', parsed);
    assert.ok(d2.includes('state: "State"'));
    assert.ok(d2.includes('class: aws-dynamodb'));
    assert.ok(d2.includes('class: aws-ddb-stream'));
    assert.ok(d2.includes('table -> stream'));
  });

  it('generates Ingress group with EB Rule + SQS + Lambda + DLQ', () => {
    const parsed = {
      constructs: {
        state: [{ id: 'State', withBucket: false, withTable: true }],
        ingress: [{ id: 'Ingress', eventTypes: ['EVT_A', 'EVT_B'] }],
        egress: [], facade: [], orchestration: [],
        agentRuntime: [], knowledgeBase: [], agentMemory: [],
      },
      raw: { eventBuses: [], archives: [], rules: [], lambdas: [],
             buckets: [], userPools: [], distributions: [], schedules: [], resolvedBuses: [] },
    };
    const d2 = generateC3('investor-ctrl', 'investor', parsed);
    assert.ok(d2.includes('ingress: "Ingress"'));
    assert.ok(d2.includes('class: aws-eventbridge'));
    assert.ok(d2.includes('class: aws-sqs'));
    assert.ok(d2.includes('class: aws-lambda'));
    assert.ok(d2.includes('class: aws-dlq'));
    assert.ok(d2.includes('2 events'));
  });

  it('generates multiple Ingress groups with unique names', () => {
    const parsed = {
      constructs: {
        state: [{ id: 'State', withBucket: false, withTable: true }],
        ingress: [
          { id: 'ModeIngress', eventTypes: ['MODE_CHANGED'] },
          { id: 'CallbackIngress', eventTypes: ['FILLED', 'REJECTED'] },
        ],
        egress: [], facade: [], orchestration: [],
        agentRuntime: [], knowledgeBase: [], agentMemory: [],
      },
      raw: { eventBuses: [], archives: [], rules: [], lambdas: [],
             buckets: [], userPools: [], distributions: [], schedules: [], resolvedBuses: [] },
    };
    const d2 = generateC3('broker-ctrl', 'execution', parsed);
    assert.ok(d2.includes('mode-ingress: "ModeIngress"'));
    assert.ok(d2.includes('callback-ingress: "CallbackIngress"'));
  });

  it('generates Facade group with AppSync', () => {
    const parsed = {
      constructs: {
        state: [{ id: 'State', withBucket: false, withTable: true }],
        ingress: [],
        egress: [],
        facade: [{ id: 'Facade', hasJsResolvers: true, hasLambdaResolvers: false }],
        orchestration: [], agentRuntime: [], knowledgeBase: [], agentMemory: [],
      },
      raw: { eventBuses: [], archives: [], rules: [], lambdas: [],
             buckets: [], userPools: [], distributions: [], schedules: [], resolvedBuses: [] },
    };
    const d2 = generateC3('investor-bff', 'investor', parsed);
    assert.ok(d2.includes('facade: "Facade"'));
    assert.ok(d2.includes('class: aws-appsync'));
    assert.ok(d2.includes('class: aws-ssm'));
  });

  it('generates Orchestration group with Step Functions', () => {
    const parsed = {
      constructs: {
        state: [{ id: 'State', withBucket: false, withTable: true }],
        ingress: [], egress: [],  facade: [],
        orchestration: [{ id: 'OrderStateMachine', triggers: ['ORDER_SUBMITTED'] }],
        agentRuntime: [], knowledgeBase: [], agentMemory: [],
      },
      raw: { eventBuses: [], archives: [], rules: [], lambdas: [],
             buckets: [], userPools: [], distributions: [], schedules: [], resolvedBuses: [] },
    };
    const d2 = generateC3('broker-ctrl', 'execution', parsed);
    assert.ok(d2.includes('order-state-machine: "Orchestration"'));
    assert.ok(d2.includes('class: aws-stepfunctions'));
  });
});

describe('generateC3 — raw resources', () => {
  it('generates hub pattern (EventBus + Archive)', () => {
    const parsed = {
      constructs: { state: [], ingress: [], egress: [], facade: [],
                    orchestration: [], agentRuntime: [], knowledgeBase: [], agentMemory: [] },
      raw: {
        eventBuses: [{ id: 'InvestorBus' }],
        archives: [{ id: 'Archive' }],
        rules: [], lambdas: [], buckets: [], userPools: [],
        distributions: [], schedules: [], resolvedBuses: [],
      },
    };
    const d2 = generateC3('investor-hub', 'investor', parsed);
    assert.ok(d2.includes('class: aws-eventbridge'));
    assert.ok(d2.includes('class: aws-s3'));
    assert.ok(d2.includes('archive'));
  });

  it('generates cross-domain adapter pattern', () => {
    const parsed = {
      constructs: { state: [], ingress: [], egress: [], facade: [],
                    orchestration: [], agentRuntime: [], knowledgeBase: [], agentMemory: [] },
      raw: {
        eventBuses: [],
        archives: [],
        rules: [
          { id: 'ToAdvisory', isCrossDomain: true, eventTypes: [], targetBusVar: 'advisoryBus' },
          { id: 'ToExecution', isCrossDomain: true, eventTypes: [], targetBusVar: 'executionBus' },
        ],
        lambdas: [], buckets: [], userPools: [],
        distributions: [], schedules: [],
        resolvedBuses: ['investor', 'advisory', 'execution'],
      },
    };
    const d2 = generateC3('investor-adpt', 'investor', parsed);
    assert.ok(d2.includes('source'));
    assert.ok(d2.includes('to-advisory'));
    assert.ok(d2.includes('to-execution'));
  });

  it('generates web frontend pattern (Cognito + S3 + CloudFront)', () => {
    const parsed = {
      constructs: { state: [], ingress: [], egress: [], facade: [],
                    orchestration: [], agentRuntime: [], knowledgeBase: [], agentMemory: [] },
      raw: {
        eventBuses: [],
        archives: [],
        rules: [],
        lambdas: [{ id: 'PostConfirmation', varName: 'postConfirmation' }],
        buckets: [{ id: 'AssetsBucket' }],
        userPools: [{ id: 'UserPool' }],
        distributions: [{ id: 'Distribution' }],
        schedules: [], resolvedBuses: [],
      },
    };
    const d2 = generateC3('investor-web', 'investor', parsed);
    assert.ok(d2.includes('class: aws-cognito'));
    assert.ok(d2.includes('class: aws-s3'));
  });
});

describe('generateC1', () => {
  it('generates system context with 4 domains', () => {
    const domains = ['investor', 'advisory', 'execution', 'ledger'];
    const d2 = generateC1(domains);
    assert.ok(d2.includes('nestfolio:'));
    assert.ok(d2.includes('investor-domain'));
    assert.ok(d2.includes('advisory-domain'));
    assert.ok(d2.includes('execution-domain'));
    assert.ok(d2.includes('ledger-domain'));
    assert.ok(d2.includes('link: layers.c2-investor'));
  });

  it('generates inter-domain event flows', () => {
    const domains = ['investor', 'advisory', 'execution', 'ledger'];
    const d2 = generateC1(domains);
    assert.ok(d2.includes('investor-domain -> advisory-domain'));
    assert.ok(d2.includes('advisory-domain -> execution-domain'));
    assert.ok(d2.includes('execution-domain -> ledger-domain'));
    assert.ok(d2.includes('ledger-domain -> investor-domain'));
  });
});

describe('generateGlobalStyles', () => {
  it('includes all C1/C2 and AWS resource classes', () => {
    const d2 = generateGlobalStyles();
    assert.ok(d2.includes('person:'));
    assert.ok(d2.includes('system:'));
    assert.ok(d2.includes('domain:'));
    assert.ok(d2.includes('service:'));
    assert.ok(d2.includes('adapter:'));
    assert.ok(d2.includes('bus:'));
    assert.ok(d2.includes('aws-lambda:'));
    assert.ok(d2.includes('aws-dynamodb:'));
    assert.ok(d2.includes('aws-stepfunctions:'));
  });
});

describe('generateC2', () => {
  it('generates domain container with services and bus', () => {
    const services = [
      { service: 'investor-ctrl', domain: 'investor' },
      { service: 'investor-bff', domain: 'investor' },
      { service: 'investor-hub', domain: 'investor' },
      { service: 'investor-adpt', domain: 'investor' },
    ];
    const parsedStacks = new Map([
      ['investor-ctrl', { constructs: { state: [{ id: 'State' }], ingress: [{}], egress: [{}], facade: [], orchestration: [], agentRuntime: [], knowledgeBase: [], agentMemory: [] }, raw: { eventBuses: [], archives: [], rules: [], lambdas: [], buckets: [], userPools: [], distributions: [], schedules: [], resolvedBuses: [] } }],
      ['investor-bff', { constructs: { state: [{ id: 'State' }], ingress: [], egress: [], facade: [{ id: 'Facade' }], orchestration: [], agentRuntime: [], knowledgeBase: [], agentMemory: [] }, raw: { eventBuses: [], archives: [], rules: [], lambdas: [], buckets: [], userPools: [], distributions: [], schedules: [], resolvedBuses: [] } }],
      ['investor-hub', { constructs: { state: [], ingress: [], egress: [], facade: [], orchestration: [], agentRuntime: [], knowledgeBase: [], agentMemory: [] }, raw: { eventBuses: [{ id: 'InvestorBus' }], archives: [{}], rules: [], lambdas: [], buckets: [], userPools: [], distributions: [], schedules: [], resolvedBuses: [] } }],
      ['investor-adpt', { constructs: { state: [], ingress: [], egress: [], facade: [], orchestration: [], agentRuntime: [], knowledgeBase: [], agentMemory: [] }, raw: { eventBuses: [], archives: [], rules: [{ isCrossDomain: true }], lambdas: [], buckets: [], userPools: [], distributions: [], schedules: [], resolvedBuses: ['advisory'] } }],
    ]);
    const d2 = generateC2('investor', services, parsedStacks);
    assert.ok(d2.includes('Investor Domain'));
    assert.ok(d2.includes('investor-ctrl'));
    assert.ok(d2.includes('class: service'));
    assert.ok(d2.includes('investor-bus'));
    assert.ok(d2.includes('class: bus'));
    assert.ok(d2.includes('investor-adpt'));
    assert.ok(d2.includes('class: adapter'));
    assert.ok(d2.includes('link: layers.c3-investor-ctrl'));
    assert.ok(d2.includes('...@./c3/investor-ctrl.d2'));
  });
});
