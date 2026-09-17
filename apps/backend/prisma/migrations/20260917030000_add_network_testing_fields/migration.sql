-- AlterEnum
ALTER TYPE "TemplateSubType" ADD VALUE 'NETWORK';

-- AlterTable
ALTER TABLE "projects" ADD COLUMN "external_internal" TEXT,
ADD COLUMN "total_scope_count" INTEGER,
ADD COLUMN "network_scope" JSONB;
