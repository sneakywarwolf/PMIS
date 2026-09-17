-- AlterTable
ALTER TABLE "projects" ADD COLUMN "report_version_counter" INTEGER NOT NULL DEFAULT 0;

-- Backfill: seed each project's counter from its already-completed report
-- count, so existing projects don't have their next version collide with
-- (or reuse) a version they already generated before this migration.
UPDATE "projects" p
SET "report_version_counter" = (
  SELECT COUNT(*) FROM "report_generations" rg
  WHERE rg."project_id" = p."id" AND rg."status" = 'COMPLETED'
);
