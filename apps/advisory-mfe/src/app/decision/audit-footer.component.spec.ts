import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component } from '@angular/core';
import { TranslateModule, TranslateLoader } from '@ngx-translate/core';
import { of } from 'rxjs';
import { AuditFooterComponent } from './audit-footer.component';

class FakeLoader implements TranslateLoader {
  getTranslation() {
    return of({});
  }
}

@Component({
  standalone: true,
  imports: [AuditFooterComponent],
  template: `<app-audit-footer
    [decisionId]="decisionId"
    [modelVersions]="modelVersions"
    [createdAt]="createdAt"
    [version]="version"
  />`,
})
class TestHostComponent {
  decisionId = 'dec-001';
  modelVersions = ['Claude Opus 4.6', 'Claude Sonnet 4.6'];
  createdAt = '2026-03-01T10:00:00Z';
  version = 2;
}

describe('AuditFooterComponent', () => {
  let fixture: ComponentFixture<TestHostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        TestHostComponent,
        TranslateModule.forRoot({ loader: { provide: TranslateLoader, useClass: FakeLoader } }),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TestHostComponent);
    fixture.detectChanges();
  });

  it('should display decision ID', () => {
    const el = fixture.nativeElement;
    expect(el.textContent).toContain('dec-001');
  });

  it('should display model versions', () => {
    const el = fixture.nativeElement;
    expect(el.textContent).toContain('Claude Opus 4.6, Claude Sonnet 4.6');
  });

  it('should display version', () => {
    const el = fixture.nativeElement;
    expect(el.textContent).toContain('v2');
  });

  it('should render audit-footer container', () => {
    const footer = fixture.nativeElement.querySelector('.audit-footer');
    expect(footer).not.toBeNull();
  });

  it('should render 4 audit lines', () => {
    const lines = fixture.nativeElement.querySelectorAll('.audit-line');
    expect(lines.length).toBe(4);
  });
});
