/**
 * Base class for all domain-specific errors.
 */
export class DomainError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'DomainError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when a Zod schema validation fails on a domain entity or event.
 */
export class DomainValidationError extends DomainError {
  constructor(
    message: string,
    public readonly details: ReadonlyArray<{ path: string; message: string }>,
  ) {
    super(message, 'DOMAIN_VALIDATION_ERROR');
    this.name = 'DomainValidationError';
  }
}

/**
 * Thrown when an expected entity cannot be found.
 */
export class EntityNotFoundError extends DomainError {
  constructor(
    public readonly entityType: string,
    public readonly entityId: string,
  ) {
    super(`${entityType} with id '${entityId}' not found`, 'ENTITY_NOT_FOUND');
    this.name = 'EntityNotFoundError';
  }
}

/**
 * Thrown when a business rule is violated.
 */
export class BusinessRuleViolationError extends DomainError {
  constructor(
    public readonly rule: string,
    message: string,
  ) {
    super(message, 'BUSINESS_RULE_VIOLATION');
    this.name = 'BusinessRuleViolationError';
  }
}

/**
 * Thrown when an operation is not permitted for the current tenant context.
 */
export class TenantAccessDeniedError extends DomainError {
  constructor(tenantId: string, resource: string) {
    super(
      `Tenant '${tenantId}' does not have access to '${resource}'`,
      'TENANT_ACCESS_DENIED',
    );
    this.name = 'TenantAccessDeniedError';
  }
}
