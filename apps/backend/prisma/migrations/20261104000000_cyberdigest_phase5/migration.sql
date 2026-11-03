-- CreateEnum
CREATE TYPE "DigestIssueStatus" AS ENUM ('SHADOW', 'PUBLISHED', 'WITHDRAWN');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'CYBERDIGEST_DIGEST_GENERATED';
ALTER TYPE "AuditAction" ADD VALUE 'CYBERDIGEST_DIGEST_PUBLISHED';
ALTER TYPE "AuditAction" ADD VALUE 'CYBERDIGEST_DIGEST_WITHDRAWN';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'CYBERDIGEST_DIGEST';
ALTER TYPE "NotificationType" ADD VALUE 'CYBERDIGEST_SOURCE_DOWN';

-- CreateTable
CREATE TABLE "DigestIssue" (
    "id" TEXT NOT NULL,
    "digestDate" TEXT NOT NULL,
    "status" "DigestIssueStatus" NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generatedById" TEXT,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "content" JSONB NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "publishedById" TEXT,
    "withdrawnAt" TIMESTAMP(3),
    "withdrawnById" TEXT,
    "withdrawReason" TEXT,

    CONSTRAINT "DigestIssue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DigestIssue_digestDate_key" ON "DigestIssue"("digestDate");

-- CreateIndex
CREATE INDEX "DigestIssue_status_idx" ON "DigestIssue"("status");

