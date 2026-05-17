import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';
import { IEventBus } from 'aws-cdk-lib/aws-events';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';

interface DecisionWorkflowDefinitionProps {
  readonly eventBus: IEventBus;
  readonly table: ITable;
  readonly tableName: string;
  readonly serviceName: string;
  readonly assemblePacketFnArn: string;
}

/**
 * Step Functions state machine for the decision lifecycle.
 *
 * Flow (post agent-precomputation rewire):
 * 1. UnpackTriggerEnvelope (Pass)
 * 2. ParallelProjections (Parallel)
 *    - Branch A: ResolveInvestorProfile (Choice) →
 *        - HoistInvestorProfileFromTrigger (Pass) when trigger carries profile
 *        - LookupInvestorProfileSnapshot (DDB GetItem) otherwise
 *    - Branch B: LookupMarketSnapshot (DDB GetItem)
 * 3. MergeProjections (Pass) — lift both branches into top-level $.agentResults
 * 4. ResolveMandateSnapshot (Choice) →
 *      - HoistMandateFromTrigger (Pass) when trigger carries operatingMode
 *      - LookupMandateSnapshot + SetInvestorProfile (existing DDB path) otherwise
 * 5. InvokePortfolioEngine (Task, putEvents.waitForTaskToken)
 * 6. InvokeAdvisoryNarrative (Task, putEvents.waitForTaskToken)
 * 7. AssemblePacket (Lambda Task state — reads agent outputs from SF state)
 * 8. WaitForCompliance (waitForTaskToken)
 * 9. Choice: APPROVED L1 → end, BLOCKED → end, L2 → user confirmation
 * 10. WaitForUserResponse (waitForTaskToken)
 * 11. End
 *
 * InvestorProfile + Market agents are out of the per-decision cycle. Their
 * outputs are precomputed snapshot rows (materialised by SnapshotProjectorIngress)
 * the SF reads via Direct DDB GetItem from its own table.
 */
export class DecisionWorkflowDefinition extends Construct {
  readonly definitionBody: sfn.DefinitionBody;

