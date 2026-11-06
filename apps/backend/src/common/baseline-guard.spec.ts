import { createHash } from 'crypto';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { decide, BASELINE, LEGACY_LAST } = require('../../prisma/baseline-guard.js');

const done = (name: string) => ({ name, finished: true, rolledBack: false });
const base = { hasHistoryTable: true, appTableCount: 30, schemaMatches: null as boolean | null };

describe('baseline guard decisions', () => {
  it('a brand-new database needs nothing: migrate deploy builds it from the baseline', () => {
    expect(decide({ hasHistoryTable: false, appTableCount: 0, applied: [], schemaMatches: null }).action).toBe('none');
    expect(decide({ ...base, appTableCount: 0, applied: [] }).action).toBe('none');
  });
  it('tables without any migration history are never touched or guessed at', () => {
    const d = decide({ hasHistoryTable: false, appTableCount: 5, applied: [], schemaMatches: null });
    expect(d.action).toBe('refuse');
    expect(d.reason).toMatch(/no migration history/);
    expect(decide({ ...base, applied: [] }).action).toBe('refuse'); // history table exists but is empty, and there are tables
  });
  it('a database that already has the baseline is left alone', () => {
    expect(decide({ ...base, applied: [done(BASELINE)] }).action).toBe('none');
    expect(decide({ ...base, applied: [done('20260829202445_init'), done(LEGACY_LAST), done(BASELINE)] }).action).toBe('none');
  });
  it('a complete legacy history asks for a schema check, and stamps only if the schema is identical', () => {
    const applied = [done('20260829202445_init'), done(LEGACY_LAST)];
    expect(decide({ ...base, applied })).toMatchObject({ action: 'stamp', needsSchemaCheck: true });
    expect(decide({ ...base, applied, schemaMatches: true }).action).toBe('stamp');
    const drift = decide({ ...base, applied, schemaMatches: false });
    expect(drift.action).toBe('refuse');
    expect(drift.reason).toMatch(/differs/);
  });
  it('an incomplete legacy history is refused with the exact migration it needs', () => {
    const d = decide({ ...base, applied: [done('20260829202445_init'), done('20261023000000_add_client_spoc')] });
    expect(d.action).toBe('refuse');
    expect(d.reason).toContain(LEGACY_LAST);
  });
  it('a failed migration blocks everything until it is resolved; a rolled-back one does not count as applied', () => {
    const failed = { name: '20261001000000_x', finished: false, rolledBack: false };
    expect(decide({ ...base, applied: [done(LEGACY_LAST), failed] }).action).toBe('refuse');
    expect(decide({ ...base, applied: [done(LEGACY_LAST), failed] }).reason).toMatch(/failed/);
    const rolled = { name: LEGACY_LAST, finished: true, rolledBack: true };
    expect(decide({ ...base, applied: [done('20260829202445_init'), rolled] }).action).toBe('refuse');
    expect(decide({ ...base, applied: [{ name: BASELINE, finished: false, rolledBack: false }] }).action).toBe('refuse');
  });
});

describe('migration directory policy', () => {
  const dir = join(__dirname, '../../prisma/migrations');
  const folders = readdirSync(dir).filter((n) => statSync(join(dir, n)).isDirectory()).sort();

  it('every migration is a timestamped folder with a migration.sql, and the baseline is first', () => {
    expect(folders.length).toBeGreaterThanOrEqual(1);
    for (const f of folders) {
      expect(f).toMatch(/^\d{14}_[a-z0-9_]+$/);
      expect(statSync(join(dir, f, 'migration.sql')).isFile()).toBe(true);
    }
    expect(folders[0]).toBe(BASELINE);
    expect(new Set(folders).size).toBe(folders.length);
  });

  it('the released baseline is immutable: changing a single byte fails this test', () => {
    const sql = readFileSync(join(dir, BASELINE, 'migration.sql'));
    expect(createHash('sha256').update(sql).digest('hex')).toBe('945d16d1beac0e7b086282f26466d591e1667ea4042a97c29b872c9b183e430b');
  });

  it('the baseline carries no seed data and no destructive statements', () => {
    const sql = readFileSync(join(dir, BASELINE, 'migration.sql'), 'utf8').replace(/^--.*$/gm, '');
    expect(sql).not.toMatch(/\b(INSERT\s+INTO|UPDATE\s+"|DELETE\s+FROM|DROP\s+(TABLE|TYPE|INDEX|COLUMN)|TRUNCATE)\b/i);
  });
});
