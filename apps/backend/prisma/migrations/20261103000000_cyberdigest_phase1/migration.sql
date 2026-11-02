-- CreateEnum
CREATE TYPE "DigestSourceType" AS ENUM ('NEWS_RSS', 'RESEARCH_RSS', 'CVE_API', 'NVD_API', 'KEV_JSON');

-- CreateEnum
CREATE TYPE "DigestSourceHealth" AS ENUM ('UNKNOWN', 'HEALTHY', 'STALE', 'FAILING');

-- CreateEnum
CREATE TYPE "DigestVerificationState" AS ENUM ('PENDING', 'ATTRIBUTED', 'VERIFIED', 'CONFLICTING', 'REJECTED', 'SOURCE_UNAVAILABLE');

-- CreateTable
CREATE TABLE "DigestSource" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "DigestSourceType" NOT NULL,
    "endpoint" TEXT NOT NULL,
    "website" TEXT NOT NULL,
    "trustRole" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "pollIntervalMinutes" INTEGER NOT NULL,
    "health" "DigestSourceHealth" NOT NULL DEFAULT 'UNKNOWN',
    "lastAttemptAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastError" TEXT,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "etag" TEXT,
    "lastModified" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DigestSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DigestRawItem" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload" JSONB NOT NULL,

    CONSTRAINT "DigestRawItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DigestStory" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "canonicalUrl" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "author" TEXT,
    "publishedAt" TIMESTAMP(3),
    "updatedAtSource" TIMESTAMP(3),
    "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastVerifiedAt" TIMESTAMP(3),
    "dedupKey" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "summary" TEXT,
    "cveIds" TEXT[],
    "groupId" TEXT,
    "verificationState" "DigestVerificationState" NOT NULL DEFAULT 'PENDING',
    "rawItemId" TEXT,

    CONSTRAINT "DigestStory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DigestSource_slug_key" ON "DigestSource"("slug");

-- CreateIndex
CREATE INDEX "DigestRawItem_sourceId_fetchedAt_idx" ON "DigestRawItem"("sourceId", "fetchedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DigestRawItem_sourceId_externalId_contentHash_key" ON "DigestRawItem"("sourceId", "externalId", "contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "DigestStory_dedupKey_key" ON "DigestStory"("dedupKey");

-- CreateIndex
CREATE INDEX "DigestStory_publishedAt_idx" ON "DigestStory"("publishedAt");

-- CreateIndex
CREATE INDEX "DigestStory_groupId_idx" ON "DigestStory"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "DigestStory_sourceId_canonicalUrl_key" ON "DigestStory"("sourceId", "canonicalUrl");

-- AddForeignKey
ALTER TABLE "DigestRawItem" ADD CONSTRAINT "DigestRawItem_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "DigestSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DigestStory" ADD CONSTRAINT "DigestStory_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "DigestSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

