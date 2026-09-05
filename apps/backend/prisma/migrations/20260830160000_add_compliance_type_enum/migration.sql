-- Create ComplianceType enum
CREATE TYPE "ComplianceType" AS ENUM ('VAPT', 'CERT_IN', 'PCI', 'ASV');

-- Add compliance_type column to projects
ALTER TABLE "projects" ADD COLUMN "compliance_type" "ComplianceType";

-- Update TemplateCategory to include CERT_IN and ASV
-- PostgreSQL requires recreating the enum to add values
-- First, create a new enum with all values
CREATE TYPE "TemplateCategory_new" AS ENUM ('PCI', 'VAPT', 'CERT_IN', 'ASV');

-- Update the column to use the new enum
ALTER TABLE "projects" ALTER COLUMN "category" DROP DEFAULT;
ALTER TABLE "projects" ALTER COLUMN "category" TYPE "TemplateCategory_new" USING ("category"::text::"TemplateCategory_new");
ALTER TABLE "projects" ALTER COLUMN "category" SET DEFAULT 'VAPT';

ALTER TABLE "report_templates" ALTER COLUMN "category" DROP DEFAULT;
ALTER TABLE "report_templates" ALTER COLUMN "category" TYPE "TemplateCategory_new" USING ("category"::text::"TemplateCategory_new");
ALTER TABLE "report_templates" ALTER COLUMN "category" SET DEFAULT 'VAPT';

-- Drop old enum and rename new one
DROP TYPE "TemplateCategory";
ALTER TYPE "TemplateCategory_new" RENAME TO "TemplateCategory";
