import { Test } from '@nestjs/testing';
import { ProjectPurgeService } from './project-purge.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../reports/storage.service';

describe('ProjectPurgeService.purgeProject', () => {
  let service: ProjectPurgeService;
  let prisma: { project: { delete: jest.Mock } };
  let storage: { deleteFile: jest.Mock };

  beforeEach(async () => {
    prisma = { project: { delete: jest.fn() } };
    storage = { deleteFile: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ProjectPurgeService,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: storage },
      ],
    }).compile();
    service = moduleRef.get(ProjectPurgeService);
  });

  it('deletes every associated stored file, then the project row, and reports the count', async () => {
    const project = {
      id: 'p1',
      reportDocxPath: 'report.docx',
      reportPdfPath: null,
      reportGenerations: [{ docxPath: 'gen1.docx', pdfPath: 'gen1.pdf' }],
      findings: [{ evidencePaths: ['ev1.png'], pocSteps: [{ imagePath: 'poc1.png' }, { imagePath: null }] }],
    };

    const result = await service.purgeProject(project);

    expect(storage.deleteFile).toHaveBeenCalledWith('report.docx');
    expect(storage.deleteFile).toHaveBeenCalledWith('gen1.docx');
    expect(storage.deleteFile).toHaveBeenCalledWith('gen1.pdf');
    expect(storage.deleteFile).toHaveBeenCalledWith('ev1.png');
    expect(storage.deleteFile).toHaveBeenCalledWith('poc1.png');
    expect(storage.deleteFile).toHaveBeenCalledTimes(5);
    expect(prisma.project.delete).toHaveBeenCalledWith({ where: { id: 'p1' } });
    expect(result.filesDeleted).toBe(5);
  });

  it('continues deleting the project even if a file delete throws', async () => {
    storage.deleteFile.mockRejectedValueOnce(new Error('storage unreachable'));
    const project = {
      id: 'p1',
      reportDocxPath: 'report.docx',
      reportPdfPath: null,
      reportGenerations: [],
      findings: [],
    };

    await expect(service.purgeProject(project)).resolves.toEqual({ filesDeleted: 1 });
    expect(prisma.project.delete).toHaveBeenCalledWith({ where: { id: 'p1' } });
  });
});
