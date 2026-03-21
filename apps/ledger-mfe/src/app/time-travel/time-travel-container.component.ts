import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { I18nService } from '@nestfolio/shell/i18n';
import { parseError } from '@nestfolio/shell';
import { LoadingSkeletonComponent } from '@nestfolio/ui';
import { TimeTravelStore } from '../stores/time-travel.store';
import { TimeTravelService } from '../services/time-travel.service';
import { TimelineSliderComponent } from './timeline-slider.component';
import { TimeTravelPortfolioComponent } from './time-travel-portfolio.component';

@Component({
  selector: 'app-time-travel-container',
  standalone: true,
  imports: [
    CommonModule,
    ButtonModule,
    MessageModule,
    LoadingSkeletonComponent,
    TimelineSliderComponent,
    TimeTravelPortfolioComponent,
  ],
  template: `
    <div class="time-travel-page">
      <div class="time-travel-header">
        <h2>{{ i18n.t('dashboard.timeTravel.title') }}</h2>
        <p-button
          [label]="i18n.t('dashboard.timeTravel.backToNow')"
          icon="pi pi-arrow-left"
          [outlined]="true"
          size="small"
          (onClick)="backToNow()"
        />
      </div>

      @if (store.loading() && !store.available()) {
        <nf-loading-skeleton [count]="4" />
      } @else if (!store.available()) {
        <div class="unavailable">
          <p-message severity="info" [text]="i18n.t('dashboard.timeTravel.unavailable')" styleClass="w-full" />
        </div>
      } @else {
        @if (store.error()) {
          <p-message severity="error" [text]="i18n.t(store.error()!)" styleClass="w-full mb-1" />
        }

        <app-timeline-slider
          [oldestDate]="store.oldestDate()!"
          [latestDate]="store.latestDate()!"
          (dateSelected)="onDateSelected($event)"
        />

        @if (store.loading()) {
          <nf-loading-skeleton [count]="3" />
        } @else if (store.portfolio()) {
          <app-time-travel-portfolio
            [positions]="store.positions()"
            [totalValueCents]="store.totalValueCents()"
            [cashBalanceCents]="store.portfolio()!.cashBalanceCents"
          />
        }
      }
    </div>
  `,
  styles: [`
    .time-travel-page {
      display: flex;
      flex-direction: column;
      gap: 1rem;
      padding: 0.75rem;
      height: 100%;
    }

    .time-travel-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .time-travel-header h2 {
      margin: 0;
      font-size: 1.25rem;
      font-weight: 600;
    }

    .unavailable {
      display: flex;
      justify-content: center;
      padding: 2rem;
    }

    .w-full { width: 100%; }
    .mb-1 { margin-bottom: 0.5rem; }
  `],
})
export class TimeTravelContainerComponent implements OnInit {
  private readonly timeTravelService = inject(TimeTravelService);
  private readonly router = inject(Router);
  readonly i18n = inject(I18nService);
  readonly store = inject(TimeTravelStore);

  ngOnInit(): void {
    void this.loadAvailability();
  }

  async onDateSelected(date: string): Promise<void> {
    this.store.setSelectedDate(date);
    this.store.setLoading(true);
    this.store.setError(null);

    try {
      const portfolio = await this.timeTravelService.getPortfolioAt(
        'ACTUAL',
        `${date}T23:59:59.000Z`,
      );
      this.store.setPortfolio(portfolio);
    } catch (e: unknown) {
      this.store.setError(parseError(e, 'errors.timeTravel'));
    } finally {
      this.store.setLoading(false);
    }
  }

  backToNow(): void {
    this.store.reset();
    this.router.navigate(['/dashboard']);
  }

  private async loadAvailability(): Promise<void> {
    this.store.setLoading(true);

    try {
      const availability = await this.timeTravelService.getAvailability();
      this.store.setAvailability(availability);
    } catch (e: unknown) {
      this.store.setError(parseError(e, 'errors.timeTravel'));
    } finally {
      this.store.setLoading(false);
    }
  }
}
