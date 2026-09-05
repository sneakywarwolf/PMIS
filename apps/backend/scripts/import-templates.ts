/**
 * Template Import Script
 * 
 * This script imports all DOCX templates from the "Report Template" folder
 * into the application's template system. It extracts yellow-highlighted fields
 * and stores them in the database.
 * 
 * Usage: ts-node scripts/import-templates.ts
 */

import { PrismaClient, TemplateCategory, TemplateSubType } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { DocxManipulatorService } from '../src/reports/docx-manipulator.service';

const prisma = new PrismaClient();

// Map filename patterns to sub-types
function detectSubType(filename: string): TemplateSubType {
  const lower = filename.toLowerCase();
  if (lower.includes('_api_')) return 'API';
  if (lower.includes('_mobile_')) return 'MOBILE';
  if (lower.includes('_thick-client_') || lower.includes('_thick_client_')) return 'THICK_CLIENT';
  if (lower.includes('_web_')) return 'WEB';
  return 'WEB';
}

// Map folder name to category
function detectCategory(folderName: string): TemplateCategory {
  const upper = folderName.toUpperCase();
  if (upper === 'PCI') return 'PCI';
  return 'VAPT';
}

async function main() {
  console.log('📁 Starting template import...');

  const templateDir = path.resolve(__dirname, '../../Report Template');
  
  if (!fs.existsSync(templateDir)) {
    console.error(`❌ Template directory not found: ${templateDir}`);
    process.exit(1);
  }

  // Get admin user for uploadedBy
  const admin = await prisma.user.findFirst({
    where: { role: 'ADMIN', isActive: true },
  });

  if (!admin) {
    console.error('❌ No active admin user found. Run seed first.');
    process.exit(1);
  }

  const docxManipulator = new DocxManipulatorService();
  const importedCount = { success: 0, failed: 0 };

  // Iterate through category folders (PCI, VAPT)
  const categoryFolders = fs.readdirSync(templateDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  for (const categoryFolder of categoryFolders) {
    const category = detectCategory(categoryFolder);
    const categoryPath = path.join(templateDir, categoryFolder);

    console.log(`\n📂 Processing ${category} templates...`);

    // Get all DOCX files in this category
    const docxFiles = fs.readdirSync(categoryPath)
      .filter(f => f.endsWith('.docx'))
      .map(f => path.join(categoryPath, f));

    for (const filePath of docxFiles) {
      const filename = path.basename(filePath);
      const subType = detectSubType(filename);

      try {
        // Check if template already exists
        const existing = await prisma.reportTemplate.findFirst({
          where: { name: filename },
        });

        if (existing) {
          console.log(`  ⏭️  Skipping (already exists): ${filename}`);
          continue;
        }

        // Read file
        const fileBuffer = fs.readFileSync(filePath);
        const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

        // Extract fields
        console.log(`  🔍 Extracting fields from: ${filename}`);
        const extractedFields = await docxManipulator.extractYellowFields(fileBuffer);
        console.log(`     Found ${extractedFields.length} unique fields`);

        // For this import script, we skip MinIO upload and store locally
        // In production, use StorageService to upload to MinIO
        const relativePath = `templates/imported/${category}/${subType}/${filename}`;
        
        // Ensure directory exists
        const storageDir = path.resolve(__dirname, '../../storage', path.dirname(relativePath));
        fs.mkdirSync(storageDir, { recursive: true });
        fs.copyFileSync(filePath, path.join(storageDir, filename));

        // Create template record
        const template = await prisma.reportTemplate.create({
          data: {
            name: filename,
            filePath: relativePath,
            fileHash,
            category,
            subType,
            projectType: `${category}_${subType}`,
            effectiveFrom: new Date(),
            isActive: true,
            uploadedById: admin.id,
            fields: {
              create: extractedFields.map((field, index) => ({
                name: field.name,
                normalizedName: field.normalizedName,
                category: field.category.toUpperCase().replace(/-/g, '_') as any,
                description: field.description,
                isRepeatable: field.isRepeatable,
                sortOrder: index,
              })),
            },
          },
        });

        console.log(`  ✅ Imported: ${filename} (${category} • ${subType}) - ${template.id}`);
        importedCount.success++;
      } catch (error) {
        console.error(`  ❌ Failed: ${filename}`, error instanceof Error ? error.message : error);
        importedCount.failed++;
      }
    }
  }

  console.log(`\n📊 Import Summary:`);
  console.log(`   Success: ${importedCount.success}`);
  console.log(`   Failed: ${importedCount.failed}`);
  console.log(`\n🎉 Template import complete!`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
