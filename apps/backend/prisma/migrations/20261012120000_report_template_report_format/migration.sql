-- Additive only: which kind of document a report template produces. Existing rows default to WORD;
-- any template whose stored file is an .xlsx is classified EXCEL. Mappings and metadata are untouched.
CREATE TYPE "ReportFormat" AS ENUM ('WORD', 'EXCEL');
ALTER TABLE "report_templates" ADD COLUMN "report_format" "ReportFormat" NOT NULL DEFAULT 'WORD';
UPDATE "report_templates" SET "report_format" = 'EXCEL' WHERE lower("file_path") LIKE '%.xlsx';
CREATE INDEX "report_templates_report_format_idx" ON "report_templates"("report_format");
