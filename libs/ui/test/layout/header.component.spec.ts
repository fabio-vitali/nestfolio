import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HeaderComponent } from '../../src/layout/header.component';

describe('HeaderComponent', () => {
  let component: HeaderComponent;
  let fixture: ComponentFixture<HeaderComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HeaderComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(HeaderComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('renders the default title', () => {
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.nf-header-title')?.textContent).toContain('Nestfolio');
  });

  it('hides menu toggle by default', () => {
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.menu-toggle')).toBeFalsy();
  });

  it('shows menu toggle when showMenuToggle is true', () => {
    fixture.componentRef.setInput('showMenuToggle', true);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.menu-toggle')).toBeTruthy();
  });

  it('emits menuToggle on button click', () => {
    fixture.componentRef.setInput('showMenuToggle', true);
    fixture.detectChanges();
    const spy = jest.fn();
    component.menuToggle.subscribe(spy);
    const btn = fixture.nativeElement.querySelector('.menu-toggle') as HTMLButtonElement;
    btn.click();
    expect(spy).toHaveBeenCalled();
  });
});
