-- CreateEnum
CREATE TYPE "VulnerabilityStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'VULNERABILITY_REQUESTED';
ALTER TYPE "AuditAction" ADD VALUE 'VULNERABILITY_APPROVED';
ALTER TYPE "AuditAction" ADD VALUE 'VULNERABILITY_REJECTED';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "designation" TEXT,
ADD COLUMN     "full_name" TEXT,
ADD COLUMN     "manager_id" TEXT,
ADD COLUMN     "phone" TEXT;

-- AlterTable
ALTER TABLE "vulnerabilities" ADD COLUMN     "is_active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "requested_by" TEXT,
ADD COLUMN     "reviewed_at" TIMESTAMP(3),
ADD COLUMN     "reviewed_by" TEXT,
ADD COLUMN     "status" "VulnerabilityStatus" NOT NULL DEFAULT 'APPROVED';

-- CreateIndex
CREATE INDEX "vulnerabilities_status_idx" ON "vulnerabilities"("status");

-- CreateIndex
CREATE INDEX "vulnerabilities_is_active_idx" ON "vulnerabilities"("is_active");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vulnerabilities" ADD CONSTRAINT "vulnerabilities_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vulnerabilities" ADD CONSTRAINT "vulnerabilities_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
