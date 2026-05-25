import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';
import { IEventBus } from 'aws-cdk-lib/aws-events';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as sfnTasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { AGENT_BUDGETS } from '../agent-budgets';

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
        timeout: Duration.seconds(AGENT_BUDGETS.PORTFOLIO_ENGINE_UX_SEC),
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
        timeout: Duration.seconds(AGENT_BUDGETS.ADVISORY_NARRATIVE_UX_SEC),
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
    // portfolioValueCents, isInitialBuild, riskCategory, currentPositions)
    // extracted from the agents' outputs. ResultSelector flattens the
    // lambda:invoke envelope so we address the fields directly via
    // $.decisionPacket.<field>. ResultPath captures only this packet — the
    // existing top-level state ({decisionId, tenantId, userId, region, trigger,
    // triggerContext}) flows through unchanged.
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
            'triggerAmountCents.$': '$.triggerAmountCentsContainer.value',
            // Inter-agent state handoff Phase A: pass the 4 agent outputs in
            // directly so assemble-packet.ts reads them from event, not from
            // AgentCore Memory ListMemoryRecords.
            'investorProfile.$': '$.agentResults.InvokeInvestorProfile.agentOutput',
            'marketAnalysis.$': '$.agentResults.InvokeMarketIntelligence.agentOutput',
            'portfolio.$': '$.agentResults.InvokePortfolioEngine.agentOutput',
            'narrative.$': '$.agentResults.InvokeAdvisoryNarrative.agentOutput',
          },
        },
        ResultSelector: {
          'proposedTrades.$': '$.Payload.proposedTrades',
          'portfolioValueCents.$': '$.Payload.portfolioValueCents',
          'isInitialBuild.$': '$.Payload.isInitialBuild',
          'riskCategory.$': '$.Payload.riskCategory',
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
                  'portfolioValueCents.$': '$.decisionPacket.portfolioValueCents',
                  'isInitialBuild.$': '$.decisionPacket.isInitialBuild',
                  'riskCategory.$': '$.decisionPacket.riskCategory',
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
        // triggerAmountCents is resolved in a subsequent Choice state
        // (ResolveTriggerAmountCents) so that non-deposit triggers that lack
        // amountCents don't raise uncatchable States.Runtime here.
      },
    });

    // Resolve triggerAmountCents from the trigger payload IF present (DEPOSIT_DETECTED),
    // otherwise default to 0. The bare JSONPath `$.triggerContext.amountCents` raises
    // uncatchable States.Runtime when the field is missing — work around via Choice + Pass.
    // MANDATE_SNAPSHOT_CREATED / INVESTOR_PROFILE_UPDATED / PORTFOLIO_DRIFT_DETECTED /
    // ORDER_* triggers have no amountCents. AssembleDecisionPacket reads the value via
    // $.triggerAmountCentsContainer.value after this state resolves.
    // Task 14 surfaced this regression (Task 4) in dev with failed orphan SF
    // executions from MANDATE_SNAPSHOT_CREATED.
    //
    // Container shape is required because Pass.parameters always produces an object
    // result — we can't extract a scalar via parameters alone. Downstream forwarders
    // (MergeProjections, SetInvestorProfile, HoistMandateFromTrigger) and
    // AssembleDecisionPacket Payload read $.triggerAmountCentsContainer.value.
    const setTriggerAmountCentsFromTrigger = new sfn.Pass(this, 'SetTriggerAmountCentsFromTrigger', {
      parameters: { 'value.$': '$.triggerContext.amountCents' },
      resultPath: '$.triggerAmountCentsContainer',
    });
    const setTriggerAmountCentsZero = new sfn.Pass(this, 'SetTriggerAmountCentsZero', {
      result: sfn.Result.fromObject({ value: 0 }),
      resultPath: '$.triggerAmountCentsContainer',
    });
    const resolveTriggerAmountCents = new sfn.Choice(this, 'ResolveTriggerAmountCents')
      .when(sfn.Condition.isPresent('$.triggerContext.amountCents'), setTriggerAmountCentsFromTrigger)
      .otherwise(setTriggerAmountCentsZero);

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

    // Fault-tolerance: a missing InvestorProfileSnapshot row produces a
    // States.Runtime when States.StringToJson(undefined) is evaluated, and
    // States.Runtime is NOT catchable per AWS docs. Capture the raw GetItem
    // response on $.investorProfileSnapshotResponse (no ResultSelector), then use
    // a Choice on isPresent($.investorProfileSnapshotResponse.Item.agentOutput.S)
    // to branch — symmetric with the Market branch below. ExtractInvestorProfileSnapshot
    // parses the JSON-string agentOutput via States.StringToJson on the hit path.
    // PE+AN tolerate empty investorProfile via `?? {}`, so the absent path
    // degrades the decision rather than aborting the cycle.
    const lookupInvestorProfileSnapshot = new sfnTasks.DynamoGetItem(this, 'LookupInvestorProfileSnapshot', {
      table: props.table,
      key: {
        pk: sfnTasks.DynamoAttributeValue.fromString(
          sfn.JsonPath.format(
            'InvestorProfileSnapshot#{}#{}',
            sfn.JsonPath.stringAt('$.tenantId'),
            sfn.JsonPath.stringAt('$.userId'),
          ),
        ),
        sk: sfnTasks.DynamoAttributeValue.fromString('InvestorProfileSnapshot'),
      },
      resultPath: '$.investorProfileSnapshotResponse',
    });
    const extractInvestorProfileSnapshot = new sfn.Pass(this, 'ExtractInvestorProfileSnapshot', {
      parameters: {
        'agentOutput.$':
          'States.StringToJson($.investorProfileSnapshotResponse.Item.agentOutput.S)',
      },
      resultPath: '$.agentResults.InvokeInvestorProfile',
    });
    const handleMissingInvestorProfileSnapshot = new sfn.Pass(this, 'HandleMissingInvestorProfileSnapshot', {
      result: sfn.Result.fromObject({ agentOutput: {} }),
      resultPath: '$.agentResults.InvokeInvestorProfile',
    });
    const checkInvestorProfileSnapshotPresent = new sfn.Choice(this, 'CheckInvestorProfileSnapshotPresent')
      .when(
        sfn.Condition.isPresent('$.investorProfileSnapshotResponse.Item.agentOutput.S'),
        extractInvestorProfileSnapshot,
      )
      .otherwise(handleMissingInvestorProfileSnapshot);

    const hoistInvestorProfileFromTrigger = new sfn.Pass(this, 'HoistInvestorProfileFromTrigger', {
      parameters: {
        // Partial agentOutput shape, hoisted from the trigger payload. PE+AN
        // read `subject.investorProfile` opaquely and fall back to `?? {}` on
        // any missing field, so a partial shape is fine for the happy path.
        // The fields here mirror what INVESTOR_PROFILE_UPDATED carries on its
        // subject (see investor-profile-ctrl/src/handlers/event-listener.ts).
        // Sentinel defaults — trigger payload doesn't carry these; PE+AN treat
        // them opaquely. Specifically: `riskWillingness`, `riskCategory`,
        // `regulatoryFlags`, `suitabilityAssessment`, `confidence` are literal
        // placeholders here, NOT JSONPath reads. If a future change starts
        // asserting on any of these, swap the literal for a JSONPath or drop
        // the field — see plan §Open Question #3.
        agentOutput: {
          'goals.$': '$.triggerContext.goal',
          'timeHorizon.$': '$.triggerContext.goal.timeHorizonMonths',
          'riskWillingness': 'inline',
          'riskScore.$': '$.triggerContext.riskProfile.score',
          // Safety: `riskCategory.$: '$.triggerContext.riskProfile.category'` only
          // executes when ResolveInvestorProfile routes here via
          // isPresent('$.triggerContext.goal'). Today, only INVESTOR_PROFILE_UPDATED
          // triggers carry both `goal` AND `riskProfile.category`, so the JSONPath is
          // safe. If a future trigger type satisfies isPresent($.triggerContext.goal)
          // but lacks riskProfile.category, States.Runtime would raise (uncatchable —
          // see feedback_states_runtime_uncatchable). Tighten the Choice predicate if a
          // new trigger needs to enter this path without a full riskProfile.
          'riskCategory.$': '$.triggerContext.riskProfile.category',
          'regulatoryFlags': [],
          'suitabilityAssessment': 'inline-from-trigger',
          'confidence': 1.0,
        },
      },
    });

    const resolveInvestorProfile = new sfn.Choice(this, 'ResolveInvestorProfile')
      .when(sfn.Condition.isPresent('$.triggerContext.goal'), hoistInvestorProfileFromTrigger)
      .otherwise(lookupInvestorProfileSnapshot.next(checkInvestorProfileSnapshotPresent));

    // (B) LookupMarketSnapshot — always GetItem. Market signals are a global
    //     projection keyed by region; we never hoist from trigger payload
    //     because no trigger carries market analysis.
    //
    //     Fault-tolerance: a missing MarketSnapshot row produces an SF
    //     States.Runtime when States.StringToJson(undefined) is evaluated, which is
    //     UNCATCHABLE per AWS docs ("aren't catchable using Retry or Catch").
    //     We instead capture the raw GetItem response on $.marketSnapshotResponse
    //     (no ResultSelector — that's the part that would raise), then use a
    //     Choice on isPresent($.marketSnapshotResponse.Item.agentOutput.S) to
    //     branch: ExtractMarketSnapshot parses the JSON-string agentOutput via
    //     States.StringToJson on the hit path, HandleMissingMarketSnapshot seeds
    //     an empty default on the miss path. PE+AN tolerate empty marketAnalysis
    //     via `?? {}` (event-listener.ts in each), so absent market context
    //     degrades the decision rather than aborting the cycle.
    const lookupMarketSnapshot = new sfnTasks.DynamoGetItem(this, 'LookupMarketSnapshot', {
      table: props.table,
      key: {
        pk: sfnTasks.DynamoAttributeValue.fromString(
          sfn.JsonPath.format('MarketSnapshot#{}', sfn.JsonPath.stringAt('$.region')),
        ),
        sk: sfnTasks.DynamoAttributeValue.fromString('MarketSnapshot'),
      },
      resultPath: '$.marketSnapshotResponse',
    });
    const extractMarketSnapshot = new sfn.Pass(this, 'ExtractMarketSnapshot', {
      parameters: {
        'agentOutput.$':
          'States.StringToJson($.marketSnapshotResponse.Item.agentOutput.S)',
      },
      resultPath: '$.agentResults.InvokeMarketIntelligence',
    });
    const handleMissingMarketSnapshot = new sfn.Pass(this, 'HandleMissingMarketSnapshot', {
      result: sfn.Result.fromObject({ agentOutput: {} }),
      resultPath: '$.agentResults.InvokeMarketIntelligence',
    });
    const checkMarketSnapshotPresent = new sfn.Choice(this, 'CheckMarketSnapshotPresent')
      .when(
        sfn.Condition.isPresent('$.marketSnapshotResponse.Item.agentOutput.S'),
        extractMarketSnapshot,
      )
      .otherwise(handleMissingMarketSnapshot);

    // (C) Parallel: run the IP Choice + Market lookup concurrently.
    const parallelProjections = new sfn.Parallel(this, 'ParallelProjections', {
      resultPath: '$.parallelResults',
    });
    parallelProjections.branch(resolveInvestorProfile);
    parallelProjections.branch(lookupMarketSnapshot.next(checkMarketSnapshotPresent));

    // (D) MergeProjections — lift each branch's result back into top-level
    //     $.agentResults.<StateId>.agentOutput so PE+AN subjects can reference
    //     them via JSONPath. Preserve triggerContext so ResolveMandateSnapshot
    //     below can still inspect $.triggerContext.operatingMode.
    //
    // Pass-through plumbing pattern: every Pass state on the path from
    // UnpackTriggerEnvelope to AssembleDecisionPacket uses `parameters:` with
    // default `resultPath: '$'`, which fully replaces top-level SF state. Any
    // field that must reach AssembleDecisionPacket (triggerAmountCents,
    // triggerContext, agentResults, etc.) MUST be listed explicitly in EVERY
    // such Pass state. If you add a new Pass state on this path, replicate the
    // full identity-field set or the value silently drops. Regression tests at
    // test/unit/decision-state-machine.test.ts assert each forwarding line.
    const mergeProjections = new sfn.Pass(this, 'MergeProjections', {
      parameters: {
        'decisionId.$': '$.decisionId',
        'tenantId.$': '$.tenantId',
        'userId.$': '$.userId',
        'region.$': '$.region',
        'trigger.$': '$.trigger',
        'triggerContext.$': '$.triggerContext',
        'triggerAmountCentsContainer.$': '$.triggerAmountCentsContainer',
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
        'triggerAmountCentsContainer.$': '$.triggerAmountCentsContainer',
        // Preserve agentResults through the mandate-lookup branch so PE+AN can
        // still resolve $.agentResults.InvokeInvestorProfile.agentOutput +
        // $.agentResults.InvokeMarketIntelligence.agentOutput downstream.
        // Pass-only state replaces top-level state; without this line the
        // ParallelProjections + MergeProjections output would be dropped here.
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
        'triggerAmountCentsContainer.$': '$.triggerAmountCentsContainer',
        // Preserve agentResults through the mandate-hoist branch — same reason
        // as SetInvestorProfile above (Pass replaces top-level state).
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

    // Both ResolveTriggerAmountCents branches (hit + miss) converge on
    // parallelProjections via afterwards(), mirroring the mandateResolved pattern.
    const amountCentsResolved = resolveTriggerAmountCents
      .afterwards()
      .next(parallelProjections);

    const definition = unpackTriggerEnvelope
      .next(amountCentsResolved)
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
