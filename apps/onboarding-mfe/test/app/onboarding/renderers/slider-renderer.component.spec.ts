import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SliderRendererComponent } from '../../../../src/app/onboarding/renderers/slider-renderer.component';

describe('SliderRendererComponent', () => {
  let fixture: ComponentFixture<SliderRendererComponent>;
  let component: SliderRendererComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SliderRendererComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(SliderRendererComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('label', 'Orizzonte temporale');
    fixture.componentRef.setInput('min', 1);
    fixture.componentRef.setInput('max', 30);
    fixture.componentRef.setInput('step', 1);
    fixture.componentRef.setInput('unit', 'anni');
    fixture.detectChanges();
  });

  it('renders label', () => {
    expect(fixture.nativeElement.textContent).toContain('Orizzonte temporale');
  });

  it('renders range input with correct attributes', () => {
    const input = fixture.nativeElement.querySelector('input[type="range"]');
    expect(input).not.toBeNull();
    expect(input.min).toBe('1');
    expect(input.max).toBe('30');
    expect(input.step).toBe('1');
  });

  it('emits value on input change', () => {
    const spy = jest.fn();
    component.valueChange.subscribe(spy);
    const input = fixture.nativeElement.querySelector('input[type="range"]');
    Object.defineProperty(input, 'value', { value: '10', writable: true });
    input.dispatchEvent(new Event('input'));
    expect(spy).toHaveBeenCalledWith(10);
  });

  it('renders unit in label', () => {
    expect(fixture.nativeElement.textContent).toContain('anni');
  });

  it('renders data-testid="slider-input" on the range input', () => {
    expect(fixture.nativeElement.querySelector('[data-testid="slider-input"]')).toBeTruthy();
  });
});
