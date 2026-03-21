import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { I18nService } from '@nestfolio/shell/i18n';
import { parseError } from '@nestfolio/shell';
import { LoadingSkeletonComponent } from '@nestfolio/ui';
import { ComparisonService, type SimulationComparison } from '../services/comparison.service';
import { ComparisonDetailComponent } from './comparison-detail.component';
import { ComparisonDivergenceTableComponent } from './comparison-divergence-table.component';

@Component({
  selector: 'app-comparison-container',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    ButtonModule,
    MessageModule,
    LoadingSkeletonComponent,
    ComparisonDetailComponent,
    ComparisonDivergenceTableComponent,
  ],
  template: `
    <div class="comparison-page">
      <div class="comparison-page-header">
        <h2 class="comparison-page-title">{{ i18n.t('dashboard.comparison.pageTitle') }}</h2>
        <p-button
          [label]="i18n.t('dashboard.comparison.backToDashboard')"
          [routerLink]="['..']"
          icon="pi pi-arrow-left"
          [text]="true"
          size="small"
        />
      </div>

      @if (loading()) {
        <nf-loading-skeleton [count]="6" />
      } @else if (error()) {
        <p-message severity="error" [text]="i18n.t(error()!)" styleClass="w-full" />
      } @else if (comparison()) {
        <app-comparison-detail
          [actual]="comparison()!.actual"
          [simulated]="comparison()!.simulated"
        />

        <app-comparison-divergence-table
          [divergence]="comparison()!.divergence"
        />
      } @else {
        <p-message severity="info" [text]="i18n.t('dashboard.comparison.noData')" styleClass="w-full" />
      }
    </div>
  `,
  styles: [`
    .comparison-page {
      display: flex;
      flex-direction: column;
      gap: 1rem;
      padding: 0.75rem;
      height: 100%;
    }

    .comparison-page-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .comparison-page-title {
      font-size: 1.25rem;
      font-weight: 600;
      margin: 0;
      color: var(--nf-text-primary, #212529);
    }

    .w-full { width: 100%; }
  `],
})
export class ComparisonContainerComponent implements OnInit {
  private readonly comparisonService = inject(ComparisonService);
  readonly i18n = inject(I18nService);

  readonly comparison = signal<SimulationComparison | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  ngOnInit(): void {
    void this.loadComparison();
  }

  private async loadComparison(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);

    try {
      const data = await this.comparisonService.getSimulationComparison();
      this.comparison.set(data);
    } catch (e: unknown) {
      this.error.set(parseError(e, 'errors.comparison'));
    } finally {
      this.loading.set(false);
    }
  }
}
