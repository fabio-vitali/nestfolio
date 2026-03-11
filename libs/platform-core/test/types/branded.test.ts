import { asTenantId, asUserId, asEventId, type TenantId, type UserId, type EventId } from '../../src/types/branded';

describe('branded types', () => {
  it('should create a TenantId from a string', () => {
    const id: TenantId = asTenantId('tenant-123');
    expect(id).toBe('tenant-123');
  });

  it('should create a UserId from a string', () => {
    const id: UserId = asUserId('user-456');
    expect(id).toBe('user-456');
  });

  it('should create an EventId from a string', () => {
    const id: EventId = asEventId('evt-789');
    expect(id).toBe('evt-789');
  });

  it('should preserve string methods on branded types', () => {
    const id = asTenantId('TENANT-ABC');
    expect(id.toLowerCase()).toBe('tenant-abc');
    expect(id.startsWith('TENANT')).toBe(true);
  });
});
