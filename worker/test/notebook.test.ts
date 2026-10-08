import { describe, expect, it } from 'vitest';
import { parseCsv, trimGrid } from '../src/notebook';

describe('notebook csv helpers', () => {
  it('parses quoted cells, escaped quotes and embedded newlines', () => {
    const rows = parseCsv('"a","b ""q"""\n"line1\nline2",""\r\n"x","y"');
    expect(rows).toEqual([['a', 'b "q"'], ['line1\nline2', ''], ['x', 'y']]);
  });

  it('trims trailing empty rows and columns and pads rows to one width', () => {
    const grid = trimGrid(parseCsv('"A","","",""\n"b","c","",""\n"","","",""'));
    expect(grid).toEqual([['A', ''], ['b', 'c']]);
  });
});
