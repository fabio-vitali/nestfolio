import { App, Stack } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { EventBus } from 'aws-cdk-lib/aws-events';
import {
  SharedParameter,
  CrossAccountBusPolicy,
  getDomainAccounts,
  getConsumerAccountIds,
  resolveBusArn,
} from '../../src/extensions/cross-account';

describe('SharedParameter', () => {
  it('creates Standard tier parameter when no consumer accounts', () => {
    const app = new App();
    const stack = new Stack(app, 'TestStack');

    new SharedParameter(stack, 'Param', {
      parameterName: '/nestfolio/dev-investor/event-hub/busArn',
      stringValue: 'arn:aws:events:us-east-1:111111111111:event-bus/dev-investor-event-bus',
      description: 'Test bus ARN',
    });

    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::SSM::Parameter', {
      Type: 'String',
      Name: '/nestfolio/dev-investor/event-hub/busArn',
    });
    // No Advanced tier, no RAM share
    template.resourceCountIs('AWS::RAM::ResourceShare', 0);
  });

  it('creates Advanced tier parameter with RAM share when consumer accounts provided', () => {
    const app = new App();
    const stack = new Stack(app, 'TestStack');

    new SharedParameter(stack, 'Param', {
      parameterName: '/nestfolio/dev-investor/event-hub/busArn',
      stringValue: 'arn:aws:events:us-east-1:111111111111:event-bus/dev-investor-event-bus',
      description: 'Test bus ARN',
      consumerAccountIds: ['222222222222', '333333333333'],
    });

    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::SSM::Parameter', {
      Tier: 'Advanced',
    });
    template.hasResourceProperties('AWS::RAM::ResourceShare', {
      Principals: ['222222222222', '333333333333'],
      AllowExternalPrincipals: false,
    });
  });

  it('creates no RAM share when consumer accounts list is empty', () => {
    const app = new App();
    const stack = new Stack(app, 'TestStack');

    new SharedParameter(stack, 'Param', {
      parameterName: '/nestfolio/dev-investor/event-hub/busArn',
      stringValue: 'some-arn',
      description: 'Test',
      consumerAccountIds: [],
    });

    const template = Template.fromStack(stack);
    template.resourceCountIs('AWS::RAM::ResourceShare', 0);
  });
});

describe('CrossAccountBusPolicy', () => {
  it('creates event bus policy allowing PutEvents from consumer accounts', () => {
    const app = new App();
    const stack = new Stack(app, 'TestStack', {
      env: { account: '111111111111', region: 'us-east-1' },
    });
    const bus = new EventBus(stack, 'Bus', { eventBusName: 'test-bus' });

    new CrossAccountBusPolicy(stack, 'Policy', {
      eventBus: bus,
      consumerAccountIds: ['222222222222', '333333333333'],
    });

    const template = Template.fromStack(stack);
    const policies = template.findResources('AWS::Events::EventBusPolicy');
    const policyKey = Object.keys(policies)[0];
    expect(policyKey).toBeDefined();
    const props = policies[policyKey].Properties;
    expect(props.StatementId).toBe('AllowCrossAccountPutEvents');
    expect(props.Statement.Effect).toBe('Allow');
    expect(props.Statement.Action).toBe('events:PutEvents');
    expect(props.Statement.Principal.AWS).toEqual([
      'arn:aws:iam::222222222222:root',
      'arn:aws:iam::333333333333:root',
    ]);
  });
});

describe('getDomainAccounts', () => {
  it('returns undefined when no context set', () => {
    const app = new App();
    const stack = new Stack(app, 'TestStack');
    expect(getDomainAccounts(stack)).toBeUndefined();
  });

  it('returns domain account map from context', () => {
    const domainAccounts = {
      investor: '111111111111',
      advisory: '222222222222',
      execution: '333333333333',
      ledger: '333333333333',
    };
    const app = new App({ context: { domainAccounts } });
    const stack = new Stack(app, 'TestStack');
    expect(getDomainAccounts(stack)).toEqual(domainAccounts);
  });
});

describe('getConsumerAccountIds', () => {
  it('returns empty array when no domain accounts', () => {
    const app = new App();
    const stack = new Stack(app, 'TestStack', {
      env: { account: '111111111111', region: 'us-east-1' },
    });
    expect(getConsumerAccountIds(stack, undefined)).toEqual([]);
  });

  it('returns unique account IDs excluding current stack account', () => {
    const app = new App();
    const stack = new Stack(app, 'TestStack', {
      env: { account: '111111111111', region: 'us-east-1' },
    });
    const domainAccounts = {
      investor: '111111111111',
      advisory: '222222222222',
      execution: '333333333333',
      ledger: '333333333333',
    };
    const result = getConsumerAccountIds(stack, domainAccounts);
    expect(result).toEqual(expect.arrayContaining(['222222222222', '333333333333']));
    expect(result).not.toContain('111111111111');
    expect(result).toHaveLength(2);
  });
});

describe('resolveBusArn', () => {
  it('uses valueForStringParameter in single-account mode', () => {
    const app = new App();
    const stack = new Stack(app, 'TestStack');

    resolveBusArn(stack, 'InvestorBus', 'dev', 'investor');

    // In single-account mode, creates a CFN parameter (SSM dynamic reference)
    const template = Template.fromStack(stack);
    template.hasParameter('*', {
      Type: 'AWS::SSM::Parameter::Value<String>',
      Default: '/nestfolio/dev-investor/event-hub/busArn',
    });
    // No custom resources
    template.resourceCountIs('AWS::CloudFormation::CustomResource', 0);
  });

  it('uses AwsCustomResource for cross-account resolution', () => {
    const app = new App();
    const stack = new Stack(app, 'TestStack', {
      env: { account: '111111111111', region: 'us-east-1' },
    });

    const domainAccounts = {
      investor: '111111111111',
      advisory: '222222222222',
    };

    resolveBusArn(stack, 'AdvisoryBus', 'dev', 'advisory', domainAccounts);

    const template = Template.fromStack(stack);
    // Cross-account creates a custom resource
    template.hasResource('Custom::AWS', {
      Properties: Match.objectLike({
        Update: Match.serializedJson(
          Match.objectLike({
            service: 'SSM',
            action: 'getParameter',
          }),
        ),
      }),
    });
  });

  it('uses valueForStringParameter when domain account matches stack account', () => {
    const app = new App();
    const stack = new Stack(app, 'TestStack', {
      env: { account: '111111111111', region: 'us-east-1' },
    });

    const domainAccounts = {
      investor: '111111111111',
      advisory: '222222222222',
    };

    // Investor domain is same account — should use local SSM
    resolveBusArn(stack, 'InvestorBus', 'dev', 'investor', domainAccounts);

    const template = Template.fromStack(stack);
    template.hasParameter('*', {
      Type: 'AWS::SSM::Parameter::Value<String>',
      Default: '/nestfolio/dev-investor/event-hub/busArn',
    });
  });
});
