-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'CYBERDIGEST_CONFIG_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'CYBERDIGEST_ALLOWLIST_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE 'CYBERDIGEST_SOURCE_ADDED';
ALTER TYPE "AuditAction" ADD VALUE 'CYBERDIGEST_BULK_APPROVED';

-- CreateTable
CREATE TABLE "DigestConfig" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "moduleEnabledForNonAdmins" BOOLEAN NOT NULL DEFAULT true,
    "pipelineEnabled" BOOLEAN NOT NULL DEFAULT true,
    "publishTime" TEXT NOT NULL DEFAULT '08:00',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "publishMode" TEXT NOT NULL DEFAULT 'AUTO',
    "minDiscoveryCoveragePct" INTEGER NOT NULL DEFAULT 50,
    "retentionDays" INTEGER NOT NULL DEFAULT 365,
    "jobRetryBackoffMinutes" INTEGER NOT NULL DEFAULT 10,
    "linkHosts" TEXT[],
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DigestConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DigestJobRun" (
    "id" TEXT NOT NULL,
    "job" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "error" TEXT,
    "detail" JSONB,

    CONSTRAINT "DigestJobRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DigestLock" (
    "name" TEXT NOT NULL,
    "holder" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DigestLock_pkey" PRIMARY KEY ("name")
);

-- CreateIndex
CREATE INDEX "DigestJobRun_job_startedAt_idx" ON "DigestJobRun"("job", "startedAt");

