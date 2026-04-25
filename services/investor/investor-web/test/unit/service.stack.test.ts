/* eslint-disable @typescript-eslint/no-explicit-any */
import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { InvestorWebStack } from '../../src/service.stack';

describe('InvestorWebStack — CopilotKit bridge', () => {
  let template: Template;

  beforeAll(() => {
    const app = new App();
    const stack = new InvestorWebStack(app, 'TestStack', {
      prefix: 'test',
      service: 'investor-web',
      subsystem: 'investor',
    } as any);
    template = Template.fromStack(stack);
  });

  it('creates a CloudFront Function with the copilot-rewrite source baked in', () => {
    // FunctionCode is rendered as an `Fn::Sub` because the runtime ARN is a
    // deploy-time SSM token, so the code is not a plain string at synth.
    template.hasResourceProperties('AWS::CloudFront::Function', {
      FunctionConfig: Match.objectLike({ Runtime: 'cloudfront-js-1.0' }),
      FunctionCode: Match.anyValue(),
    });
  });

  it('creates an origin request policy forwarding Content-Type + session-id headers', () => {
    template.hasResourceProperties('AWS::CloudFront::OriginRequestPolicy', {
      OriginRequestPolicyConfig: Match.objectLike({
        HeadersConfig: {
          HeaderBehavior: 'whitelist',
          Headers: Match.arrayWith([
            'Content-Type',
            'x-amzn-bedrock-agentcore-runtime-session-id',
          ]),
        },
        CookiesConfig: { CookieBehavior: 'none' },
        QueryStringsConfig: { QueryStringBehavior: 'none' },
      }),
    });
  });

  it('creates a cache policy (minimum TTLs) that allowlists Authorization', () => {
    // CloudFront rejects Authorization in origin-request policies — it must be
    // attached to a cache policy instead. CloudFormation additionally rejects
    // HeaderBehavior when all TTLs are 0, so MaxTTL is set to 1s (harmless:
    // POSTs are never cached by CloudFront regardless of policy).
    template.hasResourceProperties('AWS::CloudFront::CachePolicy', {
      CachePolicyConfig: Match.objectLike({
        MinTTL: 0,
        DefaultTTL: 0,
        MaxTTL: 1,
        ParametersInCacheKeyAndForwardedToOrigin: Match.objectLike({
          HeadersConfig: {
            HeaderBehavior: 'whitelist',
            Headers: Match.arrayWith(['Authorization']),
          },
        }),
      }),
    });
  });

  it('creates a response headers policy with CORS allowing localhost:4200 and the distribution domain', () => {
    template.hasResourceProperties('AWS::CloudFront::ResponseHeadersPolicy', {
      ResponseHeadersPolicyConfig: Match.objectLike({
        CorsConfig: Match.objectLike({
          AccessControlAllowCredentials: false,
          AccessControlAllowHeaders: {
            Items: Match.arrayWith([
              'Authorization',
              'Content-Type',
              'x-amzn-bedrock-agentcore-runtime-session-id',
            ]),
          },
          AccessControlAllowMethods: { Items: Match.arrayWith(['POST', 'OPTIONS']) },
          AccessControlAllowOrigins: {
            Items: Match.arrayWith(['http://localhost:4200']),
          },
          OriginOverride: true,
        }),
      }),
    });
  });

  it('attaches a /api/copilotkit* cache behavior on the existing distribution', () => {
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        CacheBehaviors: Match.arrayWith([
          Match.objectLike({
            PathPattern: '/api/copilotkit*',
            TargetOriginId: Match.anyValue(),
            ViewerProtocolPolicy: 'https-only',
            // AllowedMethods.ALLOW_ALL → [GET, HEAD, OPTIONS, PUT, PATCH, POST, DELETE]
            // arrayWith enforces order, so we match in the order they appear.
            AllowedMethods: Match.arrayWith(['OPTIONS', 'POST']),
            FunctionAssociations: Match.arrayWith([
              Match.objectLike({ EventType: 'viewer-request' }),
            ]),
          }),
        ]),
        Origins: Match.arrayWith([
          Match.objectLike({ DomainName: 'bedrock-agentcore.us-east-1.amazonaws.com' }),
        ]),
      }),
    });
  });

  it('exports web/distributionId SSM parameter', () => {
    template.hasResourceProperties('AWS::SSM::Parameter', {
      Name: '/nestfolio/test-investor/web/distributionId',
    });
  });
});

describe('InvestorWebStack — runtime config SSM exports', () => {
  let template: Template;

  beforeAll(() => {
    const app = new App();
    const stack = new InvestorWebStack(app, 'TestStackRuntimeConfig', {
      prefix: 'test',
      service: 'investor-web',
      subsystem: 'investor',
    } as any);
    template = Template.fromStack(stack);
  });

  it('publishes auth/region for the runtime config producer', () => {
    template.hasResourceProperties('AWS::SSM::Parameter', {
      Name: '/nestfolio/test-investor/auth/region',
    });
  });
});
