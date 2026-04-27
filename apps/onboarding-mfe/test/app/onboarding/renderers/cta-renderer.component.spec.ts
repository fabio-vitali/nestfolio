import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CtaRendererComponent } from '../../../../src/app/onboarding/renderers/cta-renderer.component';

describe('CtaRendererComponent', () => {
  let fixture: ComponentFixture<CtaRendererComponent>;
  let component: CtaRendererComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CtaRendererComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(CtaRendererComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('label', 'Inizia ora');
    fixture.componentRef.setInput('action', 'start_onboarding');
    fixture.detectChanges();
  });

  it('renders button with label', () => {
    const button = fixture.nativeElement.querySelector('.cta-button');
    expect(button).not.toBeNull();
    expect(button.textContent).toContain('Inizia ora');
  });

  it('emits action string on click', () => {
    const spy = jest.fn();
    component.clicked.subscribe(spy);
    const button = fixture.nativeElement.querySelector('.cta-button');
    button.click();
    expect(spy).toHaveBeenCalledWith('start_onboarding');
  });

  it('renders data-testid="cta-primary" on the button', () => {
    expect(fixture.nativeElement.querySelector('[data-testid="cta-primary"]')).toBeTruthy();
  });
});
