import { ComponentFixture, TestBed } from '@angular/core/testing';
import { OptionsRendererComponent } from '../../../../src/app/onboarding/renderers/options-renderer.component';

describe('OptionsRendererComponent', () => {
  let fixture: ComponentFixture<OptionsRendererComponent>;
  let component: OptionsRendererComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OptionsRendererComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(OptionsRendererComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('title', 'Obiettivo');
    fixture.componentRef.setInput('options', [
      { id: 'grow', emoji: '📈', label: 'Crescita' },
      { id: 'home', emoji: '🏠', label: 'Immobile' },
    ]);
    fixture.detectChanges();
  });

  it('renders title', () => {
    expect(fixture.nativeElement.textContent).toContain('Obiettivo');
  });

  it('renders option cards', () => {
    const cards = fixture.nativeElement.querySelectorAll('.option-card');
    expect(cards.length).toBe(2);
  });

  it('emits selected option on click', () => {
    const spy = jest.fn();
    component.selected.subscribe(spy);
    const cards = fixture.nativeElement.querySelectorAll('.option-card');
    cards[0].click();
    expect(spy).toHaveBeenCalledWith('grow');
  });

  it('marks card as selected after click', () => {
    const cards = fixture.nativeElement.querySelectorAll('.option-card');
    cards[1].click();
    fixture.detectChanges();
    expect(component.selectedId).toBe('home');
  });

  it('renders data-testid attribute per option id', () => {
    fixture.componentRef.setInput('options', [
      { id: 'GROWTH', emoji: '📈', label: 'Crescita' },
      { id: 'INCOME', label: 'Reddito' },
    ]);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="option-GROWTH"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="option-INCOME"]')).toBeTruthy();
  });
});
