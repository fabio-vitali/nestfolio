import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { BottomNavComponent, NavItem } from '../../src/layout/bottom-nav.component';

describe('BottomNavComponent', () => {
  let component: BottomNavComponent;
  let fixture: ComponentFixture<BottomNavComponent>;

  const mockItems: NavItem[] = [
    { label: 'Dashboard', icon: 'pi pi-home', route: '/dashboard' },
    { label: 'Advisory', icon: 'pi pi-chart-line', route: '/advisory' },
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BottomNavComponent, RouterTestingModule],
    }).compileComponents();

    fixture = TestBed.createComponent(BottomNavComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('renders nav items', () => {
    fixture.componentRef.setInput('items', mockItems);
    fixture.detectChanges();
    const links = fixture.nativeElement.querySelectorAll('.bottom-nav-item');
    expect(links.length).toBe(2);
    expect(links[0].textContent).toContain('Dashboard');
    expect(links[1].textContent).toContain('Advisory');
  });

  it('renders empty when no items', () => {
    fixture.detectChanges();
    const links = fixture.nativeElement.querySelectorAll('.bottom-nav-item');
    expect(links.length).toBe(0);
  });
});