  constructor(scope: Construct, id: string, props: DecisionWorkflowDefinitionProps) {
    super(scope, id);

    const { eventBus, serviceName } = props;

    // Helper: create a waitForTaskToken state that publishes an event to EventBridge.
    // `extraSubject` adds JSONPath-resolved fields onto the subject envelope —
    // used to propagate cross-stage envelope fields (e.g. operatingMode) read
    // from prior agentResults instead of via AgentCore Memory ListMemoryRecords
    // (which has a >40s eventual-consistency window — see
    // docs/backlog/agentcore-memory-list-records-eventual-consistency.md).
    const createAgentInvocationState = (
      stateId: string,
      detailType: string,
      options: { extraSubject?: Record<string, string>; timeout?: Duration } = {},
    ): sfn.CustomState => {
      const subject: Record<string, unknown> = {
        'decisionId.$': '$.decisionId',
        'tenantId.$': '$.tenantId',
        'taskToken.$': '$$.Task.Token',
      };
      for (const [key, jsonPath] of Object.entries(options.extraSubject ?? {})) {
        subject[`${key}.$`] = jsonPath;
      }
      // CustomState because the CDK L2 EventBridgePutEvents task does not natively
      // support waitForTaskToken with $.Task.Token injection. We use raw ASL.
      return new sfn.CustomState(this, stateId, {
        stateJson: {
          Type: 'Task',
          Resource: 'arn:aws:states:::events:putEvents.waitForTaskToken',
          Parameters: {
            Entries: [
              {
                EventBusName: eventBus.eventBusName,
                Source: serviceName,
                DetailType: detailType,
                Detail: {
                  'id.$': 'States.UUID()',
                  'type': detailType,
                  'timestamp.$': '$$.State.EnteredTime',
                  'subject': subject,
                  'context': {
                    'tenantId.$': '$.tenantId',
                    'userId.$': '$.userId',
                    'region.$': '$.region',
                  },
                },
              },
            ],
          },
          TimeoutSeconds: (options.timeout ?? Duration.minutes(10)).toSeconds(),
          ResultPath: `$.agentResults.${stateId}`,
        },
      });
    };

    // --- Agent invocation states ---
    //
    // InvestorProfile + MarketIntelligence are NOT in the per-decision cycle —
    // their outputs are precomputed snapshot rows the SF reads via DDB GetItem
    // in the ParallelProjections stage below. Only PortfolioEngine + Narrative
    // remain as per-decision LangGraph agents.
    //
    // Portfolio + Narrative both need upstream outputs (investor profile, market
    // analysis, prior allocations) to drive their reasoning. We pull them from
    // `$.agentResults.<Upstream>.agentOutput` — populated by MergeProjections
    // from the DDB GetItem results — so downstream Lambdas read them from
    // their event subject directly. No AgentCore Memory roundtrip and no
    // ListMemoryRecords eventual-consistency window — see
    // docs/backlog/inter-agent-state-handoff-sf-vs-memory.md and
    // docs/backlog/agentcore-memory-list-records-eventual-consistency.md.
    //
    // operatingMode now lives at $.investorProfile.operatingMode after
    // ResolveMandateSnapshot — either hoisted from the trigger payload or
    // resolved via the local MandateSnapshot projection row.
    const invokePortfolioEngine = createAgentInvocationState(
      'InvokePortfolioEngine',
      'CONSTRUCT_PORTFOLIO',
      {
        extraSubject: {
          operatingMode: '$.investorProfile.operatingMode',
          investorProfile: '$.agentResults.InvokeInvestorProfile.agentOutput',
          marketAnalysis: '$.agentResults.InvokeMarketIntelligence.agentOutput',
        },
      },
    );

    const invokeAdvisoryNarrative = createAgentInvocationState(
      'InvokeAdvisoryNarrative',
      'GENERATE_NARRATIVE',
      {
        extraSubject: {
          operatingMode: '$.investorProfile.operatingMode',
          investorProfile: '$.agentResults.InvokeInvestorProfile.agentOutput',
          marketAnalysis: '$.agentResults.InvokeMarketIntelligence.agentOutput',
          portfolio: '$.agentResults.InvokePortfolioEngine.agentOutput',
        },
      },
    );

    // --- Merge all outputs before compliance ---

    // AssemblePacket invocation. The Lambda writes a DecisionPacket DDB row
    // (idempotent) AND returns the compliance inputs (proposedTrades,
    // portfolioValue, riskScore, currentPositions) extracted from the agents'
    // memory outputs. ResultSelector flattens the lambda:invoke envelope so we
    // address the fields directly via $.decisionPacket.<field>. ResultPath
    // captures only this packet — the existing top-level state ({decisionId,
    // tenantId, userId, region, trigger, triggerContext}) flows through
    // unchanged.
    // triggerEventId === decisionId per event-listener.ts (both are the trigger
    // event's id), so we reuse $.decisionId.
    const assemblePacket = new sfn.CustomState(this, 'AssembleDecisionPacket', {
      stateJson: {
        Type: 'Task',
        Resource: 'arn:aws:states:::lambda:invoke',
        Parameters: {
          FunctionName: props.assemblePacketFnArn,
          Payload: {
            'decisionId.$': '$.decisionId',
            'tenantId.$': '$.tenantId',
            'userId.$': '$.userId',
            'region.$': '$.region',
            'trigger.$': '$.trigger',
            'triggerEventId.$': '$.decisionId',
            'executionArn.$': '$$.Execution.Id',
            // Inter-agent state handoff Phase A: pass the 4 agent outputs in
            // directly so assemble-packet.ts (Task 3) reads them from event,
            // not from AgentCore Memory ListMemoryRecords. See
            // docs/backlog/inter-agent-state-handoff-sf-vs-memory.md.
            'investorProfile.$': '$.agentResults.InvokeInvestorProfile.agentOutput',
            'marketAnalysis.$': '$.agentResults.InvokeMarketIntelligence.agentOutput',
            'portfolio.$': '$.agentResults.InvokePortfolioEngine.agentOutput',
            'narrative.$': '$.agentResults.InvokeAdvisoryNarrative.agentOutput',
          },
        },
        ResultSelector: {
          'proposedTrades.$': '$.Payload.proposedTrades',
          'portfolioValue.$': '$.Payload.portfolioValue',
          'riskScore.$': '$.Payload.riskScore',
          'currentPositions.$': '$.Payload.currentPositions',
        },
        ResultPath: '$.decisionPacket',
      },
    });

    // --- Compliance wait ---
    //
    // Single emission: RECOMMENDATION_PROPOSED carries taskToken AND the
    // packet data compliance-ctrl needs. compliance-ctrl subscribes to this
    // detailType, runs the rule engine, persists ComplianceCheck with
    // taskToken, and CDC re-emits DECISION_APPROVED|BLOCKED with taskToken on
    // subject — closing the SF callback loop.

    const waitForCompliance = new sfn.CustomState(this, 'WaitForCompliance', {
      stateJson: {
        Type: 'Task',
        Resource: 'arn:aws:states:::events:putEvents.waitForTaskToken',
        Parameters: {
          Entries: [
            {
              EventBusName: eventBus.eventBusName,
              Source: serviceName,
              DetailType: 'RECOMMENDATION_PROPOSED',
              Detail: {
                'id.$': 'States.UUID()',
                'type': 'RECOMMENDATION_PROPOSED',
                'timestamp.$': '$$.State.EnteredTime',
                'subject': {
                  'decisionId.$': '$.decisionId',
                  'tenantId.$': '$.tenantId',
                  'userId.$': '$.userId',
                  'taskToken.$': '$$.Task.Token',
                  'awaitingCompliance': true,
                  'proposedTrades.$': '$.decisionPacket.proposedTrades',
                  'portfolioValue.$': '$.decisionPacket.portfolioValue',
                  'riskScore.$': '$.decisionPacket.riskScore',
                  'currentPositions.$': '$.decisionPacket.currentPositions',
                },
                'context': {
                  'tenantId.$': '$.tenantId',
                  'userId.$': '$.userId',
                  'region.$': '$.region',
                },
              },
            },
          ],
        },
        TimeoutSeconds: Duration.hours(24).toSeconds(),
        ResultPath: '$.complianceResult',
      },
    });

    // --- Compliance choice ---

    const complianceChoice = new sfn.Choice(this, 'ComplianceChoice');

    const blockedEnd = new sfn.Pass(this, 'UpdateStatusBlocked', {
      comment: 'Decision blocked by compliance',
    }).next(new sfn.Succeed(this, 'EndBlocked'));

    const approvedL1End = new sfn.Pass(this, 'UpdateStatusApprovedL1', {
      comment: 'Decision approved (L1 autonomous)',
    }).next(new sfn.Succeed(this, 'EndApprovedL1'));

    // --- User confirmation ---

    const requestUserConfirmation = new sfn.CustomState(this, 'RequestUserConfirmation', {
      stateJson: {
        Type: 'Task',
        Resource: 'arn:aws:states:::events:putEvents.waitForTaskToken',
        Parameters: {
          Entries: [
            {
              EventBusName: eventBus.eventBusName,
              Source: serviceName,
              DetailType: 'USER_CONFIRMATION_REQUESTED',
              Detail: {
                'id.$': 'States.UUID()',
                'type': 'USER_CONFIRMATION_REQUESTED',
                'timestamp.$': '$$.State.EnteredTime',
                'subject': {
                  'decisionId.$': '$.decisionId',
                  'tenantId.$': '$.tenantId',
                  'taskToken.$': '$$.Task.Token',
                },
                'context': {
                  'tenantId.$': '$.tenantId',
                  'userId.$': '$.userId',
                  'region.$': '$.region',
                },
              },
            },
          ],
        },
        TimeoutSeconds: Duration.hours(72).toSeconds(),
        ResultPath: '$.userResponse',
      },
    });

    const updateFinalStatus = new sfn.Pass(this, 'UpdateFinalStatus', {
      comment: 'Final status from user response',
    });

    const endSuccess = new sfn.Succeed(this, 'EndSuccess');

    // --- Entry: unpack EB envelope ({id,type,timestamp,subject,context}) into
    //     top-level {decisionId, tenantId, trigger, triggerContext} so downstream
    //     states can reference $.decisionId and $.tenantId directly.
    //     Post-collapse (Phase 2): trigger events arrive directly from EB→SF
    //     and do NOT carry a pre-generated decisionId — the legacy TriggerIngress
    //     Lambda that minted one was removed. We generate a fresh decisionId here
    //     via States.UUID() so each SF execution owns a stable ID for its
    //     downstream agent invocations + DecisionPacket persistence.
    //     `trigger` is the trigger event's detailType (e.g. DEPOSIT_DETECTED);
    //     `triggerContext` carries the full trigger payload for downstream agents
    //     that need fields beyond decisionId/tenantId/userId. ---
    const unpackTriggerEnvelope = new sfn.Pass(this, 'UnpackTriggerEnvelope', {
      parameters: {
        'decisionId.$': 'States.UUID()',
        'tenantId.$': '$.context.tenantId',
        // userId + region come from CDC envelope's top-level context — required by
        // libs/event-processor/src/engine/parse-sqs-record.ts envelope validation
        // on every downstream event we emit (agent invocations, compliance, user confirm).
        'userId.$': '$.context.userId',
        'region.$': '$.context.region',
        'trigger.$': '$.type',
        'triggerContext.$': '$.subject',
      },
    });

    // --- Projection lookups (replace the legacy per-decision IP + Market agents) ---
    //
    // (A) ResolveInvestorProfile Choice: when the trigger payload carries an
    //     investor profile (INVESTOR_PROFILE_UPDATED carries `goal` on its
    //     subject), hoist a partial agentOutput shape inline; otherwise read
    //     the precomputed snapshot from this service's own DDB table.
    //
    //     PE + AN read `subject.investorProfile` as opaque (`?? {}`) — they
    //     don't assert on any specific snapshot field today. The hoist path's
    //     partial shape is therefore acceptable for the trigger-payload happy
    //     path. See plan §Open Question #3.

    const lookupInvestorProfileSnapshot = new sfn.CustomState(this, 'LookupInvestorProfileSnapshot', {
      stateJson: {
        Type: 'Task',
        Resource: 'arn:aws:states:::dynamodb:getItem',
        Parameters: {
          TableName: props.tableName,
          Key: {
            pk: { 'S.$': "States.Format('InvestorProfileSnapshot#{}#{}', $.tenantId, $.userId)" },
            sk: { S: 'InvestorProfileSnapshot' },
          },
        },
        // SF DDB integration returns Item in raw DDB attribute-typed wire format
        // ({S, N, M, L, ...}). `.M` extracts the map's nested object; PE+AN
        // treat the value as opaque (defaults via `?? {}`), so the
        // unmarshalled-vs-wrapped shape is not load-bearing today. If a future
        // change in PE/AN starts depending on a specific snapshot field, swap
        // this for a per-field projection (e.g. `riskScore.$': '$.Item.agentOutput.M.riskScore.N`)
        // or an unmarshalling Pass — see plan §Open Question #3.
        ResultSelector: {
          'agentOutput.$': '$.Item.agentOutput.M',
        },
        ResultPath: '$.agentResults.InvokeInvestorProfile',
      },
    });

    const hoistInvestorProfileFromTrigger = new sfn.Pass(this, 'HoistInvestorProfileFromTrigger', {
      parameters: {
        // Partial agentOutput shape, hoisted from the trigger payload. PE+AN
        // read `subject.investorProfile` opaquely and fall back to `?? {}` on
        // any missing field, so a partial shape is fine for the happy path.
        // The fields here mirror what INVESTOR_PROFILE_UPDATED carries on its
        // subject (see investor-profile-ctrl/src/handlers/event-listener.ts).
        agentOutput: {
          'goals.$': '$.triggerContext.goal',
          'timeHorizon.$': '$.triggerContext.goal.timeHorizonMonths',
          'riskWillingness': 'inline',
          'riskScore.$': '$.triggerContext.riskProfile.score',
          'riskCategory': 'MODERATE',
          'regulatoryFlags': [],
          'suitabilityAssessment': 'inline-from-trigger',
          'confidence': 1.0,
        },
      },
    });

    const resolveInvestorProfile = new sfn.Choice(this, 'ResolveInvestorProfile')
      .when(sfn.Condition.isPresent('$.triggerContext.goal'), hoistInvestorProfileFromTrigger)
      .otherwise(lookupInvestorProfileSnapshot);

    // (B) LookupMarketSnapshot — always GetItem. Market signals are a global
    //     projection keyed by region; we never hoist from trigger payload
    //     because no trigger carries market analysis.
    const lookupMarketSnapshot = new sfn.CustomState(this, 'LookupMarketSnapshot', {
      stateJson: {
        Type: 'Task',
        Resource: 'arn:aws:states:::dynamodb:getItem',
        Parameters: {
          TableName: props.tableName,
          Key: {
            pk: { 'S.$': "States.Format('MarketSnapshot#{}', $.region)" },
            sk: { S: 'MarketSnapshot' },
          },
        },
        ResultSelector: {
          'agentOutput.$': '$.Item.agentOutput.M',
        },
        ResultPath: '$.agentResults.InvokeMarketIntelligence',
      },
    });

    // (C) Parallel: run the IP Choice + Market lookup concurrently.
    const parallelProjections = new sfn.Parallel(this, 'ParallelProjections', {
      resultPath: '$.parallelResults',
    });
    parallelProjections.branch(resolveInvestorProfile);
    parallelProjections.branch(lookupMarketSnapshot);

    // (D) MergeProjections — lift each branch's result back into top-level
    //     $.agentResults.<StateId>.agentOutput so PE+AN subjects can reference
    //     them via JSONPath. Preserve triggerContext so ResolveMandateSnapshot
    //     below can still inspect $.triggerContext.operatingMode.
    const mergeProjections = new sfn.Pass(this, 'MergeProjections', {
      parameters: {
        'decisionId.$': '$.decisionId',
        'tenantId.$': '$.tenantId',
        'userId.$': '$.userId',
        'region.$': '$.region',
        'trigger.$': '$.trigger',
        'triggerContext.$': '$.triggerContext',
        'agentResults': {
          'InvokeInvestorProfile': {
            'agentOutput.$': '$.parallelResults[0].agentResults.InvokeInvestorProfile.agentOutput',
          },
          'InvokeMarketIntelligence': {
            'agentOutput.$': '$.parallelResults[1].agentResults.InvokeMarketIntelligence.agentOutput',
          },
        },
      },
    });

    // --- ResolveMandateSnapshot Choice ---
    //
    // When the trigger payload carries `operatingMode` directly (e.g. a future
    // MANDATE_ISSUED trigger payload), hoist it into $.investorProfile.operatingMode
    // without a DDB read. Otherwise fall through to the existing projection-row
    // lookup. The mandate projection is materialised by the MandateProjectorIngress
    // (see CLAUDE.md "Ingress"), so by the time the SF starts the row is committed.

    const lookupMandateSnapshot = new sfn.CustomState(this, 'LookupMandateSnapshot', {
      stateJson: {
        Type: 'Task',
        Resource: 'arn:aws:states:::dynamodb:getItem',
        Parameters: {
          TableName: props.tableName,
          Key: {
            pk: { 'S.$': "States.Format('MandateSnapshot#{}#{}', $.tenantId, $.userId)" },
            sk: { S: 'MandateSnapshot' },
          },
        },
        ResultSelector: {
          'operatingMode.$': '$.Item.operatingMode.S',
        },
        ResultPath: '$.mandateSnapshot',
      },
    });

    const setInvestorProfile = new sfn.Pass(this, 'SetInvestorProfile', {
      parameters: {
        'decisionId.$': '$.decisionId',
        'tenantId.$': '$.tenantId',
        'userId.$': '$.userId',
        'region.$': '$.region',
        'trigger.$': '$.trigger',
        'triggerContext.$': '$.triggerContext',
        'agentResults.$': '$.agentResults',
        'investorProfile': {
          'operatingMode.$': '$.mandateSnapshot.operatingMode',
        },
      },
    });

    const hoistMandateFromTrigger = new sfn.Pass(this, 'HoistMandateFromTrigger', {
      parameters: {
        'decisionId.$': '$.decisionId',
        'tenantId.$': '$.tenantId',
        'userId.$': '$.userId',
        'region.$': '$.region',
        'trigger.$': '$.trigger',
        'triggerContext.$': '$.triggerContext',
        'agentResults.$': '$.agentResults',
        'investorProfile': {
          'operatingMode.$': '$.triggerContext.operatingMode',
        },
      },
    });

    const resolveMandateSnapshot = new sfn.Choice(this, 'ResolveMandateSnapshot');
    resolveMandateSnapshot.when(
      sfn.Condition.isPresent('$.triggerContext.operatingMode'),
      hoistMandateFromTrigger,
    );
    resolveMandateSnapshot.otherwise(lookupMandateSnapshot.next(setInvestorProfile));

    // Both Choice branches converge on invokePortfolioEngine via `afterwards()`,
    // which produces a Chain that re-wires every unterminated branch's `Next`
    // to whatever comes after. The Chain itself is a valid IChainable so we
    // can splice it into the main linear flow.
    const mandateResolved = resolveMandateSnapshot
      .afterwards()
      .next(invokePortfolioEngine);

    // --- Wire the chain ---

    const definition = unpackTriggerEnvelope
      .next(parallelProjections)
      .next(mergeProjections)
      .next(mandateResolved)
      .next(invokeAdvisoryNarrative)
      .next(assemblePacket)
      .next(waitForCompliance)
      .next(
        complianceChoice
          .when(sfn.Condition.stringEquals('$.complianceResult.decision', 'BLOCKED'), blockedEnd)
          .when(
            sfn.Condition.and(
              sfn.Condition.stringEquals('$.complianceResult.decision', 'APPROVED'),
              sfn.Condition.stringEquals('$.complianceResult.authorityLevel', 'L1'),
            ),
            approvedL1End,
          )
          .otherwise(
            requestUserConfirmation
              .next(updateFinalStatus)
              .next(endSuccess),
          ),
      );

    this.definitionBody = sfn.DefinitionBody.fromChainable(definition);
  }
}
