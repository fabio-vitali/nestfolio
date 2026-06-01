export const ON_DEPOSIT_UPDATE = `
  subscription OnDepositUpdate($depositId: ID!) {
    onDepositUpdate(depositId: $depositId) {
      depositId
      status
      amountCents
      currency
      detectedAt
      settledAt
      failedAt
      reason
    }
  }
`;

// Symmetric withdrawal live-push (design D3). No MFE page consumes it yet — the
// document exists so the funding read-model is symmetric and a future withdrawal
// pending-page can wire it without a BFF round-trip.
export const ON_WITHDRAWAL_UPDATE = `
  subscription OnWithdrawalUpdate($withdrawalId: ID!) {
    onWithdrawalUpdate(withdrawalId: $withdrawalId) {
      withdrawalId
      status
      amountCents
      currency
      settledAt
      failedAt
      reason
    }
  }
`;
