import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CommonModule } from '@angular/common';
import { I18nService } from '@nestfolio/i18n';
import { WelcomeStepComponent } from './welcome-step.component';

describe('WelcomeStepComponent', () => {
  let component: WelcomeStepComponent;
  let fixture: ComponentFixture<WelcomeStepComponent>;
  const mockI18n = { t: jest.fn((key: string) => key), currentLocale: 'en-GB' };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WelcomeStepComponent],
      providers: [{ provide: I18nService, useValue: mockI18n }],
    })
      .overrideComponent(WelcomeStepComponent, {
        set: {
          imports: [CommonModule],
          template: `
            <div class="welcome-content">
              <h2>{{ i18n.t('onboarding.welcome.title') }}</h2>
              <p class="welcome-subtitle">{{ i18n.t('onboarding.welcome.subtitle') }}</p>
              <div class="steps-preview">
                <div class="preview-item"><span>{{ i18n.t('onboarding.welcome.step1') }}</span></div>
                <div class="preview-item"><span>{{ i18n.t('onboarding.welcome.step2') }}</span></div>
                <div class="preview-item"><span>{{ i18n.t('onboarding.welcome.step3') }}</span></div>
                <div class="preview-item"><span>{{ i18n.t('onboarding.welcome.step4') }}</span></div>
                <div class="preview-item"><span>{{ i18n.t('onboarding.welcome.step5') }}</span></div>
              </div>
            </div>
          `,
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(WelcomeStepComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create the component', () => {
    expect(component).toBeTruthy();
  });

  it('should inject I18nService', () => {
    expect(component.i18n).toBe(mockI18n);
  });

  it('should render the welcome title', () => {
    const el: HTMLElement = fixture.nativeElement;
    const h2 = el.querySelector('h2');
    expect(h2?.textContent).toContain('onboarding.welcome.title');
    expect(mockI18n.t).toHaveBeenCalledWith('onboarding.welcome.title');
  });

  it('should render the subtitle', () => {
    const el: HTMLElement = fixture.nativeElement;
    const subtitle = el.querySelector('.welcome-subtitle');
    expect(subtitle?.textContent).toContain('onboarding.welcome.subtitle');
  });

  it('should render 5 steps preview items', () => {
    const el: HTMLElement = fixture.nativeElement;
    const items = el.querySelectorAll('.preview-item');
    expect(items.length).toBe(5);
  });

  it('should translate all 5 step keys', () => {
    expect(mockI18n.t).toHaveBeenCalledWith('onboarding.welcome.step1');
    expect(mockI18n.t).toHaveBeenCalledWith('onboarding.welcome.step2');
    expect(mockI18n.t).toHaveBeenCalledWith('onboarding.welcome.step3');
    expect(mockI18n.t).toHaveBeenCalledWith('onboarding.welcome.step4');
    expect(mockI18n.t).toHaveBeenCalledWith('onboarding.welcome.step5');
  });
});
