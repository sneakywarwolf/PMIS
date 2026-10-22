import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getQueueToken } from '@nestjs/bullmq';
import { BadRequestException } from '@nestjs/common';
import { ReportFormat, UserRole } from '@prisma/client';
import { ReportsService } from './reports.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from './storage.service';
import { DocxManipulatorService } from './docx-manipulator.service';
import { XlsxTemplateService } from './xlsx-template.service';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';
import { REPORT_GENERATION_QUEUE } from './report-generation.types';

const admin = { id: 'admin1', role: UserRole.ADMIN } as any;
const network = (over: object = {}) => ({
  id: 'p1', complianceStatus: 'Compliant', name: 'Acme Net', clientName: 'Acme', category: 'VAPT', subType: 'NETWORK', startDate: new Date('2026-10-01'), endDate: new Date('2026-10-10'),
  template: { id: 'wordT', reportFormat: 'WORD' }, tester: { fullName: 'Asha' }, tl: { manager: null }, findings: [], ...over,
});

async function setup(project: any = network()) {
  const prisma: any = {
    project: { findUnique: jest.fn().mockResolvedValue(project) },
    reportTemplate: { findFirst: jest.fn().mockResolvedValue(null), findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]), create: jest.fn(), update: jest.fn() },
    reportGeneration: { count: jest.fn().mockResolvedValue(0), create: jest.fn().mockResolvedValue({ id: 'rg1' }) },
  };
  const queue = { add: jest.fn() };
  const moduleRef = await Test.createTestingModule({
    providers: [
      ReportsService,
      DocxManipulatorService, // real: the Excel path must resolve values through the very same lookup
      XlsxTemplateService,
      { provide: PrismaService, useValue: prisma },
      { provide: StorageService, useValue: { uploadFile: jest.fn(), deleteFile: jest.fn() } },
      { provide: ConfigService, useValue: { get: jest.fn() } },
      { provide: AuditService, useValue: { log: jest.fn() } },
      { provide: SettingsService, useValue: { get: jest.fn().mockResolvedValue({ settings: {} }) } },
      { provide: getQueueToken(REPORT_GENERATION_QUEUE), useValue: queue },
    ],
  }).compile();
  return { service: moduleRef.get(ReportsService), prisma, queue };
}

describe('Excel report generation', () => {
  it('is only offered for Network projects', async () => {
    const { service, queue } = await setup(network({ subType: 'WEB' }));
    await expect(service.generateReport('p1', admin, 'ip', 'ua', ReportFormat.EXCEL)).rejects.toThrow(/only available for Network/);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('says so clearly when no Excel template is active, and never falls back to the Word template', async () => {
    const { service, prisma, queue } = await setup();
    await expect(service.generateReport('p1', admin, 'ip', 'ua', ReportFormat.EXCEL)).rejects.toThrow(/No active Excel template is available for VAPT \/ NETWORK/);
    expect(prisma.reportTemplate.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ reportFormat: 'EXCEL' }) }));
    expect(prisma.reportGeneration.create).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it("queues the active Excel template, ignoring the project's pinned Word template", async () => {
    const { service, prisma, queue } = await setup();
    prisma.reportTemplate.findFirst.mockResolvedValue({ id: 'xlsxT', reportFormat: 'EXCEL', fields: [] });
    await service.generateReport('p1', admin, 'ip', 'ua', ReportFormat.EXCEL);
    expect(prisma.reportGeneration.create.mock.calls[0][0].data.templateId).toBe('xlsxT');
    expect(queue.add).toHaveBeenCalled();
  });

  it('Word generation is unchanged: it uses the pinned Word template and never an Excel one', async () => {
    const { service, prisma } = await setup();
    await service.generateReport('p1', admin, 'ip', 'ua');
    expect(prisma.reportGeneration.create.mock.calls[0][0].data.templateId).toBe('wordT');
    expect(prisma.reportTemplate.findFirst).not.toHaveBeenCalled();

    const pinnedExcel = await setup(network({ template: { id: 'xlsxT', reportFormat: 'EXCEL' } }));
    pinnedExcel.prisma.reportTemplate.findFirst.mockResolvedValue({ id: 'wordDefault', reportFormat: 'WORD', fields: [] });
    await pinnedExcel.service.generateReport('p1', admin, 'ip', 'ua');
    expect(pinnedExcel.prisma.reportGeneration.create.mock.calls[0][0].data.templateId).toBe('wordDefault');
    expect(pinnedExcel.prisma.reportTemplate.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ reportFormat: 'WORD' }) }));
  });
});

describe('Excel placeholders use the Word mapping system', () => {
  it('resolve through the same rules, with saved mappings winning, exactly like Word', async () => {
    const { service } = await setup();
    const docx = (service as any).docxManipulator as DocxManipulatorService;
    const project = network({ clientName: 'Acme', location: 'Pune', qaReviewerName: 'Ravi' });
    const template = { fields: [{ name: 'Client Name', normalizedName: 'client_name', mappedParameter: 'project.clientNameLocation' }] };

    const rules = (service as any).buildMappedFieldRules(template, project, '1.0', '12-10-2026')
      .concat((service as any).buildFieldRules(project, '1.0', '12-10-2026'))
      .concat((service as any).buildCustomFieldRules(project));
    const wordLookup = docx.buildResolver(rules);
    const excel = (service as any).excelResolver(template, project, '1.0', '12-10-2026');

    for (const raw of ['Client Name', 'QA Reviewer Name', 'Tester Name', 'Start Date']) {
      expect(excel(raw)).toBe(wordLookup(raw.toLowerCase().replace(/[^a-z0-9]+/g, '_')));
    }
    expect(excel('Client Name')).toBe('Acme, Pune'); // admin mapping, not the built-in fallback
    expect(excel('QA Reviewer Name')).toBe('Ravi');
    expect(excel('Totally Unknown')).toBeUndefined(); // left literal in the workbook, as in Word
    expect(excel('Report Name')).toBeUndefined();
    expect((service as any).excelResolver(template, project, '1.0', '12-10-2026', 'My-Report.xlsx')('Report Name')).toBe('My-Report.xlsx');
  });
});

