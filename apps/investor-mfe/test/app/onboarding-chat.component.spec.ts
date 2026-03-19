import { ComponentFixture, TestBed } from '@angular/core/testing';
import { OnboardingChatComponent } from '../../src/app/onboarding/onboarding-chat.component';
import { provideRouter } from '@angular/router';

describe('OnboardingChatComponent', () => {
  let fixture: ComponentFixture<OnboardingChatComponent>;
  let component: OnboardingChatComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OnboardingChatComponent],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(OnboardingChatComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('renders agent header', () => {
    expect(fixture.nativeElement.querySelector('.agent-header')).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('Nestfolio');
  });

  it('renders progress bar', () => {
    expect(fixture.nativeElement.querySelector('.progress-bar')).toBeTruthy();
  });

  it('has default 7 total phases', () => {
    expect(component.totalPhases()).toBe(7);
  });
});
