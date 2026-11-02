-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'CYBERDIGEST_STORY_APPROVED';
ALTER TYPE "AuditAction" ADD VALUE 'CYBERDIGEST_STORY_REJECTED';
ALTER TYPE "AuditAction" ADD VALUE 'CYBERDIGEST_STORY_CORRECTED';
ALTER TYPE "AuditAction" ADD VALUE 'CYBERDIGEST_SOURCE_UPDATED';

-- AlterTable
ALTER TABLE "DigestStory" ADD COLUMN     "categories" TEXT[],
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedById" TEXT,
ADD COLUMN     "stateNote" TEXT;

-- AlterTable
ALTER TABLE "DigestCve" ADD COLUMN     "maxCvssScore" DOUBLE PRECISION,
ADD COLUMN     "maxCvssSeverity" TEXT,
ADD COLUMN     "vendors" TEXT[];

