-- Deleting a source template (e.g. on replace) must never break historical
-- report_generations rows or the files they point to; sever the FK instead
-- of restricting the delete.
ALTER TABLE "report_generations" DROP CONSTRAINT "report_generations_template_id_fkey";
ALTER TABLE "report_generations" ALTER COLUMN "template_id" DROP NOT NULL;
ALTER TABLE "report_generations" ADD CONSTRAINT "report_generations_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "report_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
