-- AlterTable
ALTER TABLE "findings" ADD COLUMN     "cvss_score_override" DOUBLE PRECISION,
ADD COLUMN     "cvss_vector_override" TEXT;

-- CreateTable
CREATE TABLE "poc_steps" (
    "id" TEXT NOT NULL,
    "finding_id" TEXT NOT NULL,
    "step_no" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "image_path" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "poc_steps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "poc_steps_finding_id_idx" ON "poc_steps"("finding_id");

-- AddForeignKey
ALTER TABLE "poc_steps" ADD CONSTRAINT "poc_steps_finding_id_fkey" FOREIGN KEY ("finding_id") REFERENCES "findings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
