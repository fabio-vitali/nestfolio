import { TestBed, ComponentFixture } from '@angular/core/testing';
import { Router } from '@angular/router';
import { I18nService } from '@nestfolio/shell/i18n';
import { GoLiveCtaComponent } from '../../../../src/app/settings/go-live/go-live-cta.component';

const MockI18nService = {
  t: (key: string) => key,
};

describe('GoLiveCtaComponent', () => {
  let component: GoLiveCtaComponent;
  let fixture: ComponentFixture<GoLiveCtaComponent>;
  let router: { navigate: jest.Mock };

  beforeEach(async () => {
    router = { navigate: jest.fn() };

    await TestBed.configureTestingModule({
      imports: [GoLiveCtaComponent],
      providers: [
        { provide: I18nService, useValue: MockI18nService },
        { provide: Router, useValue: router },
      ],
    })
      .overrideComponent(GoLiveCtaComponent, {
        set: {
          template: `<div data-testid="go-live-cta">{{ executionMode }}</div>`,
          imports: [],
          styles: [],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(GoLiveCtaComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should default executionMode to null', () => {
    expect(component.executionMode).toBeNull();
  });

  it('should accept executionMode input', () => {
    component.executionMode = 'simulation';
    expect(component.executionMode).toBe('simulation');
  });

  it('should navigate to /settings/go-live when navigateToWizard is called', () => {
    component.navigateToWizard();
    expect(router.navigate).toHaveBeenCalledWith(['/settings', 'go-live']);
  });
});
