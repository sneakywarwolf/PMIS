import { RedisService } from './redis.service';

// Revoking a user's refresh tokens must not use KEYS (one blocking walk of the whole keyspace).
describe('RedisService.revokeAllUserTokens', () => {
  it("scans in pages, deletes only that user's tokens, and never calls KEYS", async () => {
    const store: Record<string, string> = { 'refresh_token:a': 'u1', 'refresh_token:b': 'u2', 'refresh_token:c': 'u1' };
    const pages: [string, string[]][] = [['7', ['refresh_token:a', 'refresh_token:b']], ['0', ['refresh_token:c']]];
    const fake: any = {
      keys: jest.fn(),
      scan: jest.fn(async () => pages.shift()),
      get: jest.fn(async (k: string) => store[k] ?? null),
      del: jest.fn(async (k: string) => { delete store[k]; }),
    };
    await RedisService.prototype.revokeAllUserTokens.call(fake, 'u1');
    expect(fake.keys).not.toHaveBeenCalled();
    expect(fake.scan).toHaveBeenCalledTimes(2);
    expect(store).toEqual({ 'refresh_token:b': 'u2' });
  });
});
