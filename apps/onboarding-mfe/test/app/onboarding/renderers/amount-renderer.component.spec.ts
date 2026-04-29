import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AmountRendererComponent } from '../../../../src/app/onboarding/renderers/amount-renderer.component';

describe('AmountRendererComponent', () => {
  let fixture: ComponentFixture<AmountRendererComponent>;
  let component: AmountRendererComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AmountRendererComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(AmountRendererComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('label', 'Capitale iniziale');
    fixture.componentRef.setInput('currency', '€');
    fixture.componentRef.setInput('presets', [5000, 10000, 25000, 50000]);
    fixture.detectChanges();
  });

  it('renders label', () => {
    expect(fixture.nativeElement.textContent).toContain('Capitale iniziale');
  });

  it('renders preset buttons', () => {
    const buttons = fixture.nativeElement.querySelectorAll('.preset-btn');
    expect(buttons.length).toBe(4);
  });

  it('emits amount on preset click', () => {
    const spy = jest.fn();
    component.amountChange.subscribe(spy);
    const buttons = fixture.nativeElement.querySelectorAll('.preset-btn');
    buttons[1].click();
    expect(spy).toHaveBeenCalledWith(10000);
  });

  it('emits amount on custom input', () => {
    const spy = jest.fn();
    component.amountChange.subscribe(spy);
    const input = fixture.nativeElement.querySelector('.amount-input');
    Object.defineProperty(input, 'value', { value: '7500', writable: true });
    input.dispatchEvent(new Event('input'));
    expect(spy).toHaveBeenCalledWith(7500);
  });

  it('renders data-testid="amount-input" on the number input', () => {
    expect(fixture.nativeElement.querySelector('[data-testid="amount-input"]')).toBeTruthy();
  });
});
