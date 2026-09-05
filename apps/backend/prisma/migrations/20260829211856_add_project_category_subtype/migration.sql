-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "category" "TemplateCategory" NOT NULL DEFAULT 'VAPT',
ADD COLUMN     "sub_type" "TemplateSubType" NOT NULL DEFAULT 'WEB';
