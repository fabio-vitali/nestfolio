import { Component, EventEmitter, Input, Output, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SliderModule } from 'primeng/slider';

@Component({
  selector: 'app-timeline-slider',
  standalone: true,
  imports: [CommonModule, FormsModule, SliderModule],
  template: `
    <div class="timeline-slider">
      <label class="timeline-label">{{ dateLabel }}</label>
      <p-slider
        [(ngModel)]="sliderValue"
        [min]="0"
        [max]="totalDays"
        [step]="1"
        (onSlideEnd)="onSlideEnd()"
        styleClass="w-full"
      />
      <div class="timeline-range">
        <span>{{ oldestDate }}</span>
        <span>{{ latestDate }}</span>
      </div>
    </div>
  `,
  styles: [`
    .timeline-slider {
      padding: 1rem;
      background: var(--surface-card, #ffffff);
      border-radius: 8px;
      border: 1px solid var(--surface-border, #dee2e6);
    }

    .timeline-label {
      display: block;
      font-weight: 600;
      margin-bottom: 0.75rem;
      font-size: 0.875rem;
      color: var(--text-color, #495057);
    }

    .timeline-range {
      display: flex;
      justify-content: space-between;
      margin-top: 0.5rem;
      font-size: 0.75rem;
      color: var(--text-color-secondary, #6c757d);
    }

    :host ::ng-deep .w-full {
      width: 100%;
    }
  `],
})
export class TimelineSliderComponent implements OnInit {
  @Input() oldestDate = '';
  @Input() latestDate = '';
  @Output() dateSelected = new EventEmitter<string>();

  sliderValue = 0;
  totalDays = 0;
  dateLabel = '';

  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  ngOnInit(): void {
    if (this.oldestDate && this.latestDate) {
      const start = new Date(this.oldestDate);
      const end = new Date(this.latestDate);
      this.totalDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
      this.sliderValue = this.totalDays;
      this.updateLabel();
      this.dateSelected.emit(this.getDateForValue(this.sliderValue));
    }
  }

  onSlideEnd(): void {
    this.updateLabel();
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      const date = this.getDateForValue(this.sliderValue);
      this.dateSelected.emit(date);
    }, 300);
  }

  private updateLabel(): void {
    const date = this.getDateForValue(this.sliderValue);
    this.dateLabel = `Portfolio as of ${date}`;
  }

  private getDateForValue(value: number): string {
    const start = new Date(this.oldestDate);
    const target = new Date(start.getTime() + value * 24 * 60 * 60 * 1000);
    return target.toISOString().slice(0, 10);
  }
}
