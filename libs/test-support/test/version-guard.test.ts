import { expectStaleDrop, expectVersionedWrite } from '../src/fixtures/version-guard';

describe('version-guard test helpers', () => {
  it('expectStaleDrop accepts a deduplicated result', () => {
    expect(() => expectStaleDrop({ _tag: 'projectVersioned', success: true, deduplicated: true })).not.toThrow();
  });
  it('expectStaleDrop rejects a fresh write', () => {
    expect(() => expectStaleDrop({ _tag: 'projectVersioned', success: true })).toThrow(/expected a stale drop/i);
  });
  it('expectVersionedWrite accepts a fresh write', () => {
    expect(() => expectVersionedWrite({ _tag: 'projectVersioned', success: true })).not.toThrow();
  });
  it('expectVersionedWrite rejects a dropped write', () => {
    expect(() => expectVersionedWrite({ _tag: 'projectVersioned', success: true, deduplicated: true })).toThrow(/expected a versioned write/i);
  });
});
