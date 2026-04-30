import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { I18nService } from '@nestfolio/shell/i18n';
import { DecisionListComponent } from '../../../src/app/decision-list/decision-list.component';
import {
  AdvisoryService,
  PendingDecisionListItem,
} from '../../../src/app/services/advisory.service';

const mockItems: PendingDecisionListItem[] = [
  {
    decisionId: 'd0000000-0000-0000-0000-000000000001',
    status: 'AWAITING_CONFIRMATION',
    trigger: 'PORTFOLIO_DRIFT',
    createdAt: '2026-04-30T10:00:00Z',
  },
  {
    decisionId: 'd0000000-0000-0000-0000-000000000002',
    status: 'COMPLIANCE_REVIEW',
    trigger: 'DEPOSIT_DETECTED',
    createdAt: '2026-04-30T10:05:00Z',
  },
];

describe('DecisionListComponent', () => {
  let fixture: ComponentFixture<DecisionListComponent>;
  let component: DecisionListComponent;
  let advisoryService: jest.Mocked<AdvisoryService>;

  beforeEach(async () => {
    advisoryService = {
      getPendingDecisions: jest.fn().mockResolvedValue(mockItems),
    } as unknown as jest.Mocked<AdvisoryService>;

    await TestBed.configureTestingModule({
      imports: [DecisionListComponent],
      providers: [
        provideRouter([]),
        { provide: AdvisoryService, useValue: advisoryService },
        { provide: I18nService, useValue: { t: (k: string) => k } },
      ],
    })
      .overrideComponent(DecisionListComponent, {
        set: { template: '<div>test</div>', imports: [], styles: [] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(DecisionListComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should load pending decisions on init', async () => {
    await component.ngOnInit();

    expect(advisoryService.getPendingDecisions).toHaveBeenCalled();
    expect(component.decisions()).toEqual(mockItems);
    expect(component.loaded()).toBe(true);
    expect(component.error()).toBeNull();
    expect(component.loading()).toBe(false);
  });

  it('should set empty list when service returns []', async () => {
    advisoryService.getPendingDecisions.mockResolvedValueOnce([]);

    await component.ngOnInit();

    expect(component.decisions()).toEqual([]);
    expect(component.loaded()).toBe(true);
    expect(component.error()).toBeNull();
  });

  it('should set error signal when service rejects', async () => {
    advisoryService.getPendingDecisions.mockRejectedValueOnce(
      new Error('boom'),
    );

    await component.ngOnInit();

    expect(component.error()).toBeTruthy();
    expect(component.decisions()).toEqual([]);
    expect(component.loading()).toBe(false);
  });

  it('should map status to severity', () => {
    expect(component.statusSeverity('APPROVED')).toBe('success');
    expect(component.statusSeverity('BLOCKED')).toBe('danger');
    expect(component.statusSeverity('COMPLIANCE_REVIEW')).toBe('info');
    expect(component.statusSeverity('AWAITING_CONFIRMATION')).toBe('warn');
    expect(component.statusSeverity('UNKNOWN_STATUS')).toBe('secondary');
  });
});
