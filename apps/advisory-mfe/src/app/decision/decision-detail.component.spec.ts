import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { DecisionDetailComponent } from './decision-detail.component';
import {
  AdvisoryStore,
  AgentInvocation,
  ComplianceCheck,
  Decision,
} from '../stores/advisory.store';
import { AdvisoryService } from '../services/advisory.service';
import { I18nService } from '@nestfolio/i18n';

const mockDecision: Decision = {
  decisionId: 'dec-001',
  tenantId: 'tenant-1',
  status: 'APPROVED',
  rationale: 'Portfolio drift detected',
  proposedActions: [
    {
      actionType: 'MARKET',
      symbol: 'VWCE.DE',
      side: 'BUY',
      quantity: 10,
      limitPrice: null,
      currency: 'EUR',
    },
  ],
  complianceStatus: 'PASSED',
  confirmedAt: null,
  confirmedBy: null,
  rejectedAt: null,
  rejectionReason: null,
  rejectedBy: null,
  version: 1,
  createdAt: '2026-03-01T10:00:00Z',
  updatedAt: '2026-03-01T10:05:00Z',
};

const mockInvocations: AgentInvocation[] = [
  {
    invocationId: 'inv-001',
    decisionId: 'dec-001',
    agentName: 'Portfolio Analyst',
    tier: 'Claude Opus 4.6',
    input: null,
    output: 'Rebalance recommended',
    durationMs: 3200,
    status: 'COMPLETED',
    invokedAt: '2026-03-01T10:00:00Z',
  },
];

const mockChecks: ComplianceCheck[] = [
  {
    checkId: 'chk-001',
    decisionId: 'dec-001',
    ruleName: 'MaxSingleTrade',
    result: 'PASSED',
    details: null,
    checkedAt: '2026-03-01T10:03:00Z',
  },
];

describe('DecisionDetailComponent', () => {
  let fixture: ComponentFixture<DecisionDetailComponent>;
  let component: DecisionDetailComponent;
  let advisoryService: jest.Mocked<AdvisoryService>;
  let router: jest.Mocked<Router>;
  let store: InstanceType<typeof AdvisoryStore>;

  beforeEach(async () => {
    advisoryService = {
      getDecision: jest.fn().mockResolvedValue(mockDecision),
      getAgentInvocations: jest.fn().mockResolvedValue(mockInvocations),
      getComplianceChecks: jest.fn().mockResolvedValue(mockChecks),
      recordExplanationView: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<AdvisoryService>;

    router = { navigate: jest.fn() } as unknown as jest.Mocked<Router>;

    await TestBed.configureTestingModule({
      imports: [DecisionDetailComponent],
      providers: [
        { provide: AdvisoryService, useValue: advisoryService },
        { provide: Router, useValue: router },
        { provide: I18nService, useValue: { t: (k: string) => k } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: { get: () => 'dec-001' } } },
        },
      ],
    })
      .overrideComponent(DecisionDetailComponent, {
        set: { template: '<div>test</div>', imports: [], styles: [] },
      })
      .compileComponents();

    store = TestBed.inject(AdvisoryStore);
    store.reset();
    fixture = TestBed.createComponent(DecisionDetailComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should load decision on init', async () => {
    await component.ngOnInit();

    expect(advisoryService.getDecision).toHaveBeenCalledWith('dec-001');
    expect(advisoryService.getAgentInvocations).toHaveBeenCalledWith('dec-001');
    expect(advisoryService.getComplianceChecks).toHaveBeenCalledWith('dec-001');
    expect(store.isLoaded()).toBe(true);
    expect(store.decision()?.decisionId).toBe('dec-001');
  });

  it('should record explanation view', async () => {
    await component.ngOnInit();

    // Wait for fire-and-forget promise
    await new Promise((r) => setTimeout(r, 0));

    expect(advisoryService.recordExplanationView).toHaveBeenCalledWith('dec-001');
  });

  it('should set agent invocations and compliance checks', async () => {
    await component.ngOnInit();

    expect(store.agentInvocations()).toHaveLength(1);
    expect(store.agentInvocations()[0].agentName).toBe('Portfolio Analyst');
    expect(store.complianceChecks()).toHaveLength(1);
    expect(store.complianceChecks()[0].ruleName).toBe('MaxSingleTrade');
  });

  it('should compute model versions', async () => {
    await component.ngOnInit();

    expect(store.modelVersions()).toEqual(['Claude Opus 4.6']);
  });

  it('should set error when decision ID is missing', async () => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [DecisionDetailComponent],
      providers: [
        { provide: AdvisoryService, useValue: advisoryService },
        { provide: Router, useValue: router },
        { provide: I18nService, useValue: { t: (k: string) => k } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: { get: () => null } } },
        },
      ],
    })
      .overrideComponent(DecisionDetailComponent, {
        set: { template: '<div>test</div>', imports: [], styles: [] },
      })
      .compileComponents();

    const s = TestBed.inject(AdvisoryStore);
    s.reset();
    const f = TestBed.createComponent(DecisionDetailComponent);
    await f.componentInstance.ngOnInit();

    expect(s.error()).toBe('Missing decision ID');
  });

  it('should handle service error', async () => {
    advisoryService.getDecision.mockRejectedValue(new Error('Network error'));

    await component.ngOnInit();

    expect(store.error()).toBe('Network error');
    expect(store.loading()).toBe(false);
  });

  it('should navigate back to dashboard', () => {
    component.navigateBack();
    expect(router.navigate).toHaveBeenCalledWith(['/dashboard']);
  });

  it('should reset store on destroy', async () => {
    await component.ngOnInit();
    expect(store.isLoaded()).toBe(true);

    component.ngOnDestroy();
    expect(store.decision()).toBeNull();
  });
});
