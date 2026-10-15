import { esc, STRICT_CSP_META, INTERACTIVE_CSP_META } from '../../../src/renderers/html-utils.js';

describe('esc', () => {
  it('escapes HTML-significant characters including quotes', () => {
    expect(esc("<a href='x'>&\"")).toBe('&lt;a href=&#39;x&#39;&gt;&amp;&quot;');
  });
  it('returns plain text unchanged', () => {
    expect(esc('plain text 123')).toBe('plain text 123');
  });
  it('handles null and undefined gracefully', () => {
    expect(esc(null)).toBe('');
    expect(esc(undefined)).toBe('');
  });
});

describe('STRICT_CSP_META', () => {
  it('defines a strict Content-Security-Policy disallowing external resources', () => {
    expect(STRICT_CSP_META).toContain("default-src 'none'");
    expect(STRICT_CSP_META).toContain("style-src 'unsafe-inline'");
    expect(STRICT_CSP_META).toContain('img-src data:');
    expect(STRICT_CSP_META).toContain('font-src data:');
    expect(STRICT_CSP_META).toContain('<meta http-equiv="Content-Security-Policy"');
  });
});

describe('INTERACTIVE_CSP_META', () => {
  it('defines a CSP permitting inline scripts but zero network egress', () => {
    expect(INTERACTIVE_CSP_META).toContain("default-src 'none'");
    expect(INTERACTIVE_CSP_META).toContain("script-src 'unsafe-inline'");
    expect(INTERACTIVE_CSP_META).toContain("style-src 'unsafe-inline'");
    expect(INTERACTIVE_CSP_META).toContain('img-src data:');
    expect(INTERACTIVE_CSP_META).toContain('font-src data:');
    expect(INTERACTIVE_CSP_META).toContain('<meta http-equiv="Content-Security-Policy"');
  });
});
