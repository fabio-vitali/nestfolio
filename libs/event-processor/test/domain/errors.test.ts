import {
  DomainError,
  DomainValidationError,
  EntityNotFoundError,
  BusinessRuleViolationError,
  TenantAccessDeniedError,
} from '../../src/domain/errors';

describe('DomainError', () => {
  it('should set name, message, and code', () => {
    const err = new DomainError('msg', 'CODE');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('DomainError');
    expect(err.message).toBe('msg');
    expect(err.code).toBe('CODE');
  });
});

describe('DomainValidationError', () => {
  it('should include validation details', () => {
    const details = [{ path: '/name', message: 'required' }];
    const err = new DomainValidationError('invalid', details);
    expect(err).toBeInstanceOf(DomainError);
    expect(err.code).toBe('DOMAIN_VALIDATION_ERROR');
    expect(err.details).toEqual(details);
  });
});

describe('EntityNotFoundError', () => {
  it('should format entity type and id', () => {
    const err = new EntityNotFoundError('Order', '123');
    expect(err).toBeInstanceOf(DomainError);
    expect(err.code).toBe('ENTITY_NOT_FOUND');
    expect(err.entityType).toBe('Order');
    expect(err.entityId).toBe('123');
    expect(err.message).toBe("Order with id '123' not found");
  });
});

describe('BusinessRuleViolationError', () => {
  it('should include rule name', () => {
    const err = new BusinessRuleViolationError('MAX_TRADE', 'too large');
    expect(err).toBeInstanceOf(DomainError);
    expect(err.code).toBe('BUSINESS_RULE_VIOLATION');
    expect(err.rule).toBe('MAX_TRADE');
  });
});

describe('TenantAccessDeniedError', () => {
  it('should include tenant and resource', () => {
    const err = new TenantAccessDeniedError('t-1', 'Order:123');
    expect(err).toBeInstanceOf(DomainError);
    expect(err.code).toBe('TENANT_ACCESS_DENIED');
    expect(err.message).toContain('t-1');
    expect(err.message).toContain('Order:123');
  });
});
