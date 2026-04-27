import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SummaryRendererComponent } from '../../../../src/app/onboarding/renderers/summary-renderer.component';

describe('SummaryRendererComponent', () => {
  let fixture: ComponentFixture<SummaryRendererComponent>;

  const testRows = [
    { label: 'Obiettivo', value: 'Crescita' },
    { label: 'Orizzonte', value: '10 anni' },
    { label: 'Capitale', value: '€ 25.000' },
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SummaryRendererComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(SummaryRendererComponent);
    fixture.componentRef.setInput('title', 'Riepilogo');
    fixture.componentRef.setInput('rows', testRows);
    fixture.detectChanges();
  });

  it('renders title', () => {
    expect(fixture.nativeElement.textContent).toContain('Riepilogo');
  });

  it('renders all rows', () => {
    const rows = fixture.nativeElement.querySelectorAll('.summary-row');
    expect(rows.length).toBe(3);
  });

  it('renders row labels and values', () => {
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Obiettivo');
    expect(text).toContain('Crescita');
    expect(text).toContain('10 anni');
    expect(text).toContain('€ 25.000');
  });

  it('renders a Conferma button', () => {
    const btn = fixture.nativeElement.querySelector('.summary-confirm');
    expect(btn).toBeTruthy();
    expect(btn.textContent.trim()).toBe('Conferma');
  });

  it('emits confirmed when the Conferma button is clicked', () => {
    const emitted: void[] = [];
    fixture.componentInstance.confirmed.subscribe(() => emitted.push(undefined));

    const btn = fixture.nativeElement.querySelector('.summary-confirm') as HTMLButtonElement;
    btn.click();

    expect(emitted).toHaveLength(1);
  });

  it('renders data-testid="summary-confirm" on the Conferma button', () => {
    expect(fixture.nativeElement.querySelector('[data-testid="summary-confirm"]')).toBeTruthy();
  });
});
