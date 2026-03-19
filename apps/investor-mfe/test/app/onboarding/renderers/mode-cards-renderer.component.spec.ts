import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ModeCardsRendererComponent } from '../../../../src/app/onboarding/renderers/mode-cards-renderer.component';

describe('ModeCardsRendererComponent', () => {
  let fixture: ComponentFixture<ModeCardsRendererComponent>;
  let component: ModeCardsRendererComponent;

  const testCards = [
    { id: 'auto', title: 'Automatico', badge: 'Consigliato', details: ['Gestione passiva', 'Ribilanciamento auto'] },
    { id: 'manual', title: 'Manuale', details: ['Pieno controllo', 'Richiede esperienza'] },
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ModeCardsRendererComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(ModeCardsRendererComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('title', 'Modalità di gestione');
    fixture.componentRef.setInput('cards', testCards);
    fixture.detectChanges();
  });

  it('renders title', () => {
    expect(fixture.nativeElement.textContent).toContain('Modalità di gestione');
  });

  it('renders all cards', () => {
    const cards = fixture.nativeElement.querySelectorAll('.mode-card');
    expect(cards.length).toBe(2);
  });

  it('renders badge on card with badge', () => {
    const badge = fixture.nativeElement.querySelector('.mode-badge');
    expect(badge).not.toBeNull();
    expect(badge.textContent).toContain('Consigliato');
  });

  it('emits card id on click', () => {
    const spy = jest.fn();
    component.selected.subscribe(spy);
    const cards = fixture.nativeElement.querySelectorAll('.mode-card');
    cards[0].click();
    expect(spy).toHaveBeenCalledWith('auto');
  });

  it('renders detail items', () => {
    expect(fixture.nativeElement.textContent).toContain('Gestione passiva');
  });
});
