import { Component, input, output } from '@angular/core';

@Component({
  selector: 'app-cta-renderer',
  standalone: true,
  template: `
    <div class="cta-container">
      <button class="cta-button" data-testid="cta-primary" (click)="onClick()">{{ label() }}</button>
    </div>
  `,
  styles: [`
    .cta-container { display: flex; justify-content: center; }
    .cta-button {
      padding: 0.75rem 2rem; border: none; border-radius: 12px;
      background: var(--p-primary-color, #6366f1); color: white;
      font-weight: 700; font-size: 1rem; cursor: pointer; transition: opacity 0.2s;
    }
    .cta-button:hover { opacity: 0.85; }
  `],
})
export class CtaRendererComponent {
  label = input.required<string>();
  action = input.required<string>();
  clicked = output<string>();

  onClick(): void {
    this.clicked.emit(this.action());
  }
}
