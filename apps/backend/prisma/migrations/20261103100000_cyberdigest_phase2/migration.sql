-- CreateEnum
CREATE TYPE "DigestCveRecordStatus" AS ENUM ('PUBLISHED', 'RESERVED', 'REJECTED', 'NOT_FOUND', 'UNAVAILABLE');

-- CreateEnum
CREATE TYPE "DigestNvdEnrichment" AS ENUM ('PENDING', 'ENRICHED', 'UNAVAILABLE');

-- CreateTable
CREATE TABLE "DigestCve" (
    "id" TEXT NOT NULL,
    "cveId" TEXT NOT NULL,
    "recordStatus" "DigestCveRecordStatus" NOT NULL,
    "description" TEXT,
    "assigner" TEXT,
    "recordPublishedAt" TIMESTAMP(3),
    "recordUpdatedAt" TIMESTAMP(3),
    "affected" JSONB,
    "references" JSONB,
    "cvss" JSONB,
    "nvdEnrichment" "DigestNvdEnrichment" NOT NULL DEFAULT 'PENDING',
    "nvdStatus" TEXT,
    "nvdLastModified" TIMESTAMP(3),
    "nvdAffected" JSONB,
    "kevListed" BOOLEAN,
    "kevDateAdded" TIMESTAMP(3),
    "kevData" JSONB,
    "conflicts" JSONB,
    "provenance" JSONB NOT NULL,
    "lastAttemptAt" TIMESTAMP(3),
    "lastVerifiedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DigestCve_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DigestKevEntry" (
    "cveId" TEXT NOT NULL,
    "vendorProject" TEXT NOT NULL,
    "product" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dateAdded" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3),
    "ransomwareUse" TEXT NOT NULL,
    "shortDescription" TEXT NOT NULL,
    "notes" TEXT,
    "catalogVersion" TEXT NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DigestKevEntry_pkey" PRIMARY KEY ("cveId")
);

-- CreateTable
CREATE TABLE "DigestEvent" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "detail" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DigestEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DigestCve_cveId_key" ON "DigestCve"("cveId");

-- CreateIndex
CREATE INDEX "DigestCve_recordStatus_idx" ON "DigestCve"("recordStatus");

-- CreateIndex
CREATE INDEX "DigestCve_kevListed_idx" ON "DigestCve"("kevListed");

-- CreateIndex
CREATE INDEX "DigestEvent_entityType_entityId_createdAt_idx" ON "DigestEvent"("entityType", "entityId", "createdAt");

-- Phase 1 registered the authoritative sources disabled; their code exists now.
UPDATE "DigestSource" SET "enabled" = true WHERE "slug" IN ('cve-org', 'nvd', 'cisa-kev');

