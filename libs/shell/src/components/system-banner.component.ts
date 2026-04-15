import { Component, computed, inject } from '@angular/core';
import { FeatureFlagsStore } from '@nestfolio/ui/feature-flags';

@Component({
  selector: 'app-system-banner',
  standalone: true,
  template: `
    @if (show()) {
      <div class="system-banner" role="alert">
        <span class="system-banner__icon">&#9888;</span>
        <span class="system-banner__message">{{ message() }}</span>
      </div>
    }
  `,
  styles: [`
    .system-banner {
      background: var(--warn-bg, #fff3cd);
      color: var(--warn-text, #856404);
      padding: 0.75rem 1rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.875rem;
    }
  `],
})
export class SystemBannerComponent {
  private readonly store = inject(FeatureFlagsStore);

  show = computed(() => this.store.disabledFlags().length > 0);
  message = computed(() => {
    const flags = this.store.disabledFlags();
    return flags.length > 0 ? (flags[0].reason ?? 'Some features are temporarily unavailable') : '';
  });
}
