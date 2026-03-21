import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EmptyStateComponent } from '../../../src/shared/empty-state/empty-state.component';

describe('EmptyStateComponent', () => {
  let fixture: ComponentFixture<EmptyStateComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EmptyStateComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(EmptyStateComponent);
  });

  it('should create with required title', () => {
    fixture.componentRef.setInput('title', 'No data');
    fixture.detectChanges();
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('renders the title', () => {
    fixture.componentRef.setInput('title', 'No results found');
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.nf-empty-state-title')?.textContent).toBe('No results found');
  });

  it('renders optional message', () => {
    fixture.componentRef.setInput('title', 'Empty');
    fixture.componentRef.setInput('message', 'Try adjusting your filters');
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.nf-empty-state-message')?.textContent).toBe('Try adjusting your filters');
  });

  it('hides message when not provided', () => {
    fixture.componentRef.setInput('title', 'Empty');
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.nf-empty-state-message')).toBeFalsy();
  });

  it('renders default icon', () => {
    fixture.componentRef.setInput('title', 'Empty');
    fixture.detectChanges();
    const icon = fixture.nativeElement.querySelector('.nf-empty-state-icon');
    expect(icon.classList).toContain('pi');
    expect(icon.classList).toContain('pi-inbox');
  });
});
