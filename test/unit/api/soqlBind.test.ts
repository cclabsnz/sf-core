import {
  soql,
  soqlId,
  soqlIds,
  soqlDate,
  soqlString,
  soqlRaw,
  escapeSoqlString,
  escapeSoqlLike,
  soqlLike,
  SoqlBindError,
} from '../../../src/api/soqlBind.js';

describe('soql template tag and bind helpers', () => {
  const VALID_ID_15 = '005000000000001';
  const VALID_ID_18 = '005000000000001AAA';
  const VALID_ID_2 = '005000000000002AAA';

  describe('soql tagged template', () => {
    it('interpolates booleans and numbers safely', () => {
      const active = true;
      const limit = 50;
      const q = soql`SELECT Id FROM User WHERE IsActive = ${active} LIMIT ${limit}`;
      expect(q).toBe('SELECT Id FROM User WHERE IsActive = true LIMIT 50');
    });

    it('handles null values', () => {
      const val = null;
      const q = soql`SELECT Id FROM Contact WHERE Email = ${val}`;
      expect(q).toBe('SELECT Id FROM Contact WHERE Email = null');
    });

    it('interpolates 15- and 18-char Salesforce IDs with quotes', () => {
      const q1 = soql`SELECT Id FROM User WHERE Id = ${VALID_ID_18}`;
      expect(q1).toBe(`SELECT Id FROM User WHERE Id = '${VALID_ID_18}'`);

      const q2 = soql`SELECT Id FROM User WHERE Id = ${VALID_ID_15}`;
      expect(q2).toBe(`SELECT Id FROM User WHERE Id = '${VALID_ID_15}'`);
    });

    it('does not double-quote when developer pre-quotes the variable', () => {
      const q = soql`SELECT Id FROM User WHERE Id = '${VALID_ID_18}'`;
      expect(q).toBe(`SELECT Id FROM User WHERE Id = '${VALID_ID_18}'`);
    });

    it('interpolates array of Salesforce IDs as comma-separated quoted list', () => {
      const ids = [VALID_ID_18, VALID_ID_2];
      const q = soql`SELECT Id FROM User WHERE Id IN ${ids}`;
      expect(q).toBe(`SELECT Id FROM User WHERE Id IN ('${VALID_ID_18}', '${VALID_ID_2}')`);
    });

    it('interpolates Date objects as ISO strings', () => {
      const date = new Date('2026-10-15T00:00:00.000Z');
      const q = soql`SELECT Id FROM LoginHistory WHERE LoginTime >= ${date}`;
      expect(q).toBe('SELECT Id FROM LoginHistory WHERE LoginTime >= 2026-10-15T00:00:00.000Z');
    });

    it('escapes single quotes and backslashes in strings', () => {
      const name = "O'Connor\\Test";
      const q = soql`SELECT Id FROM Contact WHERE LastName = ${name}`;
      expect(q).toBe("SELECT Id FROM Contact WHERE LastName = 'O\\'Connor\\\\Test'");
    });

    it('neutralizes classic SOQL injection payloads', () => {
      const maliciousId = "005000000000000' OR IsActive = true --";
      const q = soql`SELECT Id FROM User WHERE Id = ${maliciousId}`;
      expect(q).toBe("SELECT Id FROM User WHERE Id = '005000000000000\\' OR IsActive = true --'");
    });

    it('neutralizes UNION SELECT injection payloads', () => {
      const maliciousInput = "' UNION SELECT Id, Password__c FROM Secret__c --";
      const q = soql`SELECT Id FROM Account WHERE Name = ${maliciousInput}`;
      expect(q).toBe("SELECT Id FROM Account WHERE Name = '\\' UNION SELECT Id, Password__c FROM Secret__c --'");
    });

    it('rejects infinite numbers', () => {
      expect(() => soql`SELECT Id FROM User LIMIT ${Infinity}`).toThrow(SoqlBindError);
    });

    it('rejects invalid Date objects', () => {
      expect(() => soql`SELECT Id FROM LoginHistory WHERE LoginTime >= ${new Date('invalid')}`).toThrow(
        SoqlBindError,
      );
    });

    it('rejects empty arrays for IN clause', () => {
      expect(() => soql`SELECT Id FROM User WHERE Id IN ${[]}`).toThrow(SoqlBindError);
    });
  });

  describe('typed bind helpers', () => {
    it('soqlId validates valid IDs and rejects invalid ones', () => {
      expect(soqlId(VALID_ID_18).text).toBe(`'${VALID_ID_18}'`);
      expect(() => soqlId('invalid-id')).toThrow(SoqlBindError);
      expect(() => soqlId("005000000000001' OR 1=1")).toThrow(SoqlBindError);
    });

    it('soqlIds formats valid ID arrays and rejects invalid ones', () => {
      expect(soqlIds([VALID_ID_18, VALID_ID_2]).text).toBe(`('${VALID_ID_18}', '${VALID_ID_2}')`);
      expect(() => soqlIds([])).toThrow(SoqlBindError);
      expect(() => soqlIds([VALID_ID_18, 'not-an-id'])).toThrow(SoqlBindError);
    });

    it('soqlDate validates Dates and ISO date strings', () => {
      const d = new Date('2026-10-15T12:00:00.000Z');
      expect(soqlDate(d).text).toBe('2026-10-15T12:00:00.000Z');
      expect(soqlDate('2026-10-15').text).toBe('2026-10-15');
      expect(soqlDate('2026-10-15T12:00:00Z').text).toBe('2026-10-15T12:00:00Z');
      expect(() => soqlDate('not-a-date')).toThrow(SoqlBindError);
    });

    it('soqlString escapes single quotes and backslashes', () => {
      expect(soqlString("It's a test").text).toBe("'It\\'s a test'");
    });

    it('soqlRaw inserts raw fragments directly', () => {
      const fragment = soqlRaw('ORDER BY CreatedDate DESC');
      const q = soql`SELECT Id FROM User ${fragment}`;
      expect(q).toBe('SELECT Id FROM User ORDER BY CreatedDate DESC');
    });

    it('escapeSoqlString escapes single quotes and backslashes properly', () => {
      expect(escapeSoqlString("abc'def\\ghi")).toBe("abc\\'def\\\\ghi");
    });
  });

  describe('no guessing from a value\'s shape or surroundings', () => {
    it('quotes a date-shaped string compared to a text field', () => {
      expect(soql`SELECT Id FROM Account WHERE Name = ${'2026-01-01'}`).toBe("SELECT Id FROM Account WHERE Name = '2026-01-01'");
    });

    it('escapes a value inside a LIKE pattern the template quotes, without re-quoting it', () => {
      expect(soql`SELECT Id FROM Account WHERE Name LIKE '%${"O'Brien"}%'`).toBe("SELECT Id FROM Account WHERE Name LIKE '%O\\'Brien%'");
    });

    it('neutralises an injection payload inside a template-quoted literal', () => {
      const q = soql`SELECT Id FROM User WHERE Name LIKE '%${"x' OR Name != '"}%'`;
      expect(q).toBe("SELECT Id FROM User WHERE Name LIKE '%x\\' OR Name != \\'%'");
    });

    it('tracks escaped quotes in the template when deciding whether a placeholder is quoted', () => {
      // \\' in source is SOQL's escaped quote; a bare \' would be cooked to ' by JS itself.
      expect(soql`SELECT Id FROM Account WHERE Name = 'it\\'s ' AND Site = ${'a'}`).toBe("SELECT Id FROM Account WHERE Name = 'it\\'s ' AND Site = 'a'");
    });

    it('rejects a non-string inside a template-quoted literal', () => {
      expect(() => soql`SELECT Id FROM Account WHERE Name = '${5}'`).toThrow(/Remove the quotes/);
      expect(() => soql`SELECT Id FROM Account WHERE Name = '${soqlString('x')}'`).toThrow(SoqlBindError);
    });

    it('rejects an unterminated literal', () => {
      expect(() => soql`SELECT Id FROM Account WHERE Name = '${'x'}`).toThrow(/Unterminated/);
    });
  });

  describe('values SOQL cannot express', () => {
    it('rejects undefined rather than binding it as null', () => {
      expect(() => soql`SELECT Id FROM User WHERE ManagerId = ${undefined}`).toThrow(/undefined/);
    });

    it('rejects numbers that would print in exponent form', () => {
      expect(() => soql`SELECT Id FROM Opportunity WHERE Amount > ${1e21}`).toThrow(SoqlBindError);
      expect(() => soql`SELECT Id FROM Opportunity WHERE Amount > ${1e-7}`).toThrow(SoqlBindError);
      expect(soql`SELECT Id FROM Opportunity WHERE Amount > ${1234.5}`).toBe('SELECT Id FROM Opportunity WHERE Amount > 1234.5');
    });

    it('rejects mixed arrays', () => {
      expect(() => soql`SELECT Id FROM User WHERE Id IN ${['a', 1]}`).toThrow(SoqlBindError);
    });
  });

  describe('soqlLike', () => {
    it('matches wildcards and quotes literally', () => {
      expect(soqlLike("50%_off's").text).toBe("'%50\\%\\_off\\'s%'");
      expect(soqlLike('abc', 'startsWith').text).toBe("'abc%'");
      expect(soqlLike('abc', 'endsWith').text).toBe("'%abc'");
      expect(soqlLike('abc', 'exact').text).toBe("'abc'");
      expect(soql`SELECT Id FROM Account WHERE Name LIKE ${soqlLike('a_b')}`).toBe("SELECT Id FROM Account WHERE Name LIKE '%a\\_b%'");
    });

    it('escapeSoqlLike escapes the backslash before adding its own', () => {
      expect(escapeSoqlLike('a\\%')).toBe('a\\\\\\%');
    });
  });
});
