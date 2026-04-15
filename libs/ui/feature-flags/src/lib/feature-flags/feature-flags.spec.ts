import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FeatureFlags } from './feature-flags';

describe('FeatureFlags', () => {
  let component: FeatureFlags;
  let fixture: ComponentFixture<FeatureFlags>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FeatureFlags],
    }).compileComponents();

    fixture = TestBed.createComponent(FeatureFlags);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
