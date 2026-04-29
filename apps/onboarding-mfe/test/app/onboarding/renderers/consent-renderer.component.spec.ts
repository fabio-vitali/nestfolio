import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ConsentRendererComponent } from '../../../../src/app/onboarding/renderers/consent-renderer.component';

describe('ConsentRendererComponent', () => {
  let fixture: ComponentFixture<ConsentRendererComponent>;
  let component: ConsentRendererComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ConsentRendererComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(ConsentRendererComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('label', 'Accetto i termini e condizioni');
    fixture.componentRef.setInput('links', [
      { text: 'Privacy Policy', url: 'https://example.com/privacy' },
      { text: 'Termini di servizio', url: 'https://example.com/terms' },
    ]);
    fixture.detectChanges();
  });

  it('renders checkbox', () => {
    const checkbox = fixture.nativeElement.querySelector('input[type="checkbox"]');
    expect(checkbox).not.toBeNull();
  });

  it('renders label text', () => {
    expect(fixture.nativeElement.textContent).toContain('Accetto i termini e condizioni');
  });

  it('renders legal links', () => {
    const links = fixture.nativeElement.querySelectorAll('.consent-link');
    expect(links.length).toBe(2);
    expect(links[0].textContent).toContain('Privacy Policy');
  });

  it('emits true when checkbox is checked', () => {
    const spy = jest.fn();
    component.accepted.subscribe(spy);
    const checkbox = fixture.nativeElement.querySelector('input[type="checkbox"]');
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    expect(spy).toHaveBeenCalledWith(true);
  });

  it('emits false when checkbox is unchecked', () => {
    const spy = jest.fn();
    component.accepted.subscribe(spy);
    const checkbox = fixture.nativeElement.querySelector('input[type="checkbox"]');
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change'));
    expect(spy).toHaveBeenCalledWith(false);
  });

  it('renders data-testid="consent-accept" on the checkbox', () => {
    expect(fixture.nativeElement.querySelector('[data-testid="consent-accept"]')).toBeTruthy();
  });
});
