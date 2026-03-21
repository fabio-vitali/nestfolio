import { PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import { join } from 'path';
import { ServiceStack, ServiceStackProps, Ingress, Egress } from '@nestfolio/cdk-constructs/core';
import { AgentRuntime, KnowledgeBase } from '@nestfolio/cdk-constructs/extensions';
import { defaultLambdaProps, NamingService } from '@nestfolio/cdk-constructs/utils';

export class MarketIntelligenceCtrlStack extends ServiceStack {
  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, { ...props, serviceDir: __dirname });

    // Knowledge Base: Market Intelligence (S3 Vectors — managed by Bedrock)
    const kb = new KnowledgeBase(this, 'MarketKB', {
      kbName: 'market',
      description: 'Market news, sentiment, macro indicators from 5 feed sources',
    });

    // Ingress: trigger event + 5 feed ingestion events
    const ingress = new Ingress(this, 'Ingress', {
      eventTypes: [
        'ANALYZE_MARKET',
        'YAHOO_FINANCE_UPDATED',
        'MARKETWATCH_UPDATED',
        'SEC_8K_FILED',
        'FRED_INDICATORS_UPDATED',
        'ALPHA_VANTAGE_NEWS_UPDATED',
      ],
    });

    // Egress: CDC events
    const egress = new Egress(this, 'Egress', {
      publishableTypes: ['AgentInvocation', 'ReasoningOutput'],
    });

    // KB ingestion Lambda (separate from event-listener)
    const kbIngestionFn = new NodejsFunction(this, 'KBIngestion', {
      ...defaultLambdaProps(this),
      entry: join(__dirname, 'handlers', 'kb-ingestion-handler.ts'),
      environment: {
        KB_BUCKET: kb.bucket.bucketName,
        KB_ID: kb.knowledgeBaseId,
        KB_DATA_SOURCE_ID: kb.dataSourceId,
        TABLE_NAME: this.state.getTable().tableName,
        BUS_NAME: this.eventBus.eventBusName,
      },
    });
    kb.bucket.grantWrite(kbIngestionFn);
    kbIngestionFn.addToRolePolicy(kb.triggerSyncPolicy());

    // Tool Lambdas
    const marketDataFn = new NodejsFunction(this, 'MarketDataTool', {
      ...defaultLambdaProps(this),
      entry: join(__dirname, 'handlers', 'tools', 'market-data.handler.ts'),
      environment: {
        TABLE_NAME: this.state.getTable().tableName,
      },
    });
    this.state.getTable().grantReadData(marketDataFn);

    const instrumentUniverseFn = new NodejsFunction(this, 'InstrumentUniverseTool', {
      ...defaultLambdaProps(this),
      entry: join(__dirname, 'handlers', 'tools', 'instrument-universe.handler.ts'),
      environment: {
        TABLE_NAME: this.state.getTable().tableName,
      },
    });
    this.state.getTable().grantReadData(instrumentUniverseFn);

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
        'bedrock-agentcore:ListMemoryRecords',
        'bedrock-agentcore:ListEvents',
        'bedrock-agentcore:ListActors',
        'bedrock-agentcore:ListSessions',
      ],
      resources: ['*'],
    }));

    // AgentRuntime (tool Lambdas are standalone — gateway integration added when schemas defined)
    new AgentRuntime(this, 'AgentRuntime', {
      runtimeName: 'market_intelligence_agents',
      agentCodePath: join(__dirname, '..', 'agents'),
      description: 'market-research (Sonnet) single agent with tool access',
      tables: [this.state.getTable()],
      modelIds: [modelSonnetId],
      toolTargets: [],
    });

    this.addObservability({
      ingress,
      egress,
      extraLambdas: [kbIngestionFn, marketDataFn, instrumentUniverseFn],
      monitorBedrock: true,
      bedrockModelIds: [modelSonnetId],
    });
  }
}
