import * as fs from 'node:fs';
import * as path from 'node:path';
import { EventSubjects } from '../src';

const EXPECTED = [
  'CONSTRUCT_PORTFOLIO',
  'DECISION_APPROVED','DECISION_BLOCKED',
  'DECISION_CYCLE_FAILED','DECISION_CYCLE_STARTED','DECISION_PACKET_CREATED','DECISION_PACKET_UPDATED',
  'DEPOSIT_INITIATED','EXECUTION_MODE_CHANGED','EXECUTION_MODE_CHANGE_UPDATED','EXPLANATION_GENERATED',
  'GENERATE_NARRATIVE',
  'GOAL_UPDATED',
  'INVESTOR_PROFILE_CREATED','INVESTOR_PROFILE_SNAPSHOT_CREATED','INVESTOR_PROFILE_SNAPSHOT_UPDATED',
  'INVESTOR_PROFILE_UPDATED','MANDATE_ISSUED','MANDATE_REAFFIRMED',
  'MANDATE_REVOKED','MANDATE_SNAPSHOT_CREATED','MARKET_SNAPSHOT_REFRESH_TICK','MARKET_SNAPSHOT_UPDATED',
  'MONTHLY_REPORT_CREATED','MONTHLY_REPORT_UPDATED',
  'NARRATIVE_COMPLETED','NARRATIVE_FAILED',
  'NOTIFICATION_CREATED','NOTIFICATION_READ','NOTIFICATION_UPDATED','ONBOARDING_COMPLETED',
  'OPERATING_MODE_CHANGED','PORTFOLIO_COMPLETED','PORTFOLIO_FAILED','RECOMMENDATION_PROPOSED',
  'WITHDRAWAL_INITIATED',
].sort();

describe('EventSubjects registry', () => {
  it('contains exactly the migrated event names', () => {
    expect(Object.keys(EventSubjects).sort()).toEqual(EXPECTED);
  });

  it('tools/typed-fixture-registered-events.json is in sync with the TypeScript registry', () => {
    // The pure-Node gate (tools/check-typed-fixtures.mjs) cannot import TypeScript, so it reads
    // this JSON as its name-source. This test ensures the JSON never silently drifts from the
    // real registry: if you add/remove an event in EventSubjects, this test will fail until
    // you also update the JSON file.
    const jsonPath = path.join(process.cwd(), 'tools/typed-fixture-registered-events.json');
    const { registeredEvents } = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as {
      registeredEvents: string[];
    };

    expect(registeredEvents.slice().sort()).toEqual(Object.keys(EventSubjects).sort());
  });
});
