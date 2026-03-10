import { TestBed } from '@angular/core/testing';
import { LoggerService } from './logger.service';

describe('LoggerService', () => {
  let service: LoggerService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(LoggerService);
    service.clearContext();
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'debug').mockImplementation();
    jest.spyOn(console, 'warn').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should log debug messages', () => {
    service.debug('test');
    expect(console.debug).toHaveBeenCalledTimes(1);
    const entry = JSON.parse((console.debug as jest.Mock).mock.calls[0][0]);
    expect(entry.level).toBe('debug');
    expect(entry.message).toBe('test');
  });

  it('should log info messages', () => {
    service.info('info-msg');
    expect(console.log).toHaveBeenCalledTimes(1);
    const entry = JSON.parse((console.log as jest.Mock).mock.calls[0][0]);
    expect(entry.level).toBe('info');
  });

  it('should log warn messages', () => {
    service.warn('warn-msg');
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it('should log error messages with Error object', () => {
    service.error('fail', new Error('boom'));
    const entry = JSON.parse((console.error as jest.Mock).mock.calls[0][0]);
    expect(entry.level).toBe('error');
    expect(entry.error.name).toBe('Error');
    expect(entry.error.message).toBe('boom');
  });

  describe('setContext', () => {
    it('should include context in log entries', () => {
      service.setContext({ userId: 'u1', tenantId: 't1' });
      service.info('with context');
      const entry = JSON.parse((console.log as jest.Mock).mock.calls[0][0]);
      expect(entry.context.userId).toBe('u1');
      expect(entry.context.tenantId).toBe('t1');
    });

    it('should merge with existing context', () => {
      service.setContext({ userId: 'u1' });
      service.setContext({ tenantId: 't1' });
      service.info('merged');
      const entry = JSON.parse((console.log as jest.Mock).mock.calls[0][0]);
      expect(entry.context.userId).toBe('u1');
      expect(entry.context.tenantId).toBe('t1');
    });

    it('should merge with per-call context', () => {
      service.setContext({ userId: 'u1' });
      service.info('call context', { extra: 'data' });
      const entry = JSON.parse((console.log as jest.Mock).mock.calls[0][0]);
      expect(entry.context.userId).toBe('u1');
      expect(entry.context.extra).toBe('data');
    });
  });

  describe('clearContext', () => {
    it('should clear context and breadcrumbs', () => {
      service.setContext({ userId: 'u1' });
      service.addBreadcrumb('step 1');
      service.clearContext();
      service.info('cleared');
      const entry = JSON.parse((console.log as jest.Mock).mock.calls[0][0]);
      expect(entry.context).toBeUndefined();
    });
  });

  describe('addBreadcrumb', () => {
    it('should include breadcrumbs in error logs', () => {
      service.addBreadcrumb('step 1', { key: 'val' });
      service.addBreadcrumb('step 2');
      service.error('crash');
      const entry = JSON.parse((console.error as jest.Mock).mock.calls[0][0]);
      expect(entry.breadcrumbs).toHaveLength(2);
      expect(entry.breadcrumbs[0].message).toBe('step 1');
      expect(entry.breadcrumbs[0].data).toEqual({ key: 'val' });
      expect(entry.breadcrumbs[1].message).toBe('step 2');
    });

    it('should cap breadcrumbs at MAX_BREADCRUMBS', () => {
      for (let i = 0; i < 25; i++) {
        service.addBreadcrumb(`step ${i}`);
      }
      service.error('crash');
      const entry = JSON.parse((console.error as jest.Mock).mock.calls[0][0]);
      expect(entry.breadcrumbs).toHaveLength(20);
      expect(entry.breadcrumbs[0].message).toBe('step 5');
    });

    it('should not include breadcrumbs in non-error logs', () => {
      service.addBreadcrumb('step 1');
      service.info('info');
      const entry = JSON.parse((console.log as jest.Mock).mock.calls[0][0]);
      expect(entry.breadcrumbs).toBeUndefined();
    });
  });
});
