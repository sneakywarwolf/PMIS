-- CreateEnum
CREATE TYPE "ReportGenerationStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

-- AlterTable
ALTER TABLE "report_generations" ADD COLUMN     "error" TEXT,
ADD COLUMN     "status" "ReportGenerationStatus" NOT NULL DEFAULT 'PENDING';

-- Backfill: rows that already produced a file were completed before this column existed
UPDATE "report_generations" SET "status" = 'COMPLETED' WHERE "docx_path" IS NOT NULL;
