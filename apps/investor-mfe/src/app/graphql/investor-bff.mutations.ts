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

export const CONFIRM_GO_LIVE = `
  mutation ConfirmGoLive {
    confirmGoLive {
      executionMode
    }
  }
`;

export const UPDATE_RISK_PROFILE = `
  mutation UpdateRiskProfile($toleranceIdx: Int!, $experienceIdx: Int!) {
    updateRiskProfile(toleranceIdx: $toleranceIdx, experienceIdx: $experienceIdx) {
      riskProfile { score band { minEquity maxEquity } toleranceResponse experienceLevel }
    }
  }
`;

export const UPDATE_GOAL = `
  mutation UpdateGoal($input: GoalInput!) {
    updateGoal(input: $input) {
      objective
      timeHorizonMonths
      targetAmountCents
      currency
      targetReturn
    }
  }
`;

export const UPDATE_OPERATING_MODE = `
  mutation UpdateOperatingMode($mode: OperatingMode!) {
    updateOperatingMode(mode: $mode) {
      operatingMode
    }
  }
`;
