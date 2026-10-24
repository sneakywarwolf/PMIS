/**
 * Reset Application — admin/developer utility. Run via reset-db.bat, or:
 *   npx ts-node --transpile-only prisma/reset-db.ts [--scopes users,projects] [--yes] [--confirm RESET] [--dry-run]
 *
 * Exit codes: 0 done, 1 failed, 2 cancelled / nothing changed.
 * Isolated: nothing in the running application imports this.
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as readline from 'readline';
import { PrismaClient } from '@prisma/client';
import { CANCEL_N, MENU, ResetScope, isEverything, parseScopeNames, parseSelection } from '../src/maintenance/reset-db/scopes';
import { ResetStageError, describeImpact, runReset } from '../src/maintenance/reset-db/reset';
import { infraConfigFromEnv, minioStorage, redisCache } from '../src/maintenance/reset-db/adapters';

// Same sources as the app: apps/backend/.env (Prisma's own) and the repo-root .env. Real env vars win.
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const EXIT_OK = 0;
const EXIT_FAILED = 1;
const EXIT_CANCELLED = 2;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

function ask(rl: readline.Interface, q: string): Promise<string> {
  return new Promise((resolve) => rl.question(q, (a) => resolve(a.trim())));
}

/** host:port/dbname — never the password. */
function describeDatabase(url = ''): string {
  try {
    const u = new URL(url);
    return `${u.hostname}:${u.port || '5432'}${u.pathname}`;
  } catch {
    return '(DATABASE_URL not set or unreadable)';
  }
}

async function main(): Promise<number> {
  if (flag('help')) {
    console.log('Usage: reset-db.ts [--scopes users,vulnerabilities,projects,quiz,everything] [--yes] [--confirm RESET] [--dry-run]');
    return EXIT_OK;
  }
  if (process.env.NODE_ENV === 'production' && process.env.RESET_ALLOW_PRODUCTION !== '1') {
    console.error('Refusing to run: NODE_ENV=production. Set RESET_ALLOW_PRODUCTION=1 if you really mean it.');
    return EXIT_FAILED;
  }

  const infra = infraConfigFromEnv();
  console.log('============================================');
  console.log(' VAPT Command Center - Reset Application');
  console.log('============================================');
  console.log(` Database : ${describeDatabase(process.env.DATABASE_URL)}`);
  console.log(` Storage  : ${infra.minio.endPoint}:${infra.minio.port}/${infra.minio.bucket}`);
  console.log(` Redis    : ${infra.redisUrl.replace(/\/\/[^@]*@/, '//')}`);
  console.log('');

  const interactive = !arg('scopes') && process.stdin.isTTY !== false;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let scopes: ResetScope[] | null = null;

  try {
    // 1. Choose scopes
    if (arg('scopes')) {
      const sel = parseScopeNames(arg('scopes')!);
      if ('error' in sel) { console.error(sel.error); return EXIT_FAILED; }
      if ('scopes' in sel) scopes = sel.scopes;
    } else {
      for (const m of MENU) console.log(`  ${m.n}. ${m.label}`);
      console.log(`  ${CANCEL_N}. Cancel\n`);
      console.log('You can pick several, e.g. "1,3" or "1 4".');
      for (;;) {
        const sel = parseSelection(await ask(rl, 'Select option(s): '));
        if ('error' in sel) { console.log(sel.error); continue; }
        if ('cancel' in sel) { console.log('Cancelled. Nothing was changed.'); return EXIT_CANCELLED; }
        scopes = sel.scopes;
        break;
      }
    }
    if (!scopes) return EXIT_CANCELLED;

    const prisma = new PrismaClient();
    const storage = minioStorage(infra.minio);
    const cache = redisCache(infra.redisUrl);
    try {
      // 2. Show exactly what will happen
      let impact;
      try {
        impact = await describeImpact(prisma, storage, scopes);
      } catch (e) {
        console.error(`Could not read the current state (is Docker/Postgres/object storage running?): ${(e as Error).message}`);
        return EXIT_FAILED;
      }
      console.log(`\nSelected: ${isEverything(scopes) ? 'EVERYTHING' : scopes.join(', ')}\n`);
      console.log('This will PERMANENTLY DELETE:');
      for (const l of impact.deleted) console.log(`  - ${String(l.count).padStart(6)}  ${l.label}`);
      if (impact.changed.length) {
        console.log('\nThis will REASSIGN to the default admin:');
        for (const l of impact.changed) console.log(`  - ${String(l.count).padStart(6)}  ${l.label}`);
      }
      if (impact.restored.length) {
        console.log('\nThis will RESTORE:');
        for (const r of impact.restored) console.log(`  + ${r}`);
      }
      console.log('\nKept: database schema & migrations, Docker setup, .env/config, application code.');

      if (flag('dry-run')) { console.log('\n--dry-run: nothing was changed.'); return EXIT_OK; }

      // 3. Confirm
      if (isEverything(scopes)) {
        const typed = arg('confirm') ?? (interactive ? await ask(rl, '\nThis wipes ALL application data. Type RESET to continue: ') : '');
        if (typed !== 'RESET') { console.log('Not confirmed. Nothing was changed.'); return EXIT_CANCELLED; }
      } else {
        const ok = flag('yes') || (interactive && /^y(es)?$/i.test(await ask(rl, '\nProceed? (y/N): ')));
        if (!ok) { console.log('Not confirmed. Nothing was changed.'); return EXIT_CANCELLED; }
      }

      // 4. Run
      console.log('');
      await runReset({ prisma, storage, cache, log: (m) => console.log(m) }, scopes);
      console.log('\nReset complete.');
      if (scopes.includes('users') || isEverything(scopes)) {
        console.log('Default logins (must change password on first login):');
        console.log('  admin / Admin@1234567890!   teamlead / Tl@1234567890!   tester1, tester2 / Tester@1234567890!');
      }
      return EXIT_OK;
    } finally {
      await cache.close();
      await prisma.$disconnect();
    }
  } catch (e) {
    if (e instanceof ResetStageError) {
      console.error(`\nFAILED at stage "${e.stage}": ${e.original instanceof Error ? e.original.message : e.original}`);
      console.error(
        e.stage === 'Reset database'
          ? 'The database change is one transaction, so it was rolled back: nothing was changed.'
          : e.stage === 'Prepare defaults'
          ? 'Nothing was changed.'
          : 'The database part already succeeded. Fix the cause and run the same reset again to finish cleanup (it is safe to repeat).',
      );
    } else {
      console.error('\nFAILED:', e instanceof Error ? e.message : e);
    }
    return EXIT_FAILED;
  } finally {
    rl.close();
  }
}

main().then((code) => process.exit(code));
