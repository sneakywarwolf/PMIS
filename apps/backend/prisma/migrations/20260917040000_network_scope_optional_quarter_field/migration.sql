-- AlterTable
ALTER TABLE "projects" ALTER COLUMN "scope" DROP NOT NULL;
ALTER TABLE "projects" ADD COLUMN "quarter" TEXT;
