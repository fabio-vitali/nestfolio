import { groupBy } from '../../src/util/group-by';

describe('groupBy()', () => {
  const items = [
    { tenantId: 'A', id: '1', value: 10 },
    { tenantId: 'B', id: '2', value: 20 },
    { tenantId: 'A', id: '3', value: 30 },
    { tenantId: 'B', id: '4', value: 40 },
    { tenantId: 'A', id: '5', value: 50 },
  ];

  it('groups all items by default (pick: all)', () => {
    const result = groupBy(items, { key: (i) => i.tenantId });
    expect(result.get('A')).toHaveLength(3);
    expect(result.get('B')).toHaveLength(2);
  });

  it('pick: first returns first item per group', () => {
    const result = groupBy(items, { key: (i) => i.tenantId, pick: 'first' });
    expect(result.get('A')).toEqual({ tenantId: 'A', id: '1', value: 10 });
    expect(result.get('B')).toEqual({ tenantId: 'B', id: '2', value: 20 });
  });

  it('pick: last returns last item per group', () => {
    const result = groupBy(items, { key: (i) => i.tenantId, pick: 'last' });
    expect(result.get('A')).toEqual({ tenantId: 'A', id: '5', value: 50 });
    expect(result.get('B')).toEqual({ tenantId: 'B', id: '4', value: 40 });
  });

  it('handles empty array', () => {
    const result = groupBy([], { key: () => 'x' });
    expect(result.size).toBe(0);
  });

  it('single-item groups', () => {
    const result = groupBy(items, { key: (i) => i.id, pick: 'last' });
    expect(result.size).toBe(5);
    expect(result.get('1')).toEqual({ tenantId: 'A', id: '1', value: 10 });
  });
});
