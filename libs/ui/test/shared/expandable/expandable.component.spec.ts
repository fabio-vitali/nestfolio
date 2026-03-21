import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component } from '@angular/core';
import { ExpandableComponent } from '../../../src/shared/expandable/expandable.component';

@Component({
  standalone: true,
  imports: [ExpandableComponent],
  template: `<nf-expandable [title]="title" [initialOpen]="initialOpen">
    <p>Body content</p>
  </nf-expandable>`,
})
class TestHostComponent {
  title = 'Test Section';
  initialOpen = false;
}

describe('ExpandableComponent', () => {
  let fixture: ComponentFixture<TestHostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TestHostComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(TestHostComponent);
    fixture.detectChanges();
  });

  it('should render the title', () => {
    const header = fixture.nativeElement.querySelector('.nf-expandable__header');
    expect(header.textContent).toContain('Test Section');
  });

  it('should be collapsed by default', () => {
    const body = fixture.nativeElement.querySelector('.nf-expandable__body');
    expect(body).toBeNull();
  });

  it('should expand when header is clicked', () => {
    const header = fixture.nativeElement.querySelector('.nf-expandable__header');
    header.click();
    fixture.detectChanges();

    const body = fixture.nativeElement.querySelector('.nf-expandable__body');
    expect(body).not.toBeNull();
    expect(body.textContent).toContain('Body content');
  });

  it('should collapse when header is clicked twice', () => {
    const header = fixture.nativeElement.querySelector('.nf-expandable__header');
    header.click();
    fixture.detectChanges();
    header.click();
    fixture.detectChanges();

    const body = fixture.nativeElement.querySelector('.nf-expandable__body');
    expect(body).toBeNull();
  });

  it('should set aria-expanded attribute', () => {
    const header = fixture.nativeElement.querySelector('.nf-expandable__header');
    expect(header.getAttribute('aria-expanded')).toBe('false');

    header.click();
    fixture.detectChanges();
    expect(header.getAttribute('aria-expanded')).toBe('true');
  });

  it('should start open when initialOpen is true', () => {
    // Re-create component with initialOpen=true to pick up ngOnInit
    const fixture2 = TestBed.createComponent(TestHostComponent);
    fixture2.componentInstance.initialOpen = true;
    fixture2.detectChanges();

    const body = fixture2.nativeElement.querySelector('.nf-expandable__body');
    expect(body).not.toBeNull();
  });
});
