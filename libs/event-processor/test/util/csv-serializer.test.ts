import { toCsv } from '../../src/util/csv-serializer';

describe('toCsv()', () => {
  it('serializes array of objects to CSV with headers', () => {
    const data = [
      { name: 'Alice', age: 30 },
      { name: 'Bob', age: 25 },
    ];
    const csv = toCsv(data);
    expect(csv).toBe('name,age\nAlice,30\nBob,25');
  });

  it('escapes commas in values', () => {
    const data = [{ name: 'Doe, John', age: 40 }];
    expect(toCsv(data)).toBe('name,age\n"Doe, John",40');
  });

  it('escapes double quotes in values', () => {
    const data = [{ desc: 'He said "hi"' }];
    expect(toCsv(data)).toBe('desc\n"He said ""hi"""');
  });

  it('handles empty array', () => {
    expect(toCsv([])).toBe('');
  });

  it('handles null/undefined values', () => {
    const data = [{ a: null, b: undefined, c: 0 }];
    expect(toCsv(data)).toBe('a,b,c\n,,0');
  });
});
