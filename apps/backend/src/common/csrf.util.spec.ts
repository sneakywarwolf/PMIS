import { isCrossSiteWrite } from './csrf.util';

const app = 'https://pmis.example.com';

describe('isCrossSiteWrite', () => {
  it('allows reads from anywhere', () => expect(isCrossSiteWrite('GET', { origin: 'https://evil.com' }, app)).toBe(false));
  it('allows same-origin writes and header-less (non-browser) clients', () => {
    expect(isCrossSiteWrite('POST', { origin: app }, app)).toBe(false);
    expect(isCrossSiteWrite('DELETE', {}, app)).toBe(false);
    expect(isCrossSiteWrite('POST', { 'sec-fetch-site': 'same-origin' }, app)).toBe(false);
  });
  it('allows the host the proxy was addressed by (LAN IP / 127.0.0.1 access)', () => {
    expect(isCrossSiteWrite('POST', { origin: 'http://10.0.0.5:3000', 'x-forwarded-host': '10.0.0.5:3000' }, app)).toBe(false);
    expect(isCrossSiteWrite('POST', { origin: 'https://evil.com', 'x-forwarded-host': '10.0.0.5:3000', host: 'backend:4000' }, app)).toBe(true);
  });
  it('blocks cross-origin, null/malformed origin and cross-site fetch metadata on writes', () => {
    expect(isCrossSiteWrite('POST', { origin: 'https://evil.com' }, app)).toBe(true);
    expect(isCrossSiteWrite('PUT', { origin: 'http://pmis.example.com' }, app)).toBe(true);
    expect(isCrossSiteWrite('POST', { origin: 'null' }, app)).toBe(true);
    expect(isCrossSiteWrite('PATCH', { 'sec-fetch-site': 'cross-site' }, app)).toBe(true);
  });
});
