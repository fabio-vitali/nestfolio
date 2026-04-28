import * as path from 'path';
import { Construct } from 'constructs';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Duration } from 'aws-cdk-lib';
import { UserPool, UserPoolClient } from 'aws-cdk-lib/aws-cognito';
import { ServiceStack, ServiceStackProps, State, Egress } from '@nestfolio/cdk-constructs/core';
import { ONBOARDING_COMPLETED, GO_LIVE_CONFIRMED } from './domain/events';
import { defaultLambdaProps, NamingService } from '@nestfolio/cdk-constructs/utils';
import {
  AgentRuntime, KnowledgeBase, MfeBucket,
  BedrockUsageAlarms, importCostAlertTopic,
} from '@nestfolio/cdk-constructs/extensions';

export class OnboardingBffStack extends ServiceStack {
  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, { ...props, serviceDir: __dirname });

    const state = new State(this, 'State');

    // Egress — CDC for ONBOARDING_COMPLETED and GO_LIVE_CONFIRMED
    new Egress(this, 'Egress', {
      state,
      eventTypes: {
        'OnboardingCompleted': { insert: ONBOARDING_COMPLETED },
        'GoLiveConfirmed': { insert: GO_LIVE_CONFIRMED },
      },
    });

    new MfeBucket(this, 'MfeBucket', { mfeKey: 'onboarding' });

    // Model IDs from SSM (shared with advisory services)
    const advisoryHubNaming = new NamingService({ prefix: props.prefix, subsystem: 'advisory', service: 'advisory-hub' });
    const sonnetModelId = StringParameter.valueForStringParameter(
      this, advisoryHubNaming.ssmParameterPath('models/sonnet'),
    );

    // Knowledge Base for product documentation RAG
    const knowledgeBase = new KnowledgeBase(this, 'OnboardingKB', {
      kbName: 'nestfolio-docs',
      description: 'Nestfolio product documentation for onboarding agent',
    });

    // Lambda handler for RAG search tool
    const searchKbFn = new NodejsFunction(this, 'SearchKbFn', {
      ...defaultLambdaProps(this),
      entry: path.join(__dirname, 'agent/tools/search-kb.handler.ts'),
      handler: 'handler',
      timeout: Duration.seconds(15),
      environment: {
        KNOWLEDGE_BASE_ID: knowledgeBase.knowledgeBaseId,
      },
    });

    searchKbFn.addToRolePolicy(knowledgeBase.triggerSyncPolicy());

    // Import the investor User Pool + Web Client published by investor-web
    // (subsystem-scoped paths — see services/investor/investor-web/src/service.stack.ts:127-134).
    const userPoolId = StringParameter.valueForStringParameter(
      this, `/nestfolio/${props.prefix}-investor/auth/userPoolId`,
    );
    const userPoolClientId = StringParameter.valueForStringParameter(
      this, `/nestfolio/${props.prefix}-investor/auth/userPoolClientId`,
    );
    const investorUserPool = UserPool.fromUserPoolId(this, 'InvestorUserPool', userPoolId);
    const investorUserPoolClient = UserPoolClient.fromUserPoolClientId(
      this, 'InvestorUserPoolClient', userPoolClientId,
    );

    // AgentRuntime — uses own table.
    // idleTimeout/maxLifetime tightened from defaults (15min/4h) after the
    // 2026-04-21 cost spike. Onboarding is short-session Q&A; nothing legitimate
    // keeps a microVM warm beyond a few minutes idle or beyond a single hour.
    const agentRuntime = new AgentRuntime(this, 'OnboardingAgent', {
      runtimeName: 'onboarding_agent',
      agentCodePath: path.join(__dirname, '..', 'agents', 'onboarding'),
      description: 'Conversational onboarding agent for investor onboarding',
      modelIds: [sonnetModelId],
      state,
      userPool: investorUserPool,
      userPoolClients: [investorUserPoolClient],
      idleTimeout: Duration.minutes(5),
      maxLifetime: Duration.hours(1),
      toolTargets: [{
        name: 'search_knowledge_base',
        description: 'Search Nestfolio documentation to answer user questions',
        handler: searchKbFn,
        schemaPath: path.join(__dirname, 'agent/tools/search-kb.schema.json'),
      }],
      environmentVariables: {
        TABLE_NAME: state.getTable().tableName,
        KNOWLEDGE_BASE_ID: knowledgeBase.knowledgeBaseId,
        AGENT_RUNTIME: 'true',
        EVENT_BUS_NAME: this.eventBus.eventBusName,
      },
    });
    this.eventBus.grantPutEventsTo(agentRuntime.runtime.grantPrincipal);

    // SSM-published runtime target. Pattern mirrors
    // services/advisory/advisory-narrative-ctrl/src/service.stack.ts:99-107.
    // Defaults to the real AgentCore runtime ARN; future consumers
    // (proxy Lambda, BFF resolver, smoke scripts) discover it via SSM.
    new StringParameter(this, 'AgentRuntimeUrlParam', {
      parameterName: `/nestfolio/${props.prefix}-onboarding-bff/agent/runtimeUrl`,
      stringValue: agentRuntime.runtime.agentRuntimeArn,
    });

    // Per-service Bedrock usage alarms (P1 — 2026-04-28 cost safeguards).
    // Reuses CostControls' SNS topic via SSM lookup (path published by
    // investor-hub stack). Onboarding agent invokes Sonnet (or Haiku
    // under AGENT_MODEL_OVERRIDE) — alarm both candidate models.
    const haikuModelId = StringParameter.valueForStringParameter(
      this, advisoryHubNaming.ssmParameterPath('models/haiku'),
    );
    new BedrockUsageAlarms(this, 'BedrockAlarms', {
      serviceName: 'onboarding-bff',
      modelIds: [sonnetModelId, haikuModelId],
      alertTopic: importCostAlertTopic(
        this, 'CostAlertTopic',
        `/nestfolio/${props.prefix}-investor/cost-controls/alertTopicArn`,
      ),
    });
  }
}
