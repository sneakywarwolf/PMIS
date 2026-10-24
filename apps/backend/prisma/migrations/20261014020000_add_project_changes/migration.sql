-- CreateTable
CREATE TABLE "project_changes" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "project_name" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "old_value" JSONB,
    "new_value" JSONB,
    "changed_by_id" TEXT,
    "changed_by_name" TEXT NOT NULL,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_changes_project_id_changed_at_idx" ON "project_changes"("project_id", "changed_at");

-- AddForeignKey
ALTER TABLE "project_changes" ADD CONSTRAINT "project_changes_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_changes" ADD CONSTRAINT "project_changes_changed_by_id_fkey" FOREIGN KEY ("changed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
