import { Component, inject, output, signal, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CardModule } from 'primeng/card';
import { I18nService } from '@nestfolio/i18n';
import type { OperatingMode } from '../../stores/onboarding.store';

interface ModeOption {
  value: OperatingMode;
  titleKey: string;
  descriptionKey: string;
  icon: string;
}

const MODE_OPTIONS: ModeOption[] = [
  {
    value: 'CONSERVATIVE',
    titleKey: 'onboarding.mode.conservative.title',
    descriptionKey: 'onboarding.mode.conservative.description',
    icon: 'pi-shield',
  },
  {
    value: 'BALANCED',
    titleKey: 'onboarding.mode.balanced.title',
    descriptionKey: 'onboarding.mode.balanced.description',
    icon: 'pi-chart-bar',
  },
  {
    value: 'AGGRESSIVE',
    titleKey: 'onboarding.mode.aggressive.title',
    descriptionKey: 'onboarding.mode.aggressive.description',
    icon: 'pi-bolt',
  },
];

@Component({
  selector: 'app-operating-mode-step',
  standalone: true,
  imports: [CommonModule, CardModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mode-step">
      <h3>{{ i18n.t('onboarding.mode.title') }}</h3>
      <p class="step-description">{{ i18n.t('onboarding.mode.description') }}</p>

      <div class="mode-cards">
        @for (mode of modes; track mode.value) {
          <div
            class="mode-card"
            [class.selected]="selectedMode() === mode.value"
            (click)="selectMode(mode.value)"
            role="button"
            [attr.aria-pressed]="selectedMode() === mode.value"
            tabindex="0"
            (keydown.enter)="selectMode(mode.value)"
            (keydown.space)="selectMode(mode.value)"
          >
            <div class="mode-icon">
              <i class="pi" [ngClass]="mode.icon"></i>
            </div>
            <h4>{{ i18n.t(mode.titleKey) }}</h4>
            <p>{{ i18n.t(mode.descriptionKey) }}</p>
            @if (selectedMode() === mode.value) {
              <div class="check-badge">
                <i class="pi pi-check"></i>
              </div>
            }
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    .mode-step {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }
    h3 {
      margin: 0;
      font-size: 1.25rem;
      color: var(--nf-text-primary);
    }
    .step-description {
      margin: 0;
      color: var(--nf-text-secondary);
      font-size: 0.9375rem;
    }
    .mode-cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 1rem;
    }
    .mode-card {
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      padding: 1.5rem 1rem;
      border: 2px solid var(--nf-bg-secondary, #e9ecef);
      border-radius: 12px;
      cursor: pointer;
      transition: border-color 0.2s, box-shadow 0.2s;
      background: var(--nf-bg-primary, #fff);
    }
    .mode-card:hover {
      border-color: var(--p-primary-300);
    }
    .mode-card.selected {
      border-color: var(--p-primary-500);
      box-shadow: 0 0 0 3px rgba(var(--p-primary-500-rgb, 59, 130, 246), 0.15);
    }
    .mode-icon {
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: var(--nf-bg-secondary, #f0f4ff);
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 0.75rem;
    }
    .mode-icon i {
      font-size: 1.5rem;
      color: var(--p-primary-500);
    }
    .mode-card h4 {
      margin: 0 0 0.25rem;
      font-size: 1rem;
      font-weight: 600;
    }
    .mode-card p {
      margin: 0;
      font-size: 0.8125rem;
      color: var(--nf-text-secondary);
    }
    .check-badge {
      position: absolute;
      top: 0.5rem;
      right: 0.5rem;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      background: var(--p-primary-500);
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .check-badge i {
      font-size: 0.75rem;
      color: #fff;
    }
  `],
})
export class OperatingModeStepComponent {
  readonly i18n = inject(I18nService);
  readonly modeChange = output<OperatingMode>();

  readonly modes = MODE_OPTIONS;
  readonly selectedMode = signal<OperatingMode | null>(null);

  selectMode(mode: OperatingMode): void {
    this.selectedMode.set(mode);
    this.modeChange.emit(mode);
  }
}
