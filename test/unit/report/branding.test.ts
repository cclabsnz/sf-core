import { resolveBranding, DEFAULT_BRANDING } from '../../../src/report/branding.js';

describe('resolveBranding', () => {
  it('returns CloudCounsel defaults when no overrides', () => {
    const b = resolveBranding(undefined, undefined);
    expect(b.firmName).toBe('CloudCounsel Limited');
    expect(b.primary).toBe('#3a5a82');
    expect(b.fontBody).toBe('DM Sans');
  });

  it('applies overrides over defaults', () => {
    const b = resolveBranding({ primary: '#000000', firmName: 'Acme' }, 'Client X');
    expect(b.primary).toBe('#000000');
    expect(b.firmName).toBe('Acme');
    expect(b.preparedFor).toBe('Client X');
    expect(b.fontBody).toBe(DEFAULT_BRANDING.fontBody);
  });

  it('preparedFor argument wins over file value', () => {
    const b = resolveBranding({ preparedFor: 'File Co' }, 'Flag Co');
    expect(b.preparedFor).toBe('Flag Co');
  });

  it('carries a website so reports can link back to the firm', () => {
    expect(resolveBranding(undefined, undefined).website).toBe('cloudcounsel.co.nz');
  });

  it('lets a consulting firm point the website at their own domain', () => {
    // Branding exists so someone other than CloudCounsel can ship these reports; a field
    // that cannot be overridden would advertise the wrong firm on a client deliverable.
    expect(resolveBranding({ website: 'acme.example' }, undefined).website).toBe('acme.example');
  });
});
