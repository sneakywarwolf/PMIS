-- AlterTable
ALTER TABLE "template_fields" ADD COLUMN "is_custom" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "projects" ADD COLUMN "custom_field_values" JSONB;
