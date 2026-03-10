import { Component, input, computed } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'nf-agent-badge',
  standalone: true,
  imports: [CommonModule],
  template: `
    <span class="nf-agent-badge" [ngClass]="'nf-agent-badge--' + tierClass()">
      <span class="nf-agent-badge__icon">{{ tierIcon() }}</span>
      <span class="nf-agent-badge__name">{{ agentName() }}</span>
      <span class="nf-agent-badge__model">{{ modelLabel() }}</span>
    </span>
  `,
  styles: [`
    .nf-agent-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.375rem;
      padding: 0.25rem 0.625rem;
      border-radius: 1rem;
      font-size: 0.75rem;
      font-weight: 500;
      line-height: 1.2;
    }

    .nf-agent-badge__icon {
      font-size: 0.875rem;
    }

    .nf-agent-badge__name {
      font-weight: 600;
    }

    .nf-agent-badge__model {
      opacity: 0.8;
    }

    .nf-agent-badge--opus {
      background: var(--p-purple-100);
      color: var(--p-purple-700);
    }

    .nf-agent-badge--sonnet {
      background: var(--p-blue-100);
      color: var(--p-blue-700);
    }

    .nf-agent-badge--haiku {
      background: var(--p-green-100);
      color: var(--p-green-700);
    }

    .nf-agent-badge--deterministic {
      background: var(--p-surface-200);
      color: var(--p-surface-700);
    }
  `],
})
export class AgentBadgeComponent {
  agentName = input.required<string>();
  tier = input.required<string>();

  tierClass = computed(() => {
    const t = this.tier().toLowerCase();
    if (t.includes('opus')) return 'opus';
    if (t.includes('sonnet')) return 'sonnet';
    if (t.includes('haiku')) return 'haiku';
    return 'deterministic';
  });

  tierIcon = computed(() => {
    const t = this.tier().toLowerCase();
    if (t.includes('opus')) return '\u2666';
    if (t.includes('sonnet')) return '\u25C6';
    if (t.includes('haiku')) return '\u25CB';
    return '\u2699';
  });

  modelLabel = computed(() => {
    const t = this.tier();
    if (!t) return '';
    // Show the tier as-is (e.g. "Claude Opus 4.6", "deterministic")
    return t;
  });
}
