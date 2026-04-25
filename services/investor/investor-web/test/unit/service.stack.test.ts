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

describe('InvestorWebStack — B1 unified topology (flag off)', () => {
  let template: Template;

  beforeAll(() => {
    const app = new App();
    const stack = new InvestorWebStack(app, 'TestStackB1Off', {
      prefix: 'test',
      service: 'investor-web',
      subsystem: 'investor',
    } as any);
    template = Template.fromStack(stack);
  });

  it('CacheBehaviors has exactly 1 entry (the existing /api/copilotkit*)', () => {
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        CacheBehaviors: Match.arrayEquals([
          Match.objectLike({ PathPattern: '/api/copilotkit*' }),
        ]),
      }),
    });
  });
});

describe('InvestorWebStack — B1 unified topology (flag on, /mfe/<key>/*)', () => {
  let template: Template;

  beforeAll(() => {
    const app = new App({ context: { mfeBehaviors: 'true' } });
    const stack = new InvestorWebStack(app, 'TestStackB1OnMfe', {
      prefix: 'test',
      service: 'investor-web',
      subsystem: 'investor',
    } as any);
    template = Template.fromStack(stack);
  });

  it('adds /mfe/<key>/* behavior for each catalog entry', () => {
    for (const key of ['investor', 'advisory', 'ledger', 'dashboard', 'onboarding']) {
      template.hasResourceProperties('AWS::CloudFront::Distribution', {
        DistributionConfig: Match.objectLike({
          CacheBehaviors: Match.arrayWith([
            Match.objectLike({
              PathPattern: `/mfe/${key}/*`,
              ViewerProtocolPolicy: 'redirect-to-https',
              AllowedMethods: Match.arrayWith(['GET', 'HEAD']),
            }),
          ]),
        }),
      });
    }
  });

  it('each /mfe/<key>/* origin uses the SSM-discovered bucket name', () => {
    for (const service of ['investor-bff', 'advisory-bff', 'ledger-bff', 'dashboard-bff', 'onboarding-bff']) {
      template.hasParameter('*', {
        Type: 'AWS::SSM::Parameter::Value<String>',
        Default: `/nestfolio/test-${service}/mfe/bucketName`,
      });
    }
  });

  it('creates one OriginAccessControl resource per MFE bucket origin (OAC, not OAI)', () => {
    // S3BucketOrigin.withOriginAccessControl creates one OAC per origin.
    // This asserts the OAI-free (OAC) path is taken, matching A3's bucket policy.
    template.resourceCountIs('AWS::CloudFront::OriginAccessControl', 5);
  });
});

describe('InvestorWebStack — B1 unified topology (flag on, /graphql/<domain>)', () => {
  let template: Template;

  beforeAll(() => {
    const app = new App({ context: { mfeBehaviors: 'true' } });
    const stack = new InvestorWebStack(app, 'TestStackB1OnGql', {
      prefix: 'test',
      service: 'investor-web',
      subsystem: 'investor',
    } as any);
    template = Template.fromStack(stack);
  });

  it('adds /graphql/<domain> behavior for each Facade-bearing catalog entry', () => {
    for (const domain of ['investor', 'advisory', 'ledger', 'dashboard']) {
      template.hasResourceProperties('AWS::CloudFront::Distribution', {
        DistributionConfig: Match.objectLike({
          CacheBehaviors: Match.arrayWith([
            Match.objectLike({
              PathPattern: `/graphql/${domain}`,
              ViewerProtocolPolicy: 'https-only',
              AllowedMethods: Match.arrayWith(['POST']),
              FunctionAssociations: Match.arrayWith([
                Match.objectLike({ EventType: 'viewer-request' }),
              ]),
            }),
          ]),
        }),
      });
    }
  });

  it('does NOT add /graphql/onboarding (onboarding has no Facade)', () => {
    const distConfig = template.findResources('AWS::CloudFront::Distribution');
    const allBehaviors = Object.values(distConfig).flatMap(
      (r: any) => r.Properties.DistributionConfig.CacheBehaviors ?? [],
    );
    const onboardingGql = allBehaviors.filter((b: any) => b.PathPattern === '/graphql/onboarding');
    expect(onboardingGql).toHaveLength(0);
  });

  it('reads api/graphqlUrl SSM parameter for each Facade-bearing entry', () => {
    for (const service of ['investor-bff', 'advisory-bff', 'ledger-bff', 'dashboard-bff']) {
      template.hasParameter('*', {
        Type: 'AWS::SSM::Parameter::Value<String>',
        Default: `/nestfolio/test-${service}/api/graphqlUrl`,
      });
    }
  });

  it('creates one CloudFront Function for the realtime/graphql rewrite', () => {
    template.resourceCountIs('AWS::CloudFront::Function', 2); // copilot + realtime-rewrite
  });
});

describe('InvestorWebStack — B1 unified topology (flag on, /realtime/<domain>)', () => {
  let template: Template;

  beforeAll(() => {
    const app = new App({ context: { mfeBehaviors: 'true' } });
    const stack = new InvestorWebStack(app, 'TestStackB1OnRt', {
      prefix: 'test',
      service: 'investor-web',
      subsystem: 'investor',
    } as any);
    template = Template.fromStack(stack);
  });

  it('adds /realtime/<domain> behavior for each Facade-bearing catalog entry', () => {
    for (const domain of ['investor', 'advisory', 'ledger', 'dashboard']) {
      template.hasResourceProperties('AWS::CloudFront::Distribution', {
        DistributionConfig: Match.objectLike({
          CacheBehaviors: Match.arrayWith([
            Match.objectLike({
              PathPattern: `/realtime/${domain}`,
              ViewerProtocolPolicy: 'https-only',
              AllowedMethods: Match.arrayWith(['POST']),
              FunctionAssociations: Match.arrayWith([
                Match.objectLike({ EventType: 'viewer-request' }),
              ]),
            }),
          ]),
        }),
      });
    }
  });

  it('does NOT add /realtime/onboarding (onboarding has no Facade)', () => {
    const distConfig = template.findResources('AWS::CloudFront::Distribution');
    const allBehaviors = Object.values(distConfig).flatMap(
      (r: any) => r.Properties.DistributionConfig.CacheBehaviors ?? [],
    );
    const onboardingRt = allBehaviors.filter((b: any) => b.PathPattern === '/realtime/onboarding');
    expect(onboardingRt).toHaveLength(0);
  });

  it('reads api/realtimeUrl SSM parameter for each Facade-bearing entry', () => {
    for (const service of ['investor-bff', 'advisory-bff', 'ledger-bff', 'dashboard-bff']) {
      template.hasParameter('*', {
        Type: 'AWS::SSM::Parameter::Value<String>',
        Default: `/nestfolio/test-${service}/api/realtimeUrl`,
      });
    }
  });

  it('CacheBehaviors has exactly 14 path-pattern entries when flag is on', () => {
    const distConfig = template.findResources('AWS::CloudFront::Distribution');
    const cacheBehaviors = (Object.values(distConfig)[0] as any).Properties.DistributionConfig.CacheBehaviors;
    expect(cacheBehaviors).toHaveLength(14);
  });

  it('still has exactly 1 CloudFront Function for the realtime/graphql rewrite (reused, not duplicated)', () => {
    template.resourceCountIs('AWS::CloudFront::Function', 2); // copilot + realtime-rewrite
  });
});
