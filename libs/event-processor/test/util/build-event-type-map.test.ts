import { buildEventTypeMap } from '../../src/util/build-event-type-map';

describe('buildEventTypeMap', () => {
  it('generates INSERT + MODIFY mappings from publishable types', () => {
    const result = buildEventTypeMap(['Goal', 'RiskProfile']);
    expect(result).toEqual({
      'Goal:INSERT': 'GOAL_CREATED',
      'Goal:MODIFY': 'GOAL_UPDATED',
      'RiskProfile:INSERT': 'RISK_PROFILE_CREATED',
      'RiskProfile:MODIFY': 'RISK_PROFILE_UPDATED',
    });
  });

  it('converts PascalCase to SCREAMING_SNAKE', () => {
    const result = buildEventTypeMap(['DecisionPacket', 'VirtualCashBalance']);
    expect(result['DecisionPacket:INSERT']).toBe('DECISION_PACKET_CREATED');
    expect(result['VirtualCashBalance:MODIFY']).toBe('VIRTUAL_CASH_BALANCE_UPDATED');
  });

  it('applies custom overrides', () => {
    const result = buildEventTypeMap(
      ['Deposit', 'Withdrawal'],
      { 'Deposit:INSERT': 'DEPOSIT_INITIATED', 'Withdrawal:INSERT': 'WITHDRAWAL_REQUESTED' },
    );
    expect(result).toEqual({
      'Deposit:INSERT': 'DEPOSIT_INITIATED',
      'Deposit:MODIFY': 'DEPOSIT_UPDATED',
      'Withdrawal:INSERT': 'WITHDRAWAL_REQUESTED',
      'Withdrawal:MODIFY': 'WITHDRAWAL_UPDATED',
    });
  });

  it('returns empty map for empty input', () => {
    expect(buildEventTypeMap([])).toEqual({});
  });
});
