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
  decisionId: 'd0000000-0000-0000-0000-000000000001',
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
    decisionId: 'd0000000-0000-0000-0000-000000000001',
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
    decisionId: 'd0000000-0000-0000-0000-000000000001',
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
          useValue: { snapshot: { paramMap: { get: () => 'd0000000-0000-0000-0000-000000000001' } } },
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

    expect(advisoryService.getDecision).toHaveBeenCalledWith('d0000000-0000-0000-0000-000000000001');
    expect(advisoryService.getAgentInvocations).toHaveBeenCalledWith('d0000000-0000-0000-0000-000000000001');
    expect(advisoryService.getComplianceChecks).toHaveBeenCalledWith('d0000000-0000-0000-0000-000000000001');
    expect(store.isLoaded()).toBe(true);
    expect(store.decision()?.decisionId).toBe('d0000000-0000-0000-0000-000000000001');
  });

  it('should record explanation view', async () => {
    await component.ngOnInit();

    // Wait for fire-and-forget promise
    await new Promise((r) => setTimeout(r, 0));

    expect(advisoryService.recordExplanationView).toHaveBeenCalledWith('d0000000-0000-0000-0000-000000000001');
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

  it('should set loading true during data fetch', async () => {
    // Use a deferred promise to control timing
    let resolveDecision!: (v: unknown) => void;
    advisoryService.getDecision.mockReturnValue(
      new Promise((res) => { resolveDecision = res; })
    );

    const initPromise = component.ngOnInit();
    expect(store.loading()).toBe(true);

    resolveDecision(mockDecision);
    await initPromise;
    expect(store.loading()).toBe(false);
  });

  it('should handle non-Error exceptions with generic message', async () => {
    advisoryService.getDecision.mockRejectedValue('string-error');

    await component.ngOnInit();

    // Should set some error — either the string itself or a generic message
    expect(store.error()).toBeTruthy();
    expect(store.loading()).toBe(false);
  });

  it('should still call all service methods even if getDecision fails (Promise.all)', async () => {
    advisoryService.getDecision.mockRejectedValue(new Error('Not found'));

    await component.ngOnInit();

    // All three are called in Promise.all, so they all fire before any rejection
    expect(advisoryService.getDecision).toHaveBeenCalled();
    expect(advisoryService.getAgentInvocations).toHaveBeenCalled();
    expect(advisoryService.getComplianceChecks).toHaveBeenCalled();
    expect(store.error()).toBe('Not found');
  });

  it('should compute compliance passed correctly', async () => {
    await component.ngOnInit();

    expect(store.compliancePassed()).toBe(true);
  });

  it('should reset store on destroy', async () => {
    await component.ngOnInit();
    expect(store.isLoaded()).toBe(true);

    component.ngOnDestroy();
    expect(store.decision()).toBeNull();
  });

  it('should redirect to dashboard when decision ID is invalid (not UUID)', async () => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [DecisionDetailComponent],
      providers: [
        { provide: AdvisoryService, useValue: advisoryService },
        { provide: Router, useValue: router },
        { provide: I18nService, useValue: { t: (k: string) => k } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: { get: () => 'not-a-uuid' } } },
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

    expect(router.navigate).toHaveBeenCalledWith(['/dashboard']);
    expect(advisoryService.getDecision).not.toHaveBeenCalled();
  });

  it('should log error when recordExplanationView fails', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    advisoryService.recordExplanationView.mockRejectedValue(new Error('audit fail'));

    await component.ngOnInit();
    await new Promise((r) => setTimeout(r, 0));

    expect(consoleSpy).toHaveBeenCalledWith('audit log failed', expect.any(Error));
    consoleSpy.mockRestore();
  });
});