describe('Template upload: Report Type', () => {
  const file = (name: string) => ({ originalname: name, buffer: Buffer.from('x'), mimetype: 'application/octet-stream' }) as Express.Multer.File;
  const upload = async (name: string, format: ReportFormat) => {
    const { service } = await setup();
    return service.uploadTemplate(file(name), 'T', 'VAPT' as any, 'NETWORK' as any, new Date(), null, 'admin1', 'ip', 'ua', format);
  };

  it('rejects an extension that does not match the selected Report Type, naming the fix', async () => {
    await expect(upload('t.xlsx', ReportFormat.WORD)).rejects.toThrow(/choose Report Type "Excel Report"/);
    await expect(upload('t.docx', ReportFormat.EXCEL)).rejects.toThrow(/choose Report Type "Word Report"/);
    await expect(upload('t.pdf', ReportFormat.WORD)).rejects.toThrow(BadRequestException);
    await expect(upload('t.pdf', ReportFormat.EXCEL)).rejects.toThrow(/Only \.xlsx/);
  });
});

describe('Activation is per report format', () => {
  it('only replaces an active template of the same format, so a Word template survives an Excel activation', async () => {
    const { service, prisma } = await setup();
    prisma.reportTemplate.findUnique.mockResolvedValue({ id: 'x2', category: 'VAPT', subType: 'NETWORK', reportFormat: 'EXCEL', name: 'X' });
    prisma.reportTemplate.update.mockResolvedValue({ id: 'x2', name: 'X' });
    await service.activateTemplate('x2', 'admin1', 'ip', 'ua').catch(() => undefined);
    expect(prisma.reportTemplate.findMany).toHaveBeenCalledWith({
      where: { category: 'VAPT', subType: 'NETWORK', reportFormat: 'EXCEL', isActive: true, id: { not: 'x2' } },
    });
  });
});

describe('Client SPOC placeholders', () => {
  const resolverFor = async (project: any) => {
    const { service } = await setup();
    return (service as any).excelResolver({ fields: [] }, project, '1.0', '12-10-2026') as (raw: string) => string | undefined;
  };

  it('{Client SPOC name} / {Client SPOC Designation} / {Client SPOC Email ID} fill from the project, in Word and Excel alike', async () => {
    const { service } = await setup();
    const docx = (service as any).docxManipulator as DocxManipulatorService;
    const project = network({ clientName: 'Acme', clientSpocName: 'Priya Nair', clientSpocDesignation: 'Head of IT Security', clientSpocEmail: 'priya@acme.com' });
    const wordLookup = docx.buildResolver((service as any).buildFieldRules(project, '1.0', '12-10-2026'));
    const excel = await resolverFor(project);

    const expected: Record<string, string> = {
      'Client SPOC name': 'Priya Nair',
      'Client SPOC Designation': 'Head of IT Security',
      'Client SPOC Email ID': 'priya@acme.com',
    };
    for (const [raw, value] of Object.entries(expected)) {
      expect(excel(raw)).toBe(value);
      expect(wordLookup(raw.toLowerCase().replace(/[^a-z0-9]+/g, '_'))).toBe(value);
    }
  });

  it('are optional: a project without them prints N/A', async () => {
    const excel = await resolverFor(network({ clientName: 'Acme' }));
    expect(excel('Client SPOC name')).toBe('N/A');
    expect(excel('Client SPOC Designation')).toBe('N/A');
    expect(excel('Client SPOC Email ID')).toBe('N/A');
  });

  it('do not disturb the existing client placeholders', async () => {
    const excel = await resolverFor(network({ clientName: 'Acme', location: 'Pune', clientSpocName: 'Priya' }));
    expect(excel('Client Name')).toBe('Acme');
    expect(excel('Client Name & Location')).toBe('Acme, Pune');
    expect(excel('Location')).toBe('Pune');
  });

  it('can be mapped in Template Mapping through the canonical parameter list', async () => {
    const { CANONICAL_TEMPLATE_PARAMETERS, resolveTemplateParameter } = await import('./template-parameters');
    const project = { clientSpocName: 'Priya', clientSpocDesignation: '', clientSpocEmail: 'p@acme.com' };
    const keys = CANONICAL_TEMPLATE_PARAMETERS.map((p) => p.key);
    expect(keys).toEqual(expect.arrayContaining(['project.clientSpocName', 'project.clientSpocDesignation', 'project.clientSpocEmail']));
    expect(resolveTemplateParameter('project.clientSpocName', project, String)).toBe('Priya');
    expect(resolveTemplateParameter('project.clientSpocDesignation', project, String)).toBe('N/A');
    expect(resolveTemplateParameter('project.clientSpocEmail', project, String)).toBe('p@acme.com');
  });
});
