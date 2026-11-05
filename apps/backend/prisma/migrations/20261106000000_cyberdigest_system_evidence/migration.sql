-- AlterTable
ALTER TABLE "DigestZeroDayEvidence" ADD COLUMN     "system" BOOLEAN NOT NULL DEFAULT false;


-- Rows written by the system sync before this column existed are the ones with no author.
UPDATE "DigestZeroDayEvidence" SET "system" = true WHERE "addedById" IS NULL;
