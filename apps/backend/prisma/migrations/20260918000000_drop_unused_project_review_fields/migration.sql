-- AlterTable
ALTER TABLE "projects" DROP COLUMN "is_draft",
DROP COLUMN "approved_at",
DROP COLUMN "approved_by_id";

-- AlterTable
ALTER TABLE "report_generations" DROP COLUMN "is_draft";
