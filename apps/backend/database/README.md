# PMIS database migrations

## Architecture
PMIS uses **Prisma Migrate**. It already provides what a migration system needs (a history table, run-once, ordered,
transactional, failure recording), so no second runner exists.

```
apps/backend/
├── prisma/
│   ├── schema.prisma                         # the data model (source of truth for generating migrations)
│   ├── migrations/
│   │   ├── migration_lock.toml
│   │   ├── 20261107000000_baseline/migration.sql   # the single baseline (first production release)
│   │   └── <timestamp>_<name>/migration.sql        # every later change, one folder each
│   ├── baseline-guard.js                     # runs before migrate deploy: stamps pre-baseline databases safely
│   └── seed.ts                               # reference data (admin user, vulnerability library); idempotent
└── database/README.md                        # this file
```
Prisma requires the `prisma/migrations/<timestamp>_<name>/migration.sql` layout; the numbering is the timestamp
prefix (sorted order = execution order). **Seed data is not in migrations**: `prisma db seed` creates it, and roles
are a database enum. Settings and Cyberdigest sources are created by the application on first start.

## The baseline
`20261107000000_baseline` replaces the 61 incremental migrations written between 2026-08-29 and 2026-11-06. It was
generated from `schema.prisma` and verified against them:
- the 61 migrations applied to an empty database end exactly at `schema.prisma` (`prisma migrate diff`: no difference);
- the baseline applied to an empty database produces a structurally identical database (30 tables, 23 enums,
  61 indexes, 65 constraints; no views, triggers, functions or extensions exist);
- the data statements in the old migrations were backfills of rows that already existed; they do nothing on a new
  database, so none are carried over.
The file's checksum is pinned by a test (`src/common/baseline-guard.spec.ts`): **never edit it.**

## How migrations run
`npm run db:migrate` = `node prisma/baseline-guard.js && prisma migrate deploy`. The Docker image runs it on every start
(`npm run db:migrate && prisma db seed && node dist/src/main`), and `setup.bat`, `start.bat`, `start-dev.bat`,
`reset-db.bat` and `setup.sh` call the same command. If any step fails, the chain stops and the app does not start.

- **Runs once, in order:** Prisma records each applied migration in `_prisma_migrations` (name, checksum, started,
  finished, applied steps, logs) and applies only the ones not recorded, in name order. A restart changes nothing.
- **Transactions and failure:** PostgreSQL runs each migration in a transaction; a failing one is rolled back and
  recorded as failed, and nothing after it runs until it is resolved. The guard also refuses to proceed while a
  migration is recorded as failed.
- **Do not use** `prisma migrate dev` or `prisma db push` against a database that holds data you want to keep: `dev` may
  propose resetting it. They are only for generating a new migration on a disposable local database.

## Databases that already exist
A database created before the baseline has all 61 old migrations in `_prisma_migrations`, and the baseline would
fail on it ("type already exists"). `baseline-guard.js` handles that automatically and conservatively:

| Situation | Result |
|---|---|
| Empty database | nothing; `migrate deploy` builds it from the baseline |
| Baseline already recorded | nothing |
| Full old history (last one: `20261106000000_cyberdigest_system_evidence`) **and** the schema equals `schema.prisma` exactly | the baseline is recorded as applied **without running it**; no table is touched |
| Old history incomplete | refused, with the migration it needs. Upgrade first with the release that still contains the individual migrations, then upgrade again |
| Old history complete but the schema differs (manual changes) | refused. Compare with `prisma migrate diff` |
| Tables but no history, or a migration recorded as failed | refused, with instructions |

Check without changing anything: `node prisma/baseline-guard.js --check` (or `npm run db:status`).
Nothing is ever dropped, truncated or reset by this process.

## Creating a new migration (development)
1. Edit `prisma/schema.prisma`.
2. On a **disposable** local database: `npx prisma migrate dev --name short_meaningful_name`. This creates
   `prisma/migrations/<timestamp>_short_meaningful_name/migration.sql`.
3. Read the SQL. Edit it only to make it safer (for example `ADD COLUMN ... DEFAULT`, split a rename into
   add/backfill/drop across releases). Add a data backfill here if existing rows need one.
4. Run `npm run db:migrate` on a fresh database **and** on a copy of an existing one; run the backend tests.
5. Commit the folder with the code change. One concern per migration; adding enum values may need its own migration.

Rules once the first production release is out:
1. Never modify or delete a migration that has been applied anywhere real.
2. Every schema change is a new migration folder; never rely on `db push` or ORM auto-sync.
3. Keep migrations backward-compatible with the previous release where practical (add columns nullable or with defaults;
   drop or rename in a later release), so a rolling deployment or a rollback of the app still works.
4. Test against a staging or production-like copy before deploying.
5. Back up first (below).

## Development database: reset and initialise
- Recreate from scratch (destroys data): `reset-db.bat`, or drop the database / remove the Docker volume yourself, then
  `npm run db:migrate && npx prisma db seed`.
- Keep your data: just run `start.bat`; the guard and `migrate deploy` bring it up to date.

## Production
1. **Back up** the database (`pg_dump -Fc`) and store it off the host. Structural migrations must never run without one.
2. Test the new release against a restored copy of that backup.
3. Deploy the new image. It runs the migrations before starting the app; watch the container log for
   `[db-baseline]` lines and Prisma's `Applying migration` lines. A non-zero exit stops the container.
4. If a migration fails: the failing one was rolled back by PostgreSQL. Restore from the backup (or fix and re-run), mark
   it with `npx prisma migrate resolve --rolled-back "<name>"`, and start again.

## Rollback
Prisma Migrate has no automatic down-migrations. The rollback for a release is: **restore the pre-migration backup and
redeploy the previous image.** For a risky migration, also write the reverse SQL next to it as
`down.sql` in the same folder (Prisma ignores it) and test it on a copy; only additive changes are reliably reversible
without a restore.
