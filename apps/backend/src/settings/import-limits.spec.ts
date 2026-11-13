import { SettingsService } from './settings.service';
import { SettingsController } from './settings.controller';
import { DEFAULT_SETTINGS, IMPORT_ROW_LIMITS } from './settings.defaults';
import { resolveImportRowLimit } from './import-limits';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';

// A tiny stand-in for the app_settings table; "restart" = a second service over the same stored row.
function makeStore(initial: any = null) {
  let row: any = initial ? { id: 'singleton', data: initial, updatedAt: new Date(), updatedById: null } : null;
  const prisma: any = {
    appSettings: {
      findUnique: jest.fn(async () => row),
      upsert: jest.fn(async (a: any) => { row = { id: 'singleton', data: a.create.data ?? a.update.data, updatedAt: new Date(), updatedById: a.create.updatedById }; return row; }),
    },
  };
  const audit = { log: jest.fn(async () => undefined) };
  const make = () => new SettingsService(prisma, audit as any, {} as any, { resetUsage: jest.fn() } as any);
  return { prisma, audit, make, rows: () => row };
}
const { min, max, fallback } = IMPORT_ROW_LIMITS;

describe('Maximum Rows Per Import File: validation', () => {
  it.each([[min - 1], [0], [-5], [max + 1], [1e9], [12.5], ['500'], [null], [NaN]])('refuses %p and stores nothing', async (bad) => {
    const { make, prisma } = makeStore();
    await expect(make().update({ imports: { maxRowsPerFile: bad } }, 'admin', 'ip', 'ua')).rejects.toThrow(/Maximum Rows Per Import File must be a whole number between 100 and 50,000/);
    expect(prisma.appSettings.upsert).not.toHaveBeenCalled();
  });

  it('refuses a non-object "imports"', async () => {
    await expect(makeStore().make().update({ imports: 5 }, 'admin', 'ip', 'ua')).rejects.toThrow(/imports must be an object/);
  });

  it('accepts the limits themselves and values in between; the default is inside the range', async () => {
    const { make } = makeStore();
    for (const v of [min, 2500, fallback, max]) await expect(make().update({ imports: { maxRowsPerFile: v } }, 'admin', 'ip', 'ua')).resolves.toBeDefined();
    expect(DEFAULT_SETTINGS.imports.maxRowsPerFile).toBe(fallback);
  });
});

describe('Maximum Rows Per Import File: persistence and effect', () => {
  it('survives a restart and is what Settings shows and the next import uses', async () => {
    const { make, rows } = makeStore();
    await make().update({ imports: { maxRowsPerFile: 3000 } }, 'admin', 'ip', 'ua');
    expect(rows().data.imports).toEqual({ maxRowsPerFile: 3000 });
    const { settings } = await make().get(); // "after restart"
    expect(settings.imports.maxRowsPerFile).toBe(3000);
    expect(resolveImportRowLimit(settings)).toBe(3000);
  });

  it('a change is audited with the administrator', async () => {
    const { make, audit } = makeStore();
    await make().update({ imports: { maxRowsPerFile: 2000 } }, 'admin-1', '1.1.1.1', 'jest');
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ actorId: 'admin-1', action: 'SETTINGS_UPDATED', details: { changed: { imports: { maxRowsPerFile: 2000 } } } }));
  });

  it.each([[undefined], [null], ['x'], [0], [99], [max + 1], [1.5], [NaN], [Infinity]])('an unusable stored value (%p) falls back to the default, never to "no limit"', (bad) => {
    expect(resolveImportRowLimit({ imports: { maxRowsPerFile: bad } })).toBe(fallback);
  });
  it('nothing saved gives the default', () => expect(resolveImportRowLimit(undefined)).toBe(fallback));
});

describe('Maximum Rows Per Import File: Admin only', () => {
  it('PUT /settings is restricted to ADMIN', () => {
    expect(Reflect.getMetadata(ROLES_KEY, SettingsController.prototype.update)).toEqual(['ADMIN']);
  });

  it('GET /settings returns the import limit to Admins and hides it from every other role', async () => {
    const full = { settings: { ...DEFAULT_SETTINGS, imports: { maxRowsPerFile: 4321 } }, updatedAt: null };
    const controller = new SettingsController({ get: async () => full } as any);
    expect(((await controller.get('ADMIN' as any)) as any).settings.imports).toEqual({ maxRowsPerFile: 4321 });
    for (const role of ['TESTER', 'TEAM_LEAD', 'AVP', 'VIEWER']) {
      const r: any = await controller.get(role as any);
      expect(r.settings.imports).toBeUndefined();
      expect(JSON.stringify(r)).not.toContain('4321');
      expect(r.settings.security).toBeDefined(); // everything else is unchanged
    }
    expect(full.settings.imports).toBeDefined(); // the shared object is not mutated
  });
});
