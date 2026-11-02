-- CreateEnum
CREATE TYPE "DigestZeroDayState" AS ENUM ('CONFIRMED', 'REPORTED_UNVERIFIED', 'KNOWN_EXPLOITED_UNCONFIRMED', 'NOT_SUBSTANTIATED', 'UNKNOWN');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'CYBERDIGEST_EVIDENCE_ADDED';
ALTER TYPE "AuditAction" ADD VALUE 'CYBERDIGEST_EVIDENCE_RETRACTED';
ALTER TYPE "AuditAction" ADD VALUE 'CYBERDIGEST_ZERODAY_TRANSITION';
ALTER TYPE "AuditAction" ADD VALUE 'CYBERDIGEST_ZERODAY_APPROVED';
ALTER TYPE "AuditAction" ADD VALUE 'CYBERDIGEST_ZERODAY_WITHDRAWN';

-- CreateTable
CREATE TABLE "DigestZeroDayCase" (
    "id" TEXT NOT NULL,
    "cveId" TEXT NOT NULL,
    "state" "DigestZeroDayState" NOT NULL DEFAULT 'REPORTED_UNVERIFIED',
    "stateReasons" JSONB NOT NULL,
    "stateSetById" TEXT,
    "stateSetAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DigestZeroDayCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DigestZeroDayEvidence" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "eventDate" TIMESTAMP(3),
    "note" TEXT,
    "addedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retractedAt" TIMESTAMP(3),
    "retractedById" TEXT,
    "retractReason" TEXT,

    CONSTRAINT "DigestZeroDayEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DigestZeroDayCase_cveId_key" ON "DigestZeroDayCase"("cveId");

-- CreateIndex
CREATE INDEX "DigestZeroDayCase_state_idx" ON "DigestZeroDayCase"("state");

-- CreateIndex
CREATE INDEX "DigestZeroDayEvidence_caseId_idx" ON "DigestZeroDayEvidence"("caseId");

-- AddForeignKey
ALTER TABLE "DigestZeroDayEvidence" ADD CONSTRAINT "DigestZeroDayEvidence_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "DigestZeroDayCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

