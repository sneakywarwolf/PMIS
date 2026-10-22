ALTER TABLE "report_templates" ADD COLUMN "extra_sub_types" "TemplateSubType"[] DEFAULT ARRAY[]::"TemplateSubType"[];
UPDATE "report_templates" SET "extra_sub_types" = ARRAY[]::"TemplateSubType"[] WHERE "extra_sub_types" IS NULL;
ALTER TABLE "report_templates" ALTER COLUMN "extra_sub_types" SET NOT NULL;
