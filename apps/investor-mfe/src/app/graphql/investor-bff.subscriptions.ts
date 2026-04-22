export const ON_DEPOSIT_EVENT = `
  subscription OnDepositEvent($depositId: ID!) {
    onDepositEvent(depositId: $depositId) {
      depositId
      tenantId
      status
      amountCents
      currency
      occurredAt
      reason
    }
  }
`;
