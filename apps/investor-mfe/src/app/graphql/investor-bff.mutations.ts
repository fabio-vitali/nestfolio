export const INITIATE_DEPOSIT = `
  mutation InitiateDeposit($input: DepositInput!) {
    initiateDeposit(input: $input) {
      depositId
      amountCents
      currency
      status
      initiatedAt
      detectedAt
      failedAt
      reason
    }
  }
`;
