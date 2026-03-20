import { PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import { join } from 'path';
import {
  ServiceStack,
  ServiceStackProps,
  Ingress,
  Egress,
  AgentRuntime,
  KnowledgeBase,
  defaultLambdaProps,
  NamingService,
} from '@nestfolio/cdk-constructs';

export class PortfolioEngineCtrlStack extends ServiceStack {
  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, { ...props, serviceDir: __dirname });

    // Knowledge Base: Fund & Instrument (S3 Vectors — managed by Bedrock)
    const kb = new KnowledgeBase(this, 'FundKB', {
      kbName: 'fund',
      description: 'ETF prospectuses, risk factors, instrument data, allocation history',
    });

    // Ingress: trigger + KB ingestion events
    const ingress = new Ingress(this, 'Ingress', {
      eventTypes: ['CONSTRUCT_PORTFOLIO', 'SEC_PROSPECTUS_UPDATED', 'SEC_10K_UPDATED'],
    });

    // Egress: CDC events
    const egress = new Egress(this, 'Egress', {
      publishableTypes: ['AgentInvocation', 'ReasoningOutput'],
    });

    // Tool Lambda: portfolio-lookup
    const portfolioLookupFn = new NodejsFunction(this, 'PortfolioLookup', {
      ...defaultLambdaProps(this),
      entry: join(__dirname, 'handlers', 'tools', 'portfolio-lookup.ts'),
      environment: { TABLE_NAME: this.state.getTable().tableName },
    });
    this.state.getTable().grantReadData(portfolioLookupFn);

    // KB ingestion Lambda
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

    // Model SSM params from advisory-hub
    const hubNaming = new NamingService({ prefix: props.prefix, subsystem: 'advisory', service: 'advisory-hub' });
    const modelOpusId = StringParameter.valueForStringParameter(this, hubNaming.ssmParameterPath('models/opus'));
    const modelSonnetId = StringParameter.valueForStringParameter(this, hubNaming.ssmParameterPath('models/sonnet'));

    ingress.handler.addEnvironment('MODEL_OPUS_SSM', hubNaming.ssmParameterPath('models/opus'));
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

    // AgentRuntime
    new AgentRuntime(this, 'AgentRuntime', {
      runtimeName: 'portfolio_engine_agents',
      agentCodePath: join(__dirname, '..', 'agents'),
      description: 'portfolio-construction (Opus) + rebalance-planner (Sonnet) parallel orchestration',
      tables: [this.state.getTable()],
      modelIds: [modelOpusId, modelSonnetId],
      toolTargets: [],
    });

    this.addObservability({
      ingress,
      egress,
      extraLambdas: [kbIngestionFn, portfolioLookupFn],
      monitorBedrock: true,
      bedrockModelIds: [modelOpusId, modelSonnetId],
    });
  }
}
