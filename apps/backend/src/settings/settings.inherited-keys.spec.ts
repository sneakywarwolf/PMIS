import { DEFAULT_SETTINGS } from './settings.defaults';
import { deepMerge, pruneUnknown } from './settings.store';
import { SettingsService } from './settings.service';

// `key in obj` is true for inherited names (toString, constructor, __proto__). Those must be treated as unknown settings.
describe('settings: inherited property names are unknown keys', () => {
  const svc = () => {
    const prisma: any = { appSettings: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn() } };
    return { prisma, service: new SettingsService(prisma, { log: jest.fn() } as any, {} as any, { resetUsage: jest.fn() } as any) };
  };
  const hostile = [
    '{"general":{"toString":"x"}}',
    '{"general":{"constructor":{"a":1}}}',
    '{"general":{"__proto__":{"polluted":"yes"}}}',
    '{"__proto__":{"polluted":"yes"}}',
    '{"constructor":{"a":1}}',
    '{"workflow":{"severityLabels":{"toString":"x"}}}',
  ];

  it.each(hostile)('update refuses %s and stores nothing', async (json) => {
    const { prisma, service } = svc();
    await expect(service.update(JSON.parse(json), 'a', 'ip', 'ua')).rejects.toThrow(/Unknown/);
    expect(prisma.appSettings.upsert).not.toHaveBeenCalled();
    expect(({} as any).polluted).toBeUndefined();
  });

  it('merging and pruning ignore inherited and dangerous names', () => {
    const patch = JSON.parse('{"general":{"toString":"evil","__proto__":{"polluted":"yes"},"constructor":{"x":1}}}');
    const merged = deepMerge(DEFAULT_SETTINGS, patch);
    expect(Object.keys(merged.general).sort()).toEqual(Object.keys(DEFAULT_SETTINGS.general).sort().concat(['toString']).sort()); // a plain key still merges (validation is the gate)
    expect(Object.prototype.hasOwnProperty.call(merged.general, 'constructor')).toBe(false);
    const pruned = pruneUnknown(DEFAULT_SETTINGS, patch);
    expect(Object.keys(pruned.general)).toEqual([]); // not own properties of the defaults: dropped on read
    expect(String(DEFAULT_SETTINGS.general)).toBe('[object Object]');
  });
});
