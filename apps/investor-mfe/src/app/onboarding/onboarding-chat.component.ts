import { Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-onboarding-chat',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="chat-screen">
      <header class="agent-header">
        <div class="agent-avatar">N</div>
        <div>
          <div class="agent-name">Nestfolio</div>
          <div class="agent-status">Attivo ora</div>
        </div>
      </header>
      <div class="progress-bar">
        <div class="progress-fill" [style.width.%]="progressPercent()"></div>
        <span class="progress-label">{{ phaseIndex() + 1 }} di {{ totalPhases() }}</span>
      </div>
      <div class="chat-area">
        <div class="chat-placeholder">Chat agent loading...</div>
      </div>
    </div>
  `,
  styleUrl: './onboarding-theme.css',
})
export class OnboardingChatComponent {
  phaseIndex = signal(0);
  totalPhases = signal(7);
  progressPercent = computed(() => ((this.phaseIndex() + 1) / this.totalPhases()) * 100);
}
