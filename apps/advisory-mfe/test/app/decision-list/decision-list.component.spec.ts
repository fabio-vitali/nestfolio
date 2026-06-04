import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { I18nService } from '@nestfolio/shell/i18n';
import { AuthStore } from '@nestfolio/shell';
import { DecisionListComponent } from '../../../src/app/decision-list/decision-list.component';
import {
  AdvisoryService,
  PendingDecisionListItem,
} from '../../../src/app/services/advisory.service';
import type { Decision } from '../../../src/app/stores/advisory.store';

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

function frame(overrides: Partial<Decision>): Decision {
  return {
    decisionId: 'd-frame',
    tenantId: 'tenant-1',
    trigger: 'PORTFOLIO_DRIFT',
    status: 'COMPLIANCE_REVIEW',
    explanation: '',
    proposedTrades: [],
    confirmationRequired: false,
    confirmedAt: null,
    rejectedAt: null,
    rejectionReason: null,
    version: 1,
    createdAt: '2026-04-30T10:10:00Z',
    updatedAt: '2026-04-30T10:10:00Z',
    ...overrides,
  };
}

describe('DecisionListComponent', () => {
  let fixture: ComponentFixture<DecisionListComponent>;
  let component: DecisionListComponent;
  let advisoryService: jest.Mocked<AdvisoryService>;

  beforeEach(async () => {
    advisoryService = {
      getPendingDecisions: jest.fn().mockResolvedValue(mockItems),
      subscribeToDecisionListUpdates: jest.fn(),
      unsubscribeFromDecisionListUpdates: jest.fn(),
    } as unknown as jest.Mocked<AdvisoryService>;

    await TestBed.configureTestingModule({
      imports: [DecisionListComponent],
      providers: [
        provideRouter([]),
        { provide: AdvisoryService, useValue: advisoryService },
        { provide: I18nService, useValue: { t: (k: string) => k } },
        {
          provide: AuthStore,
          useValue: { user: () => ({ tenantId: 'tenant-1', userId: 'u', username: 'u', email: 'e' }) },
        },
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

  it('attaches the list subscription BEFORE issuing getPendingDecisions', async () => {
    const callOrder: string[] = [];
    advisoryService.subscribeToDecisionListUpdates.mockImplementation(() => {
      callOrder.push('subscribe');
    });
    advisoryService.getPendingDecisions.mockImplementation(async () => {
      callOrder.push('getPendingDecisions');
      return mockItems;
    });

    await component.ngOnInit();

    const subIdx = callOrder.indexOf('subscribe');
    const queryIdx = callOrder.indexOf('getPendingDecisions');
    expect(subIdx).toBeGreaterThanOrEqual(0);
    expect(queryIdx).toBeGreaterThanOrEqual(0);
    expect(subIdx).toBeLessThan(queryIdx);
  });

  it('passes tenantId from authStore to subscribeToDecisionListUpdates', async () => {
    await component.ngOnInit();

    expect(advisoryService.subscribeToDecisionListUpdates).toHaveBeenCalledWith(
      'tenant-1',
      expect.any(Function),
    );
  });

  it('prepends a frame for an unknown decisionId in a pending status', async () => {
    let cb!: (d: Decision) => void;
    advisoryService.subscribeToDecisionListUpdates.mockImplementation(
      (_tenantId: string, fn: (d: Decision) => void) => {
        cb = fn;
      },
    );
    advisoryService.getPendingDecisions.mockResolvedValue([mockItems[0]]);

    await component.ngOnInit();
    expect(component.decisions()).toHaveLength(1);

    cb(frame({
      decisionId: 'd-new',
      status: 'COMPLIANCE_REVIEW',
      trigger: 'DEPOSIT_DETECTED',
      createdAt: '2026-04-30T10:20:00Z',
    }));

    expect(component.decisions().map((d) => d.decisionId)).toEqual(['d-new', mockItems[0].decisionId]);
    expect(component.decisions()[0]).toEqual({
      decisionId: 'd-new',
      status: 'COMPLIANCE_REVIEW',
      trigger: 'DEPOSIT_DETECTED',
      createdAt: '2026-04-30T10:20:00Z',
    });
  });

  it('updates in place when frame matches an existing decisionId still pending', async () => {
    let cb!: (d: Decision) => void;
    advisoryService.subscribeToDecisionListUpdates.mockImplementation(
      (_t: string, fn: (d: Decision) => void) => { cb = fn; },
    );
    advisoryService.getPendingDecisions.mockResolvedValue([
      { ...mockItems[0], status: 'COMPLIANCE_REVIEW' },
    ]);

    await component.ngOnInit();

    cb(frame({
      decisionId: mockItems[0].decisionId,
      status: 'AWAITING_CONFIRMATION',
      trigger: mockItems[0].trigger,
      createdAt: mockItems[0].createdAt,
    }));

    expect(component.decisions()).toHaveLength(1);
    expect(component.decisions()[0].status).toBe('AWAITING_CONFIRMATION');
    expect(component.decisions()[0].decisionId).toBe(mockItems[0].decisionId);
  });

  it('removes a row when its frame status moves to a terminal value', async () => {
    let cb!: (d: Decision) => void;
    advisoryService.subscribeToDecisionListUpdates.mockImplementation(
      (_t: string, fn: (d: Decision) => void) => { cb = fn; },
    );
    advisoryService.getPendingDecisions.mockResolvedValue([
      mockItems[0],
      mockItems[1],
    ]);

    await component.ngOnInit();
    expect(component.decisions().map((d) => d.decisionId))
      .toEqual([mockItems[0].decisionId, mockItems[1].decisionId]);

    cb(frame({ decisionId: mockItems[0].decisionId, status: 'CONFIRMED' }));

    expect(component.decisions().map((d) => d.decisionId)).toEqual([mockItems[1].decisionId]);
  });

  it('ignores a frame for an unknown decisionId in a terminal status', async () => {
    let cb!: (d: Decision) => void;
    advisoryService.subscribeToDecisionListUpdates.mockImplementation(
      (_t: string, fn: (d: Decision) => void) => { cb = fn; },
    );
    advisoryService.getPendingDecisions.mockResolvedValue([mockItems[0]]);

    await component.ngOnInit();
    const before = component.decisions();

    cb(frame({ decisionId: 'never-seen', status: 'CONFIRMED' }));

    // Reference equality proves the early-return fired (no array allocation).
    // Without the early-return, fall-through to filter() would allocate a new
    // array even on no-op — toBe would fail.
    expect(component.decisions()).toBe(before);
    expect(component.decisions().map((d) => d.decisionId)).toEqual([mockItems[0].decisionId]);
  });

  it('handles an idempotent frame (same status as current row) without error', async () => {
    let cb!: (d: Decision) => void;
    advisoryService.subscribeToDecisionListUpdates.mockImplementation(
      (_t: string, fn: (d: Decision) => void) => { cb = fn; },
    );
    advisoryService.getPendingDecisions.mockResolvedValue([
      { ...mockItems[0], status: 'COMPLIANCE_REVIEW' },
    ]);

    await component.ngOnInit();

    cb(frame({
      decisionId: mockItems[0].decisionId,
      status: 'COMPLIANCE_REVIEW',
      trigger: mockItems[0].trigger,
      createdAt: mockItems[0].createdAt,
    }));

    expect(component.decisions()).toHaveLength(1);
    expect(component.decisions()[0].status).toBe('COMPLIANCE_REVIEW');
    expect(component.decisions()[0].decisionId).toBe(mockItems[0].decisionId);
  });

  it('keeps a GENERATING frame for an unknown decisionId (drives the spinner)', async () => {
    let cb!: (d: Decision) => void;
    advisoryService.subscribeToDecisionListUpdates.mockImplementation(
      (_t: string, fn: (d: Decision) => void) => { cb = fn; },
    );
    advisoryService.getPendingDecisions.mockResolvedValue([]);

    await component.ngOnInit();
    // Use a fresh createdAt (now) so the staleness guard does not flip it to failed
    cb(frame({ decisionId: 'd-gen', status: 'GENERATING', createdAt: new Date().toISOString() }));

    expect(component.decisions().map((d) => d.decisionId)).toEqual(['d-gen']);
    expect(component.generating()).toBe(true);

    component.ngOnDestroy(); // clear the interval started by ngOnInit
  });

  it('unsubscribes from decision list updates on destroy', async () => {
    await component.ngOnInit();

    component.ngOnDestroy();

    expect(advisoryService.unsubscribeFromDecisionListUpdates).toHaveBeenCalled();
  });

  it('skips subscription when authStore has no tenantId (still issues query)', async () => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [DecisionListComponent],
      providers: [
        provideRouter([]),
        { provide: AdvisoryService, useValue: advisoryService },
        { provide: I18nService, useValue: { t: (k: string) => k } },
        { provide: AuthStore, useValue: { user: () => null } },
      ],
    })
      .overrideComponent(DecisionListComponent, {
        set: { template: '<div>test</div>', imports: [], styles: [] },
      })
      .compileComponents();

    const f = TestBed.createComponent(DecisionListComponent);
    await f.componentInstance.ngOnInit();

    expect(advisoryService.subscribeToDecisionListUpdates).not.toHaveBeenCalled();
    expect(advisoryService.getPendingDecisions).toHaveBeenCalled();
  });
});

describe('DecisionListComponent — generating/failed routing (spec §7.2)', () => {
  let component: DecisionListComponent;

  function listItem(over: Partial<PendingDecisionListItem>): PendingDecisionListItem {
    return {
      decisionId: 'd-x',
      status: 'PENDING',
      trigger: 'DEPOSIT_DETECTED',
      createdAt: '2026-06-04T10:00:00Z',
      ...over,
    };
  }

  beforeEach(async () => {
    const advisoryService = {
      getPendingDecisions: jest.fn().mockResolvedValue([]),
      subscribeToDecisionListUpdates: jest.fn(),
      unsubscribeFromDecisionListUpdates: jest.fn(),
    } as unknown as jest.Mocked<AdvisoryService>;

    await TestBed.configureTestingModule({
      imports: [DecisionListComponent],
      providers: [
        provideRouter([]),
        { provide: AdvisoryService, useValue: advisoryService },
        { provide: I18nService, useValue: { t: (k: string) => k } },
        {
          provide: AuthStore,
          useValue: { user: () => ({ tenantId: 'tenant-1', userId: 'u', username: 'u', email: 'e' }) },
        },
      ],
    })
      .overrideComponent(DecisionListComponent, {
        set: { template: '<div>test</div>', imports: [], styles: [] },
      })
      .compileComponents();

    component = TestBed.createComponent(DecisionListComponent).componentInstance;
    component.now.set(new Date('2026-06-04T10:00:00Z').getTime());
  });

  it('GENERATING row, empty list -> generating, not failed, no real rows', () => {
    component.decisions.set([listItem({ decisionId: 'd1', status: 'GENERATING' })]);
    expect(component.realDecisions()).toEqual([]);
    expect(component.generating()).toBe(true);
    expect(component.failed()).toBe(false);
  });

  it('GENERATING + a real decision -> generating banner, list has only the real row', () => {
    component.decisions.set([
      listItem({ decisionId: 'd1', status: 'GENERATING' }),
      listItem({ decisionId: 'd2', status: 'AWAITING_CONFIRMATION' }),
    ]);
    expect(component.realDecisions().map((d) => d.decisionId)).toEqual(['d2']);
    expect(component.generating()).toBe(true);
    expect(component.failed()).toBe(false);
  });

  it('FAILED row, no generation, no real rows -> failed', () => {
    component.decisions.set([listItem({ decisionId: 'd1', status: 'FAILED' })]);
    expect(component.realDecisions()).toEqual([]);
    expect(component.generating()).toBe(false);
    expect(component.failed()).toBe(true);
  });

  it('stale GENERATING (older than the ceiling) -> failed, not generating', () => {
    component.decisions.set([
      listItem({ decisionId: 'd1', status: 'GENERATING', createdAt: '2026-06-04T10:00:00Z' }),
    ]);
    component.now.set(new Date('2026-06-04T10:07:00Z').getTime());
    expect(component.generating()).toBe(false);
    expect(component.failed()).toBe(true);
  });

  it('fresh GENERATING (within the ceiling) -> still generating', () => {
    component.decisions.set([
      listItem({ decisionId: 'd1', status: 'GENERATING', createdAt: '2026-06-04T10:00:00Z' }),
    ]);
    component.now.set(new Date('2026-06-04T10:05:00Z').getTime());
    expect(component.generating()).toBe(true);
    expect(component.failed()).toBe(false);
  });

  it('a real decision overrides a stale GENERATING (no false failed)', () => {
    component.decisions.set([
      listItem({ decisionId: 'd1', status: 'GENERATING', createdAt: '2026-06-04T10:00:00Z' }),
      listItem({ decisionId: 'd2', status: 'APPROVED' }),
    ]);
    component.now.set(new Date('2026-06-04T10:09:00Z').getTime());
    expect(component.realDecisions().map((d) => d.decisionId)).toEqual(['d2']);
    expect(component.failed()).toBe(false);
  });

  it('empty decisions -> neither generating nor failed (plain empty state)', () => {
    component.decisions.set([]);
    expect(component.generating()).toBe(false);
    expect(component.failed()).toBe(false);
  });
});
