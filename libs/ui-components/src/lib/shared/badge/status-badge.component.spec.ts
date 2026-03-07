import { ComponentFixture, TestBed } from '@angular/core/testing';
import { StatusBadgeComponent } from './status-badge.component';

describe('StatusBadgeComponent', () => {
  let fixture: ComponentFixture<StatusBadgeComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StatusBadgeComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(StatusBadgeComponent);
  });

  it('should create with required label', () => {
    fixture.componentRef.setInput('label', 'Active');
    fixture.detectChanges();
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('renders the label text', () => {
    fixture.componentRef.setInput('label', 'Pending');
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.nf-badge')?.textContent?.trim()).toBe('Pending');
  });

  it('applies severity class', () => {
    fixture.componentRef.setInput('label', 'OK');
    fixture.componentRef.setInput('severity', 'success');
    fixture.detectChanges();
    const badge = fixture.nativeElement.querySelector('.nf-badge');
    expect(badge.classList).toContain('nf-badge--success');
  });

  it('defaults to secondary severity', () => {
    fixture.componentRef.setInput('label', 'Draft');
    fixture.detectChanges();
    const badge = fixture.nativeElement.querySelector('.nf-badge');
    expect(badge.classList).toContain('nf-badge--secondary');
  });
});
