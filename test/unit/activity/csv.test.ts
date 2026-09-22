import { describe, it, expect } from '@jest/globals';
import { parseCsv } from '../../../src/activity/csv.js';

describe('parseCsv', () => {
  it('parses a fully quoted CRLF body into records keyed by header', () => {
    const text = '"EVENT_TYPE","USER_NAME"\r\n"ApiTotalUsage","a@b.com"\r\n';
    expect(parseCsv(text)).toEqual([{ EVENT_TYPE: 'ApiTotalUsage', USER_NAME: 'a@b.com' }]);
  });

  it('keeps commas inside a quoted field', () => {
    const text = '"URI","N"\r\n"/v52.0/composite/sobjects?ids=a,b,c","3"\r\n';
    expect(parseCsv(text)[0].URI).toBe('/v52.0/composite/sobjects?ids=a,b,c');
  });

  it('unescapes a doubled quote to one literal quote', () => {
    const text = '"Q"\r\n"SELECT Id FROM A WHERE B = ""x"""\r\n';
    expect(parseCsv(text)[0].Q).toBe('SELECT Id FROM A WHERE B = "x"');
  });

  it('accepts LF line endings as well as CRLF', () => {
    expect(parseCsv('"A","B"\n"1","2"\n')).toEqual([{ A: '1', B: '2' }]);
  });

  it('accepts unquoted fields', () => {
    expect(parseCsv('A,B\r\n1,2\r\n')).toEqual([{ A: '1', B: '2' }]);
  });

  it('tolerates a missing trailing newline', () => {
    expect(parseCsv('"A"\r\n"1"')).toEqual([{ A: '1' }]);
  });

  it('returns no records for a header-only body', () => {
    expect(parseCsv('"A","B"\r\n')).toEqual([]);
  });

  it('returns no records for an empty body', () => {
    expect(parseCsv('')).toEqual([]);
  });

  it('pads a short row rather than shifting later columns', () => {
    expect(parseCsv('"A","B","C"\r\n"1","2"\r\n')).toEqual([{ A: '1', B: '2', C: '' }]);
  });

  it('ignores extra columns beyond the header', () => {
    expect(parseCsv('"A"\r\n"1","2"\r\n')).toEqual([{ A: '1' }]);
  });

  it('skips a blank interior line in a multi-column body', () => {
    const text = '"A","B"\r\n"1","2"\r\n\r\n"3","4"\r\n';
    expect(parseCsv(text)).toEqual([{ A: '1', B: '2' }, { A: '3', B: '4' }]);
  });

  it('keeps a deliberately empty value in a single-column body', () => {
    expect(parseCsv('"A"\r\n""\r\n')).toEqual([{ A: '' }]);
  });
});
