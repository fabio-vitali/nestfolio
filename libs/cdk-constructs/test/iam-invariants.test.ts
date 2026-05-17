/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Cross-cutting CDK IAM invariant for the advisory decision cycle.
 *
 * After the agent-precomputation refactor, only decision-workflow-ctrl's
 * CallbackIngress role should hold `states:SendTaskSuccess`/`SendTaskFailure`.
 * The four agent services (investor-profile, market-intelligence,
 * portfolio-engine, advisory-narrative) must NOT grant SF callback IAM —
 * they emit completion events on the EventBridge bus and DWC's SF state
 * machine listens via its own CallbackIngress.
 *
 * Per-service stack tests already assert the negation per service. This
 * workspace-wide test is the cross-cutting backstop.
 *
 * The eslint-disable below is intentional: this file is a workspace-wide
 * backstop that *must* import sibling service stack classes to synth them
 * and inspect their CloudFormation IAM policies. The structural circular
 * dependency exists only in this test (no production code in cdk-constructs
 * depends on any service), so the boundary rule is suppressed here only.
 */
/* eslint-disable @nx/enforce-module-boundaries */
import { join } from 'path';
import { App, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { InvestorProfileCtrlStack } from '@nestfolio/investor-profile-ctrl/stack';
import { MarketIntelligenceCtrlStack } from '@nestfolio/market-intelligence-ctrl/stack';
import { PortfolioEngineCtrlStack } from '@nestfolio/portfolio-engine-ctrl/stack';
import { AdvisoryNarrativeCtrlStack } from '@nestfolio/advisory-narrative-ctrl/stack';
import { DecisionWorkflowCtrlStack } from '@nestfolio/decision-workflow-ctrl/stack';

const SF_CALLBACK_ACTIONS = ['states:SendTaskSuccess', 'states:SendTaskFailure'];

function policyGrantsSfActions(policy: any): string[] {
  const statements: any[] = policy?.Properties?.PolicyDocument?.Statement ?? [];
  const grants: string[] = [];
  for (const stmt of statements) {
    const actions: string[] = Array.isArray(stmt.Action)
      ? stmt.Action
      : stmt.Action
        ? [stmt.Action]
        : [];
    for (const a of SF_CALLBACK_ACTIONS) {
      if (actions.includes(a)) grants.push(a);
    }
  }
  return grants;
}

function serviceDirFor(service: string): string {
  return join(__dirname, '..', '..', '..', 'services', 'advisory', service, 'src');
}

type ServiceStackCtor = new (
  scope: App,
  id: string,
  props: {
    prefix: string;
    service: string;
    subsystem: string;
    serviceDir: string;
  },
) => Stack;

const AGENT_SERVICES: Array<[string, ServiceStackCtor]> = [
  ['investor-profile-ctrl', InvestorProfileCtrlStack as unknown as ServiceStackCtor],
  ['market-intelligence-ctrl', MarketIntelligenceCtrlStack as unknown as ServiceStackCtor],
  ['portfolio-engine-ctrl', PortfolioEngineCtrlStack as unknown as ServiceStackCtor],
  ['advisory-narrative-ctrl', AdvisoryNarrativeCtrlStack as unknown as ServiceStackCtor],
];

describe.each(AGENT_SERVICES)(
  'agent service %s — no states:SendTaskSuccess / SendTaskFailure grants',
  (service, StackClass) => {
    it(`forbids SF callback IAM grants in ${service}`, () => {
      const app = new App();
      const stack = new StackClass(app, 'TestStack', {
        prefix: 'test',
        service,
        subsystem: 'advisory',
        serviceDir: serviceDirFor(service),
      });
      const template = Template.fromStack(stack);
      const policies = template.findResources('AWS::IAM::Policy');
      const violations: string[] = [];
      for (const [logicalId, policy] of Object.entries(policies)) {
        const grants = policyGrantsSfActions(policy);
        if (grants.length > 0) {
          violations.push(`${logicalId}: ${grants.join(', ')}`);
        }
      }
      expect(violations).toEqual([]);
    });
  },
);

describe('decision-workflow-ctrl — states:SendTaskSuccess/Failure granted only to CallbackIngress role', () => {
  it('every IAM policy that grants SF callback actions belongs to CallbackIngress', () => {
    const app = new App();
    const stack = new DecisionWorkflowCtrlStack(app, 'TestStack', {
      prefix: 'test',
      service: 'decision-workflow-ctrl',
      subsystem: 'advisory',
      serviceDir: serviceDirFor('decision-workflow-ctrl'),
    });
    const template = Template.fromStack(stack);
    const policies = template.findResources('AWS::IAM::Policy');

    const grantingPolicies: string[] = [];
    const offenders: string[] = [];
    for (const [logicalId, policy] of Object.entries(policies)) {
      const grants = policyGrantsSfActions(policy);
      if (grants.length === 0) continue;
      grantingPolicies.push(logicalId);
      if (!/CallbackIngress/.test(logicalId)) {
        offenders.push(`${logicalId}: ${grants.join(', ')}`);
      }
    }
    // At least one policy must grant the actions (the CallbackIngress one).
    expect(grantingPolicies.length).toBeGreaterThan(0);
    // No policy outside CallbackIngress may grant them.
    expect(offenders).toEqual([]);
  });
});
