import { Injectable, inject } from '@angular/core';
import { GraphqlService, GET_SIMULATION_COMPARISON } from '@nestfolio/appsync-client';

export interface PortfolioReturnSummary {
  totalValueCents: number;
  cashBalanceCents: number;
  positionCount: number;
  totalReturnPercent: number;
  totalReturnCents: number;
}

export interface PositionDifference {
  symbol: string;
  actualQuantity: number;
  simulatedQuantity: number;
  quantityDifference: number;
  actualValueCents: number;
  simulatedValueCents: number;
}

export interface ComparisonDivergence {
  returnDifferencePercent: number;
  returnDifferenceCents: number;
  positionDifferences: PositionDifference[];
  missedDecisions: number;
  totalDecisions: number;
}

export interface SimulationComparison {
  actual: PortfolioReturnSummary;
  simulated: PortfolioReturnSummary;
  divergence: ComparisonDivergence;
}

interface SimulationComparisonResponse {
  getSimulationComparison: SimulationComparison;
}

@Injectable({ providedIn: 'root' })
export class ComparisonService {
  private readonly graphql = inject(GraphqlService);

  async getSimulationComparison(): Promise<SimulationComparison> {
    const data = await this.graphql.query<SimulationComparisonResponse>(
      GET_SIMULATION_COMPARISON,
    );
    return data.getSimulationComparison;
  }
}
