import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LoadingSkeletonComponent } from '@nestfolio/ui-components';

describe('LoadingSkeletonComponent', () => {
  let fixture: ComponentFixture<LoadingSkeletonComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LoadingSkeletonComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(LoadingSkeletonComponent);
  });

  it('should create', () => {
    fixture.detectChanges();
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('renders 3 lines by default', () => {
    fixture.detectChanges();
    const lines = fixture.nativeElement.querySelectorAll('.nf-skeleton-line');
    expect(lines.length).toBe(3);
  });

  it('renders custom count', () => {
    fixture.componentRef.setInput('count', 5);
    fixture.detectChanges();
    const lines = fixture.nativeElement.querySelectorAll('.nf-skeleton-line');
    expect(lines.length).toBe(5);
  });

  it('applies custom height', () => {
    fixture.componentRef.setInput('height', '2rem');
    fixture.detectChanges();
    const line = fixture.nativeElement.querySelector('.nf-skeleton-line');
    expect(line.style.height).toBe('2rem');
  });
});
