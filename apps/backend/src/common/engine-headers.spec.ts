import { EventEmitter } from 'events';
import { ENGINE_SECURITY_HEADERS, hardenEngineHeaders } from './engine-headers';

describe('hardenEngineHeaders', () => {
  const run = (target: any) => {
    hardenEngineHeaders(target);
    const headers: Record<string, string> = { 'Content-Type': 'text/plain' };
    (target.server ?? target).engine.emit('headers', headers);
    return headers;
  };

  it('adds the security headers to engine responses for a Server', () => {
    const h = run({ engine: new EventEmitter() });
    expect(h).toMatchObject(ENGINE_SECURITY_HEADERS);
    expect(h['Content-Type']).toBe('text/plain'); // existing headers are kept
  });

  it('works through a Namespace (which holds the Server in .server)', () => {
    expect(run({ server: { engine: new EventEmitter() } })['X-Content-Type-Options']).toBe('nosniff');
  });

  it('does nothing, and does not throw, when there is no engine yet', () => {
    expect(() => hardenEngineHeaders(undefined)).not.toThrow();
    expect(() => hardenEngineHeaders({})).not.toThrow();
  });
});
