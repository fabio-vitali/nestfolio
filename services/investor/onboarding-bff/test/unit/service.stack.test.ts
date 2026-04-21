/* eslint-disable @typescript-eslint/no-explicit-any */
import { join } from 'path';
import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { OnboardingBffStack } from '../../src/service.stack';

describe('OnboardingBffStack', () => {
  let template: Template;

  beforeAll(() => {
    const app = new App();
    const stack = new OnboardingBffStack(app, 'TestStack', {
      prefix: 'test',
      service: 'onboarding-bff',
      subsystem: 'investor',
      serviceDir: join(__dirname, '..', '..', 'src'),
    });
    template = Template.fromStack(stack);
  });

  it('grants events:PutEvents on the investor bus to the AgentRuntime execution role', () => {
    const policies = template.findResources('AWS::IAM::Policy', {
      Properties: {
        Roles: Match.arrayWith([
          Match.objectLike({ Ref: Match.stringLikeRegexp('.*OnboardingAgent.*|.*AgentRuntime.*') }),
        ]),
      },
    });
    expect(Object.keys(policies).length).toBeGreaterThan(0);

    const statements = Object.values(policies).flatMap(
      (p: any) => p.Properties.PolicyDocument.Statement ?? [],
    );
    const actions = statements.flatMap((s: { Action: string | string[] }) =>
      Array.isArray(s.Action) ? s.Action : [s.Action],
    );
    expect(actions).toContain('events:PutEvents');
  });
});
