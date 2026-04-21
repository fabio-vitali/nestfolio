/* eslint-disable @typescript-eslint/no-explicit-any */
import { join } from 'path';
import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { AdvisoryCtrlStack } from '../../src/service.stack';

describe('AdvisoryCtrlStack', () => {
  let template: Template;

  beforeAll(() => {
    const app = new App({ context: { prefix: 'test' } });
    const stack = new AdvisoryCtrlStack(app, 'TestStack', {
      prefix: 'test',
      service: 'advisory-ctrl',
      subsystem: 'advisory',
      serviceDir: join(__dirname, '..', '..', 'src'),
    });
    template = Template.fromStack(stack);
  });

  it('grants events:PutEvents to the AgentRuntime execution role (in addition to any tool-publisher grants)', () => {
    // Bind the assertion to the AgentRuntime role's logical ID so a
    // pre-existing tool-publisher grant on a separate role cannot mask a
    // missing runtime grant.
    const roles = template.findResources('AWS::IAM::Role');
    const agentRuntimeRoleId = Object.keys(roles).find((id) => /AgentRuntime.*Role/.test(id));
    expect(agentRuntimeRoleId).toBeDefined();

    const policies = template.findResources('AWS::IAM::Policy');
    const runtimeGrant = Object.values(policies).find((p: any) => {
      const stmts = (p.Properties?.PolicyDocument?.Statement ?? []) as Array<Record<string, unknown>>;
      const grantsPutEvents = stmts.some((s) => {
        const actions = Array.isArray(s['Action']) ? s['Action'] : [s['Action']];
        return actions.includes('events:PutEvents') && s['Effect'] === 'Allow';
      });
      const attachedRoles = (p.Properties?.Roles ?? []) as Array<{ Ref?: string }>;
      const attachedToRuntime = attachedRoles.some((r) => r.Ref === agentRuntimeRoleId);
      return grantsPutEvents && attachedToRuntime;
    });

    expect(runtimeGrant).toBeDefined();
  });
});
