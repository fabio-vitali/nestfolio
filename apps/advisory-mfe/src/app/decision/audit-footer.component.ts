import { Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';

@Component({
  selector: 'app-audit-footer',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  template: `
    <div class="audit-footer">
      <div class="audit-line">
        <span class="audit-label">{{ 'advisory.detail.auditDecisionId' | translate }}</span>
        <code class="audit-value">{{ decisionId() }}</code>
      </div>
      <div class="audit-line">
        <span class="audit-label">{{ 'advisory.detail.auditModels' | translate }}</span>
        <span class="audit-value">{{ modelVersions().join(', ') || '-' }}</span>
      </div>
      <div class="audit-line">
        <span class="audit-label">{{ 'advisory.detail.auditCreatedAt' | translate }}</span>
        <span class="audit-value">{{ createdAt() | date:'medium' }}</span>
      </div>
      <div class="audit-line">
        <span class="audit-label">{{ 'advisory.detail.auditVersion' | translate }}</span>
        <span class="audit-value">v{{ version() }}</span>
      </div>
    </div>
  `,
  styles: [`
    .audit-footer {
      margin-top: 1rem;
      padding: 0.75rem 1rem;
      background: var(--p-surface-50);
      border: 1px solid var(--p-surface-200);
      border-radius: 0.5rem;
      font-size: 0.75rem;
    }

    .audit-line {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0.25rem 0;
    }

    .audit-line + .audit-line {
      border-top: 1px solid var(--p-surface-100);
    }

    .audit-label {
      color: var(--p-surface-500);
      font-weight: 500;
    }

    .audit-value {
      color: var(--p-surface-700);
      font-family: monospace;
      font-size: 0.6875rem;
    }

    code.audit-value {
      background: var(--p-surface-100);
      padding: 0.125rem 0.375rem;
      border-radius: 0.25rem;
    }
  `],
})
export class AuditFooterComponent {
  decisionId = input.required<string>();
  modelVersions = input.required<string[]>();
  createdAt = input.required<string>();
  version = input.required<number>();
}
