import { Injectable, inject } from '@angular/core';
import {
  GraphqlService,
  GET_PORTFOLIO_AT,
  GET_TIME_TRAVEL_AVAILABILITY,
} from '@nestfolio/appsync-client';
import type { LedgerPortfolio } from '../stores/time-travel.store';

interface TimeTravelAvailabilityResponse {
  getTimeTravelAvailability: {
    available: boolean;
    oldestDate: string | null;
    latestDate: string | null;
  };
}

interface PortfolioAtResponse {
  getPortfolioAt: LedgerPortfolio;
}

@Injectable({ providedIn: 'root' })
export class TimeTravelService {
  private readonly graphql = inject(GraphqlService);

  async getAvailability(): Promise<{
    available: boolean;
    oldestDate: string | null;
    latestDate: string | null;
  }> {
    const data = await this.graphql.query<TimeTravelAvailabilityResponse>(
      GET_TIME_TRAVEL_AVAILABILITY,
    );
    return data.getTimeTravelAvailability;
  }

  async getPortfolioAt(streamType: string, timestamp: string): Promise<LedgerPortfolio> {
    const data = await this.graphql.query<PortfolioAtResponse>(
      GET_PORTFOLIO_AT,
      { streamType, timestamp },
    );
    return data.getPortfolioAt;
  }
}
