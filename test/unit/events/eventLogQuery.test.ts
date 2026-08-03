import {
  HOURLY_FORENSIC_CORE,
  buildEventLogQuery,
  sanitizeTypes,
  toLogDate,
  toLogHour,
} from '../../../src/events/eventLogQuery.js';

describe('buildEventLogQuery', () => {
  describe('backward compatibility', () => {
    // The free-tier contract: adding interval/window support must not perturb a single byte
    // of the SOQL an existing caller already gets. Asserted against a literal, not a helper.
    const LEGACY =
      'SELECT Id, EventType, LogDate, LogFileLength, Interval, LogFileFieldNames ' +
      'FROM EventLogFile ' +
      "WHERE Interval = 'Daily' AND LogDate = LAST_N_DAYS:7 " +
      'ORDER BY LogDate';

    it('emits byte-identical SOQL when interval is omitted', () => {
      expect(buildEventLogQuery({ since: 7 })).toBe(LEGACY);
    });

    it('emits byte-identical SOQL when interval is explicitly Daily', () => {
      expect(buildEventLogQuery({ since: 7, interval: 'Daily' })).toBe(LEGACY);
    });

    it('still coerces since to a non-negative integer', () => {
      expect(buildEventLogQuery({ since: -3.7 })).toContain('LAST_N_DAYS:0');
      expect(buildEventLogQuery({ since: 2.9 })).toContain('LAST_N_DAYS:2');
    });
  });

  describe('interval', () => {
    it("emits Interval = 'Hourly' for the paid logs", () => {
      expect(buildEventLogQuery({ since: 1, interval: 'Hourly' })).toContain(
        "WHERE Interval = 'Hourly' AND LogDate = LAST_N_DAYS:1",
      );
    });

    it("omits the Interval predicate entirely for 'both' rather than emitting an IN clause", () => {
      const soql = buildEventLogQuery({ since: 1, interval: 'both' });
      expect(soql).not.toContain('Interval =');
      expect(soql).not.toContain('Interval IN');
      expect(soql).toContain('WHERE LogDate = LAST_N_DAYS:1');
    });

    it('never emits a GROUP BY Interval aggregate, which the platform answers wrongly', () => {
      for (const interval of ['Daily', 'Hourly', 'both'] as const) {
        expect(buildEventLogQuery({ since: 1, interval })).not.toMatch(/GROUP BY/i);
      }
    });
  });

  describe('window', () => {
    const window = { from: '2026-08-02T04:00:00Z', to: '2026-08-02T05:00:00Z' };

    it('emits bounded LogDate comparisons and suppresses LAST_N_DAYS', () => {
      const soql = buildEventLogQuery({ window, interval: 'Hourly' });
      expect(soql).toContain('LogDate >= 2026-08-02T04:00:00Z');
      expect(soql).toContain('LogDate <= 2026-08-02T05:00:00Z');
      expect(soql).not.toContain('LAST_N_DAYS');
    });

    it('leaves datetime literals unquoted, as SOQL requires', () => {
      expect(buildEventLogQuery({ window })).not.toContain("'2026-08-02T04:00:00Z'");
    });

    it('rejects since and window together', () => {
      expect(() => buildEventLogQuery({ since: 1, window })).toThrow(/mutually exclusive/);
    });

    it('rejects neither since nor window', () => {
      expect(() => buildEventLogQuery({})).toThrow(/required/);
    });

    it.each([
      ['2026-08-02', 'a bare date'],
      ["2026-08-02T04:00:00Z' OR Id != null--", 'an injection attempt'],
      ['not-a-date', 'garbage'],
    ])('rejects %s (%s) rather than sending it to the org', (bound) => {
      expect(() => buildEventLogQuery({ window: { from: bound, to: bound } })).toThrow(TypeError);
    });
  });

  describe('types', () => {
    it('emits a quoted IN clause', () => {
      expect(buildEventLogQuery({ since: 1, types: ['Login', 'ApiTotalUsage'] })).toContain(
        "AND EventType IN ('Login', 'ApiTotalUsage')",
      );
    });

    it('neutralises injection attempts once sanitised', () => {
      const types = sanitizeTypes("Login','x') OR Id != null--");
      const soql = buildEventLogQuery({ since: 1, types });
      expect(soql).toContain("EventType IN ('Login', 'xORIdnull')");
      expect(soql).not.toContain('--');
    });
  });
});

describe('HOURLY_FORENSIC_CORE', () => {
  it('carries the join-key types a consumer needs to tie events together', () => {
    for (const type of ['AuraRequest', 'Sites', 'URI', 'Login', 'ApexExecution']) {
      expect(HOURLY_FORENSIC_CORE).toContain(type);
    }
  });

  it('survives sanitizeTypes unchanged, so it is safe to interpolate', () => {
    expect(sanitizeTypes(HOURLY_FORENSIC_CORE.join(','))).toEqual([...HOURLY_FORENSIC_CORE]);
  });

  it('stays short — hourly capture of every type runs to ~25GB/month', () => {
    expect(HOURLY_FORENSIC_CORE.length).toBeLessThanOrEqual(12);
  });
});

describe('toLogDate / toLogHour', () => {
  it('splits a Salesforce datetime into date and zero-padded UTC hour', () => {
    expect(toLogDate('2026-08-02T04:00:00.000+0000')).toBe('2026-08-02');
    expect(toLogHour('2026-08-02T04:00:00.000+0000')).toBe('04');
  });

  it('returns no hour for a date-only value, which is how a Daily row reads', () => {
    expect(toLogHour('2026-08-02')).toBeUndefined();
  });
});
