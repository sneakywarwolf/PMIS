#!/usr/bin/env node
/**
 * Runs BEFORE `prisma migrate deploy` (see `npm run db:migrate` and the Docker CMD).
 *
 * The 61 incremental migrations that preceded the first release were replaced by one baseline. A database that already
 * went through them has all 61 recorded in `_prisma_migrations` but not the baseline, and the baseline would fail on it
 * ("table already exists"). This script tells those databases apart from new ones and, only when it can prove the
 * schema is already exactly the baseline's, records the baseline as applied WITHOUT running it.
 *
 *   empty database                          -> nothing to do (migrate deploy builds it from the baseline)
 *   already has the baseline                -> nothing to do
 *   full legacy history + schema identical  -> stamp the baseline as applied
 *   anything else                           -> refuse, say why, change nothing
 *
 * It never writes to application tables, never drops anything, and never stamps on a guess.
 * `node prisma/baseline-guard.js --check` reports the decision without acting.
 */
'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const BASELINE = '20261107000000_baseline';
/** The last migration of the legacy history. A database that has it has all the ones before it. */
const LEGACY_LAST = '20261106000000_cyberdigest_system_evidence';

const log = (msg) => console.log(`[db-baseline] ${new Date().toISOString()} ${msg}`);

/**
 * Pure decision. state = {
 *   hasHistoryTable: boolean, appTableCount: number,
 *   applied: [{ name, finished, rolledBack }], schemaMatches: boolean | null  (null = not checked)
 * }
 * returns { action: 'none' | 'stamp' | 'refuse', reason, needsSchemaCheck?: boolean }
 */
function decide(state) {
  const { hasHistoryTable, appTableCount, applied } = state;
  if (!hasHistoryTable) {
    return appTableCount === 0
      ? { action: 'none', reason: 'empty database: migrate deploy will build it from the baseline' }
      : { action: 'refuse', reason: `the database has ${appTableCount} tables but no migration history. It was not created by PMIS migrations, so it cannot be baselined automatically. Restore it from a backup or recreate it.` };
  }
  const live = applied.filter((m) => !m.rolledBack);
  const failed = live.filter((m) => !m.finished);
  if (failed.length) {
    return { action: 'refuse', reason: `migration "${failed[0].name}" is recorded as failed. Resolve it first (prisma migrate resolve --rolled-back "${failed[0].name}" after restoring the database from backup), then start again.` };
  }
  const names = new Set(live.map((m) => m.name));
  if (names.has(BASELINE)) return { action: 'none', reason: 'baseline already recorded' };
  if (live.length === 0) {
    return appTableCount === 0
      ? { action: 'none', reason: 'empty database: migrate deploy will build it from the baseline' }
      : { action: 'refuse', reason: 'the migration history is empty but the database has tables. Restore it from a backup or recreate it.' };
  }
  if (!names.has(LEGACY_LAST)) {
    return { action: 'refuse', reason: `this database has an older migration history (last applied: "${[...names].sort().pop()}") that is not complete. Upgrade it first with the release that still contains the individual migrations, until "${LEGACY_LAST}" is recorded, then upgrade to this version.` };
  }
  if (state.schemaMatches === null) return { action: 'stamp', reason: 'full legacy history present', needsSchemaCheck: true };
  return state.schemaMatches
    ? { action: 'stamp', reason: 'full legacy history present and the schema matches the baseline exactly' }
    : { action: 'refuse', reason: 'the legacy history is complete but the database schema differs from the expected one (manual changes?). Compare it with `prisma migrate diff` and fix the differences before upgrading.' };
}

function prismaCli(args, env) {
  const cli = require.resolve('prisma/build/index.js');
  return spawnSync(process.execPath, [cli, ...args], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', env: { ...process.env, ...env } });
}

async function readState(prisma) {
  const [{ has }] = await prisma.$queryRawUnsafe(`SELECT to_regclass(current_schema() || '._prisma_migrations') IS NOT NULL AS has`);
  const [{ n }] = await prisma.$queryRawUnsafe(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE' AND table_name <> '_prisma_migrations'`);
  const applied = has
    ? (await prisma.$queryRawUnsafe(`SELECT migration_name, finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS rolled_back FROM _prisma_migrations`)).map((r) => ({ name: r.migration_name, finished: r.finished, rolledBack: r.rolled_back }))
    : [];
  return { hasHistoryTable: !!has, appTableCount: n, applied, schemaMatches: null };
}

function schemaMatches() {
  const schema = path.join(__dirname, 'schema.prisma');
  // exit 0 = no difference, 2 = differences, 1 = error. Anything but 0 is "do not stamp".
  const r = prismaCli(['migrate', 'diff', '--from-url', process.env.DATABASE_URL, '--to-schema-datamodel', schema, '--exit-code']);
  return r.status === 0;
}

async function main() {
  const checkOnly = process.argv.includes('--check');
  if (!process.env.DATABASE_URL) {
    log('DATABASE_URL is not set; nothing checked.');
    process.exit(0);
  }
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  try {
    const state = await readState(prisma);
    let d = decide(state);
    if (d.needsSchemaCheck) d = decide({ ...state, schemaMatches: schemaMatches() });
    log(`decision: ${d.action} (${d.reason})`);
    if (d.action === 'refuse') process.exit(1);
    if (d.action === 'stamp' && !checkOnly) {
      const r = prismaCli(['migrate', 'resolve', '--applied', BASELINE]);
      if (r.status !== 0) {
        log(`could not record the baseline: ${(r.stderr || r.stdout || '').trim().split('\n').slice(-3).join(' | ')}`);
        process.exit(1);
      }
      log(`baseline "${BASELINE}" recorded as applied (it was not executed: the schema already matches it).`);
    }
  } catch (e) {
    log(`failed: ${e.message}`);
    process.exit(1);
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
}

if (require.main === module) main();
module.exports = { decide, BASELINE, LEGACY_LAST };
