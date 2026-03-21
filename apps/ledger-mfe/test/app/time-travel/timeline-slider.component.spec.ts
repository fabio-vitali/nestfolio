import { setupComponentTest } from '@nestfolio/shell/testing';
import { TimelineSliderComponent } from '../../../src/app/time-travel/timeline-slider.component';

describe('TimelineSliderComponent', () => {
  let component: TimelineSliderComponent;

  beforeEach(async () => {
    const fixture = await setupComponentTest(TimelineSliderComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should calculate totalDays from date inputs', () => {
    component.oldestDate = '2025-01-01';
    component.latestDate = '2025-01-31';
    component.ngOnInit();

    expect(component.totalDays).toBe(30);
  });

  it('should initialize slider to latest date (rightmost)', () => {
    component.oldestDate = '2025-01-01';
    component.latestDate = '2025-01-31';
    component.ngOnInit();

    expect(component.sliderValue).toBe(component.totalDays);
  });

  it('should emit dateSelected on init with latest date', () => {
    const emitSpy = jest.spyOn(component.dateSelected, 'emit');
    component.oldestDate = '2025-01-01';
    component.latestDate = '2025-01-31';
    component.ngOnInit();

    expect(emitSpy).toHaveBeenCalledWith('2025-01-31');
  });

  it('should emit dateSelected on slide end after debounce', () => {
    jest.useFakeTimers();
    const emitSpy = jest.spyOn(component.dateSelected, 'emit');

    component.oldestDate = '2025-01-01';
    component.latestDate = '2025-01-31';
    component.ngOnInit();
    emitSpy.mockClear();

    component.sliderValue = 15;
    component.onSlideEnd();

    jest.advanceTimersByTime(300);
    expect(emitSpy).toHaveBeenCalledWith('2025-01-16');

    jest.useRealTimers();
  });

  it('should update date label on slide end', () => {
    component.oldestDate = '2025-01-01';
    component.latestDate = '2025-01-31';
    component.ngOnInit();

    component.sliderValue = 0;
    component.onSlideEnd();

    expect(component.dateLabel).toBe('Portfolio as of 2025-01-01');
  });

  it('should render date range labels', () => {
    component.oldestDate = '2025-01-01';
    component.latestDate = '2025-06-15';
    component.ngOnInit();

    expect(component.oldestDate).toBe('2025-01-01');
    expect(component.latestDate).toBe('2025-06-15');
  });

  it('should handle minimum totalDays of 1', () => {
    component.oldestDate = '2025-01-01';
    component.latestDate = '2025-01-01';
    component.ngOnInit();

    expect(component.totalDays).toBe(1);
  });
});
