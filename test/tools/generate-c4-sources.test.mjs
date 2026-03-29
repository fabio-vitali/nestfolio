import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { discoverServices, parseStack } from '../../tools/generate-c4-sources.mjs';

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
