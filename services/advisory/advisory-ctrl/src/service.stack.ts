import { PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import { join } from 'path';
import { ServiceStack, ServiceStackProps, State, Ingress, Egress } from '@nestfolio/cdk-constructs/core';
import { AdvisoryCtrlEventTypes } from './domain/events';
import {
  AgentRuntime, BedrockUsageAlarms, importCostAlertTopic,
} from '@nestfolio/cdk-constructs/extensions';
import { AdvisoryIngestEventTypes, AdvisoryCrossDomainEventTypes } from '@nestfolio/advisory-adpt/domain';
import { AdvisoryBffEventTypes } from '@nestfolio/advisory-bff/events';
import { defaultLambdaProps, createNamingService, PARAMS_AND_SECRETS_LAYER } from '@nestfolio/cdk-constructs/utils';

export class AdvisoryCtrlStack extends ServiceStack {
  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, { ...props, serviceDir: __dirname });

    const state = new State(this, 'State');

    const ingress = new Ingress(this, 'Ingress', {
      state,
      // Bundle prompt .txt files as inline strings so they are available in /var/task at runtime.
      // The event-listener transitively imports agents/config which calls loadPrompt() at module init.
      lambdaProps: {
        paramsAndSecrets: PARAMS_AND_SECRETS_LAYER,
        bundling: {
          minify: true,
          sourceMap: true,
          target: 'node24',
          externalModules: ['@aws-sdk/*'],
          // Copy prompt .txt files into the Lambda bundle output directory.
          // agents/config.ts calls loadPrompt() at module init which uses readFileSync(__dirname + txt).
          // esbuild bundles to /asset-output/index.js, so prompts must be at /asset-output/prompts/*.txt.
          commandHooks: {
            beforeBundling: () => [],
            beforeInstall: () => [],
            // Copy prompt .txt files to the bundle root so readFileSync(__dirname + agentType + '.txt')
            // resolves to /var/task/{agentType}.txt at Lambda runtime (__dirname = /var/task for index.js)
            afterBundling: (inputDir: string, outputDir: string) => [
              `cp ${inputDir}/services/advisory/advisory-ctrl/src/agents/prompts/*.txt ${outputDir}/`,
            ],
          },
        },
      },
      eventTypes: [
        AdvisoryIngestEventTypes.MANDATE_CREATED,
        AdvisoryIngestEventTypes.GOAL_CREATED,
        AdvisoryIngestEventTypes.GOAL_UPDATED,
        AdvisoryIngestEventTypes.RISK_PROFILE_CREATED,
        AdvisoryIngestEventTypes.RISK_PROFILE_UPDATED,
        AdvisoryIngestEventTypes.OPERATING_MODE_CHANGED,
        AdvisoryIngestEventTypes.PORTFOLIO_DRIFT_DETECTED,
        AdvisoryIngestEventTypes.ORDER_FILLED,
        AdvisoryIngestEventTypes.ORDER_REJECTED,
        AdvisoryIngestEventTypes.ORDER_CANCELLED,
        AdvisoryIngestEventTypes.DEPOSIT_DETECTED,
        AdvisoryCrossDomainEventTypes.DECISION_APPROVED,
        AdvisoryCrossDomainEventTypes.DECISION_BLOCKED,
        AdvisoryCrossDomainEventTypes.USER_CONFIRMED,
        AdvisoryBffEventTypes.USER_REJECTED,
      ],
    });

    const egress = new Egress(this, 'Egress', {
      state,
      eventTypes: {
        'DecisionPacket': {
          insert: AdvisoryCtrlEventTypes.DECISION_PACKET_CREATED,
          modify: AdvisoryCtrlEventTypes.DECISION_PACKET_UPDATED,
        },
        'AgentInvocation': {
          insert: AdvisoryCtrlEventTypes.AGENT_INVOCATION_CREATED,
          modify: AdvisoryCtrlEventTypes.AGENT_INVOCATION_UPDATED,
        },
        'WorkflowState': {
          insert: AdvisoryCtrlEventTypes.WORKFLOW_STATE_CREATED,
          modify: AdvisoryCtrlEventTypes.WORKFLOW_STATE_UPDATED,
        },
      },
    });

    const hubNaming = createNamingService(this, { subsystem: 'advisory', service: 'advisory-hub' });
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

    ingress.handler.addEnvironment('MODEL_OPUS_SSM', hubNaming.ssmParameterPath('models/opus'));
    ingress.handler.addEnvironment('MODEL_SONNET_SSM', hubNaming.ssmParameterPath('models/sonnet'));
    ingress.handler.addEnvironment('MODEL_HAIKU_SSM', hubNaming.ssmParameterPath('models/haiku'));

    const portfolioLookupFn = new NodejsFunction(this, 'PortfolioLookup', {
      ...defaultLambdaProps(this),
      entry: join(__dirname, 'handlers', 'tools', 'portfolio-lookup.ts'),
      environment: { TABLE_NAME: state.getTable().tableName },
    });
    state.getTable().grantReadData(portfolioLookupFn);

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
      environment: { BUS_NAME: this.naming.eventBusName() },
    });
    eventPublisherFn.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['events:PutEvents'],
        resources: [this.eventBus.eventBusArn],
      }),
    );

    const agentRuntime = new AgentRuntime(this, 'AgentRuntime', {
      runtimeName: 'advisory_ctrl_decision_lifecycle',
      agentCodePath: join(__dirname, '..', 'agents', 'decision-lifecycle'),
      description: 'Multi-agent decision lifecycle orchestrated via LangGraph.js',
      state,
      modelIds: [modelOpusId, modelSonnetId, modelHaikuId],
      environmentVariables: {
        MODEL_OPUS_ID: modelOpusId,
        MODEL_SONNET_ID: modelSonnetId,
        MODEL_HAIKU_ID: modelHaikuId,
        TABLE_NAME: state.getTable().tableName,
        EVENT_BUS_NAME: this.eventBus.eventBusName,
      },
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

    // SSM-published runtime target. Defaults to the real AgentCore runtime ARN;
    // integration tests redirect via SsmOverrideFixture to a Function URL.
    const runtimeArn = agentRuntime.runtime.agentRuntimeArn;
    const agentRuntimeUrlParam = new StringParameter(this, 'AgentRuntimeUrlParam', {
      parameterName: `/nestfolio/${props.prefix}-advisory-ctrl/agent/runtimeUrl`,
      stringValue: runtimeArn,
    });
    ingress.handler.addEnvironment('AGENT_RUNTIME_URL_PARAM', agentRuntimeUrlParam.parameterName);
    agentRuntimeUrlParam.grantRead(ingress.handler);

    // Grant the ingress handler permission to invoke the AgentCore runtime.
    // Uses the construct's grantInvoke helper so the grant covers BOTH the
    // runtime ARN and its endpoint ARNs (at invoke time the SDK targets
    // .../runtime-endpoint/DEFAULT; missing that causes AccessDeniedException).
    agentRuntime.grantInvoke(ingress.handler);

    // Grant the AgentRuntime role permission to emit trace envelopes to the
    // advisory bus. Separate from the tool-publisher Lambda's PutEvents grant
    // above (that one lets the event-publisher tool emit domain events from
    // within agent invocations); this grants emission of the agent trace
    // envelope itself, consumed by AgentTraceTrap in e2e feature tests.
    this.eventBus.grantPutEventsTo(agentRuntime.runtime.grantPrincipal);

    this.addObservability({
      ingress,
      egress,
      extraLambdas: [portfolioLookupFn, marketDataFn, instrumentUniverseFn, eventPublisherFn],
      monitorBedrock: true,
      bedrockModelIds: [modelOpusId, modelSonnetId, modelHaikuId],
    });

    // Per-service Bedrock usage alarms (P1 — 2026-04-28 cost safeguards).
    new BedrockUsageAlarms(this, 'BedrockAlarms', {
      serviceName: 'advisory-ctrl',
      modelIds: [modelOpusId, modelSonnetId, modelHaikuId],
      alertTopic: importCostAlertTopic(
        this, 'CostAlertTopic',
        `/nestfolio/${props.prefix}-investor/cost-controls/alertTopicArn`,
      ),
    });
  }
}
