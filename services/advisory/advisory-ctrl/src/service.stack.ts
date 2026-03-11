import { Stack, StackProps } from 'aws-cdk-lib';
import { EventBus } from 'aws-cdk-lib/aws-events';
import { PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import { join } from 'path';
import {
  State,
  Ingress,
  Egress,
  AgentRuntime,
  Monitoring,
  ServiceDashboard,
  createNamingService,
  defaultLambdaProps,
  applyStandardTags,
} from '@nestfolio/cdk-constructs';

export class AdvisoryCtrlStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const naming = createNamingService(this, {
      subsystem: 'advisory',
      service: 'advisory-ctrl',
    });

    const prefix = this.node.tryGetContext('prefix');
    if (!prefix) throw new Error('CDK context "prefix" is required. Pass -c prefix=dev|staging|prod');
    applyStandardTags(this, { service: 'advisory-ctrl', domain: 'advisory', environment: prefix });

    // State: DynamoDB table
    const state = new State(this, 'State');

    // Event listener Lambda (all event types)
    const eventListener = new NodejsFunction(this, 'EventListener', {
      ...defaultLambdaProps(this),
      entry: join(__dirname, 'handlers', 'event-listener.ts'),
      environment: { TABLE_NAME: state.table.tableName, BUS_NAME: naming.eventBusName(), SERVICE_NAME: 'advisory-ctrl' },
    });
    state.table.grantReadWriteData(eventListener);
    eventListener.addToRolePolicy(new PolicyStatement({ actions: ['events:PutEvents'], resources: [`arn:aws:events:${Stack.of(this).region}:${Stack.of(this).account}:event-bus/${naming.eventBusName()}`] }));

    // Ingress: advisory EventBridge bus -> SQS -> event-listener
    const ingress = new Ingress(this, 'Ingress', {
      eventBus: EventBus.fromEventBusName(this, 'AdvisoryBus', naming.eventBusName()),
      eventTypes: [
        'MANDATE_GRANTED',
        'GOAL_UPDATED',
        'RISK_PROFILE_UPDATED',
        'OPERATING_MODE_CHANGED',
        'PORTFOLIO_DRIFT_DETECTED',
        'ORDER_FILLED',
        'ORDER_REJECTED',
        'ORDER_CANCELLED',
        'DEPOSIT_DETECTED',
        'DECISION_APPROVED',
        'DECISION_BLOCKED',
        'USER_CONFIRMED',
        'USER_REJECTED',
      ],
      handler: eventListener,
    });

    // Egress: DynamoDB Streams -> EventBridge
    const egress = new Egress(this, 'Egress', {
      table: state.table,
      busName: naming.eventBusName(),
      serviceName: 'advisory-ctrl',
      publishableTypes: ['DecisionPacket', 'AgentInvocation', 'WorkflowState'],
    });

    // Read Bedrock model IDs from SSM (published by advisory-hub)
    const hubNaming = createNamingService(this, {
      subsystem: 'advisory',
      service: 'advisory-hub',
    });
    const modelOpusId = StringParameter.valueForStringParameter(
      this,
      hubNaming.ssmParameterPath('models/opus'),
    );
    const modelSonnetId = StringParameter.valueForStringParameter(
      this,
      hubNaming.ssmParameterPath('models/sonnet'),
    );
    const modelHaikuId = StringParameter.valueForStringParameter(
      this,
      hubNaming.ssmParameterPath('models/haiku'),
    );

    // Pass model SSM parameter names as env vars for runtime Lambda resolution
    eventListener.addEnvironment('MODEL_OPUS_SSM', hubNaming.ssmParameterPath('models/opus'));
    eventListener.addEnvironment('MODEL_SONNET_SSM', hubNaming.ssmParameterPath('models/sonnet'));
    eventListener.addEnvironment('MODEL_HAIKU_SSM', hubNaming.ssmParameterPath('models/haiku'));

    // AgentCore Runtime for decision lifecycle agent
    const portfolioLookupFn = new NodejsFunction(this, 'PortfolioLookup', {
      ...defaultLambdaProps(this),
      entry: join(__dirname, 'handlers', 'tools', 'portfolio-lookup.ts'),
      environment: { TABLE_NAME: state.table.tableName },
    });
    state.table.grantReadData(portfolioLookupFn);

    const marketDataFn = new NodejsFunction(this, 'MarketData', {
      ...defaultLambdaProps(this),
      entry: join(__dirname, 'handlers', 'tools', 'market-data.ts'),
    });

    const instrumentUniverseFn = new NodejsFunction(this, 'InstrumentUniverse', {
      ...defaultLambdaProps(this),
      entry: join(__dirname, 'handlers', 'tools', 'instrument-universe.ts'),
    });

    const eventPublisherFn = new NodejsFunction(this, 'ToolEventPublisher', {
      ...defaultLambdaProps(this),
      entry: join(__dirname, 'handlers', 'tools', 'event-publisher.ts'),
      environment: { BUS_NAME: naming.eventBusName() },
    });
    eventPublisherFn.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['events:PutEvents'],
        resources: [
          EventBus.fromEventBusName(this, 'AdvisoryBusForIam', naming.eventBusName()).eventBusArn,
        ],
      }),
    );

    new AgentRuntime(this, 'AgentRuntime', {
      // AgentCore runtimeName must match ^[a-zA-Z][a-zA-Z0-9_]{0,47}$
      runtimeName: 'advisory_ctrl_decision_lifecycle',
      agentCodePath: join(__dirname, '..', 'agents', 'decision-lifecycle'),
      description: 'Multi-agent decision lifecycle orchestrated via LangGraph.js',
      tables: [state.table],
      modelIds: [modelOpusId, modelSonnetId, modelHaikuId],
      toolTargets: [
        {
          name: 'portfolio-lookup',
          description: 'Retrieve current portfolio positions and cash balance',
          handler: portfolioLookupFn,
          schemaPath: join(__dirname, 'tools', 'portfolio-lookup-schema.json'),
        },
        {
          name: 'market-data',
          description: 'Retrieve current market indices, volatility, and recent events',
          handler: marketDataFn,
          schemaPath: join(__dirname, 'tools', 'market-data-schema.json'),
        },
        {
          name: 'instrument-universe',
          description: 'Retrieve the approved instrument universe',
          handler: instrumentUniverseFn,
          schemaPath: join(__dirname, 'tools', 'instrument-universe-schema.json'),
        },
        {
          name: 'event-publisher',
          description: 'Publish events to the advisory EventBridge bus',
          handler: eventPublisherFn,
          schemaPath: join(__dirname, 'tools', 'event-publisher-schema.json'),
        },
      ],
    });

    // Monitoring: CloudWatch alarms for Lambda errors, DLQ depth, Bedrock errors
    new Monitoring(this, 'Monitoring', {
      lambdaFunctions: [eventListener, portfolioLookupFn, marketDataFn, instrumentUniverseFn, eventPublisherFn],
      dlqs: [ingress.dlq, egress.dlq],
      monitorBedrock: true,
      bedrockModelIds: [modelOpusId, modelSonnetId, modelHaikuId],
    });

    // Dashboard: CloudWatch dashboard for service observability
    new ServiceDashboard(this, 'Dashboard', {
      serviceName: 'advisory-ctrl',
      lambdaFunctions: [eventListener, portfolioLookupFn, marketDataFn, instrumentUniverseFn, eventPublisherFn],
      dlqs: [ingress.dlq, egress.dlq],
    });
  }
}
