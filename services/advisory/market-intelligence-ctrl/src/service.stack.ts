import { PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import { join } from 'path';
import { ServiceStack, ServiceStackProps, State, Ingress, Egress } from '@nestfolio/cdk-constructs/core';
import { MarketIntelligenceEventTypes } from './domain/events';
import { DecisionWorkflowEventTypes } from '@nestfolio/decision-workflow-ctrl/events';
import { YahooFinanceAdptEventTypes } from '@nestfolio/yahoo-finance-adpt/events';
import { MarketwatchAdptEventTypes } from '@nestfolio/marketwatch-adpt/events';
import { SecEdgarAdptEventTypes } from '@nestfolio/sec-edgar-adpt/events';
import { FredAdptEventTypes } from '@nestfolio/fred-adpt/events';
import { AlphaVantageAdptEventTypes } from '@nestfolio/alpha-vantage-adpt/events';
import {
  AgentRuntime, KnowledgeBase,
  BedrockUsageAlarms, importCostAlertTopic,
} from '@nestfolio/cdk-constructs/extensions';
import { agentProps, defaultLambdaProps, NamingService, PARAMS_AND_SECRETS_LAYER } from '@nestfolio/cdk-constructs/utils';

export class MarketIntelligenceCtrlStack extends ServiceStack {
  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, { ...props, serviceDir: __dirname });

    const state = new State(this, 'State');

    // Knowledge Base: Market Intelligence (S3 Vectors — managed by Bedrock)
    const kb = new KnowledgeBase(this, 'MarketKB', {
      kbName: 'market',
      description: 'Market news, sentiment, macro indicators from 5 feed sources',
    });

    // Ingress: trigger event + 5 feed ingestion events
    // Uses agentProps because the handler dispatches to Bedrock (Sonnet) via
    // AgentCore — invocations can take 50–130s (p95). Without this profile the
    // Lambda times out at 30s, leaving the SF task token unreturned.
    const ingress = new Ingress(this, 'Ingress', {
      state,
      profile: agentProps,
      lambdaProps: {
        paramsAndSecrets: PARAMS_AND_SECRETS_LAYER,
      },
      eventTypes: [
        DecisionWorkflowEventTypes.ANALYZE_MARKET,
        YahooFinanceAdptEventTypes.YAHOO_FINANCE_UPDATED,
        MarketwatchAdptEventTypes.MARKETWATCH_UPDATED,
        SecEdgarAdptEventTypes.SEC_8K_FILED,
        FredAdptEventTypes.FRED_INDICATORS_UPDATED,
        AlphaVantageAdptEventTypes.ALPHA_VANTAGE_NEWS_UPDATED,
      ],
    });

    // Egress: CDC events
    const egress = new Egress(this, 'Egress', {
      state,
      eventTypes: {
        'AgentInvocation': { insert: MarketIntelligenceEventTypes.MARKET_SIGNAL_DETECTED },
      },
    });

    // KB ingestion Lambda (separate from event-listener)
    const kbIngestionFn = new NodejsFunction(this, 'KBIngestion', {
      ...defaultLambdaProps(this),
      entry: join(__dirname, 'handlers', 'kb-ingestion-handler.ts'),
      environment: {
        KB_BUCKET: kb.bucket.bucketName,
        KB_ID: kb.knowledgeBaseId,
        KB_DATA_SOURCE_ID: kb.dataSourceId,
        TABLE_NAME: state.getTable().tableName,
        BUS_NAME: this.eventBus.eventBusName,
      },
    });
    kb.bucket.grantWrite(kbIngestionFn);
    kbIngestionFn.addToRolePolicy(kb.triggerSyncPolicy());

    // Model SSM params from advisory-hub (Sonnet only)
    const hubNaming = new NamingService({ prefix: props.prefix, subsystem: 'advisory', service: 'advisory-hub' });
    const modelSonnetId = StringParameter.valueForStringParameter(this, hubNaming.ssmParameterPath('models/sonnet'));

    ingress.handler.addEnvironment('MODEL_SONNET_SSM', hubNaming.ssmParameterPath('models/sonnet'));

    // Memory ID from decision-workflow-ctrl SSM
    const workflowNaming = new NamingService({
      prefix: props.prefix, subsystem: 'advisory', service: 'decision-workflow-ctrl',
    });
    const memoryId = StringParameter.valueForStringParameter(
      this, workflowNaming.ssmParameterPath('memory/id'),
    );
    ingress.handler.addEnvironment('MEMORY_ID', memoryId);

    // IAM grants for Memory API
    ingress.handler.addToRolePolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        'bedrock-agentcore:CreateEvent',
        'bedrock-agentcore:RetrieveMemoryRecords',
        'bedrock-agentcore:GetMemoryRecord',
        'bedrock-agentcore:ListEvents',
        'bedrock-agentcore:ListActors',
        'bedrock-agentcore:ListSessions',
      ],
      resources: ['*'],
    }));

    // AgentRuntime
    const agentRuntime = new AgentRuntime(this, 'AgentRuntime', {
      runtimeName: 'market_intelligence_agents',
      agentCodePath: join(__dirname, '..', 'agents', 'market-intelligence'),
      description: 'market-research (Sonnet) single agent with tool access',
      state,
      modelIds: [modelSonnetId],
      toolTargets: [],
      environmentVariables: {
        MODEL_SONNET_ID: modelSonnetId,
        TABLE_NAME: state.getTable().tableName,
        EVENT_BUS_NAME: this.eventBus.eventBusName,
        MEMORY_ID: memoryId,
      },
    });

    // Grant the AgentRuntime role permission to emit trace envelopes to the
    // advisory bus (consumed by AgentTraceTrap in e2e feature tests).
    this.eventBus.grantPutEventsTo(agentRuntime.runtime.grantPrincipal);

    // Grant the AgentRuntime role AgentCore Memory read permissions
    // (long-term memory retrieval via searchLongTermMemory).
    agentRuntime.runtime.grantPrincipal.addToPrincipalPolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        'bedrock-agentcore:CreateEvent',
        'bedrock-agentcore:RetrieveMemoryRecords',
        'bedrock-agentcore:GetMemoryRecord',
        'bedrock-agentcore:ListEvents',
        'bedrock-agentcore:ListActors',
        'bedrock-agentcore:ListSessions',
      ],
      resources: ['*'],
    }));

    // SSM-published runtime target. Defaults to the real AgentCore runtime ARN;
    // integration tests redirect via SsmOverrideFixture to a Function URL.
    const runtimeArn = agentRuntime.runtime.agentRuntimeArn;
    const agentRuntimeUrlParam = new StringParameter(this, 'AgentRuntimeUrlParam', {
      parameterName: `/nestfolio/${props.prefix}-market-intelligence-ctrl/agent/runtimeUrl`,
      stringValue: runtimeArn,
    });
    ingress.handler.addEnvironment('AGENT_RUNTIME_URL_PARAM', agentRuntimeUrlParam.parameterName);
    agentRuntimeUrlParam.grantRead(ingress.handler);

    // Grant the ingress handler permission to invoke the AgentCore runtime
    // (covers both runtime ARN and its endpoint sub-resource).
    agentRuntime.grantInvoke(ingress.handler);

    // resumeStateMachine pipeline callback permissions (see investor-profile-ctrl).
    ingress.handler.addToRolePolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['states:SendTaskSuccess', 'states:SendTaskFailure', 'states:SendTaskHeartbeat'],
      resources: ['*'],
    }));

    this.addObservability({
      ingress,
      egress,
      extraLambdas: [kbIngestionFn],
      monitorBedrock: true,
      bedrockModelIds: [modelSonnetId],
    });

    // Per-service Bedrock usage alarms (P1 — 2026-04-28 cost safeguards).
    new BedrockUsageAlarms(this, 'BedrockAlarms', {
      serviceName: 'market-intelligence-ctrl',
      modelIds: [modelSonnetId],
      alertTopic: importCostAlertTopic(
        this, 'CostAlertTopic',
        `/nestfolio/${props.prefix}-investor/cost-controls/alertTopicArn`,
      ),
    });
  }
}
