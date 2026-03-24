import { Component, input, output, signal } from '@angular/core';

interface ConsentLink {
  text: string;
  url: string;
}

@Component({
  selector: 'app-consent-renderer',
  standalone: true,
  template: `
    <div class="consent-container">
      <label class="consent-label">
        <input
          type="checkbox"
          class="consent-checkbox"
          [checked]="isChecked()"
          (change)="onChange($event)"
        />
        <span>{{ label() }}</span>
      </label>
      @if (links() && links()!.length > 0) {
        <div class="consent-links">
          @for (link of links()!; track link.url) {
            <a [href]="link.url" target="_blank" rel="noopener noreferrer" class="consent-link">{{ link.text }}</a>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .consent-container { display: flex; flex-direction: column; gap: 0.5rem; }
    .consent-label { display: flex; align-items: flex-start; gap: 0.5rem; cursor: pointer; font-size: 0.9rem; }
    .consent-checkbox { margin-top: 0.15rem; accent-color: var(--p-primary-color); width: 1rem; height: 1rem; cursor: pointer; }
    .consent-links { display: flex; flex-wrap: wrap; gap: 0.5rem; padding-left: 1.5rem; }
    .consent-link { font-size: 0.8rem; color: var(--p-primary-color); text-decoration: underline; }
  `],
})
export class ConsentRendererComponent {
  label = input.required<string>();
  links = input<ConsentLink[] | null>(null);
  accepted = output<boolean>();

  isChecked = signal(false);

  onChange(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.isChecked.set(checked);
    this.accepted.emit(checked);
  }
}
