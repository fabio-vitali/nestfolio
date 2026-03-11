import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { SidebarComponent } from '../../../src/lib/layout/sidebar.component';
import { NavItem } from '../../../src/lib/layout/bottom-nav.component';

describe('SidebarComponent', () => {
  let component: SidebarComponent;
  let fixture: ComponentFixture<SidebarComponent>;

  const mockItems: NavItem[] = [
    { label: 'Dashboard', icon: 'pi pi-home', route: '/dashboard' },
    { label: 'Settings', icon: 'pi pi-cog', route: '/settings' },
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SidebarComponent, RouterTestingModule],
    }).compileComponents();

    fixture = TestBed.createComponent(SidebarComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('renders sidebar items', () => {
    fixture.componentRef.setInput('items', mockItems);
    fixture.detectChanges();
    const items = fixture.nativeElement.querySelectorAll('.sidebar-item');
    expect(items.length).toBe(2);
    expect(items[0].textContent).toContain('Dashboard');
  });

  it('adds collapsed class when collapsed', () => {
    fixture.componentRef.setInput('collapsed', true);
    fixture.detectChanges();
    const nav = fixture.nativeElement.querySelector('.nf-sidebar');
    expect(nav.classList).toContain('collapsed');
  });

  it('hides labels when collapsed', () => {
    fixture.componentRef.setInput('items', mockItems);
    fixture.componentRef.setInput('collapsed', true);
    fixture.detectChanges();
    const labels = fixture.nativeElement.querySelectorAll('.sidebar-label');
    expect(labels.length).toBe(0);
  });
});
