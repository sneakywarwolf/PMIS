import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateProjectDto, UpdateProjectDto } from './project.dto';

const base = { name: 'App', clientName: 'Acme', startDate: '2026-10-01', category: 'VAPT', subType: 'WEB' };
const errorsFor = async (cls: any, extra: Record<string, unknown>) =>
  (await validate(plainToInstance(cls, { ...base, ...extra }))).map((e) => e.property);

describe('Client SPOC fields on the project DTOs', () => {
  it.each([CreateProjectDto, UpdateProjectDto])('%p: all three are optional', async (cls) => {
    expect(await errorsFor(cls, {})).not.toEqual(expect.arrayContaining(['clientSpocName', 'clientSpocDesignation', 'clientSpocEmail']));
  });

  it.each([CreateProjectDto, UpdateProjectDto])('%p: accepts a name, designation and valid email', async (cls) => {
    const errors = await errorsFor(cls, { clientSpocName: 'Priya Nair', clientSpocDesignation: 'Head of IT', clientSpocEmail: 'priya@acme.com' });
    expect(errors.filter((p) => p.startsWith('clientSpoc'))).toEqual([]);
  });

  it.each([CreateProjectDto, UpdateProjectDto])('%p: a cleared (empty) email is allowed, a malformed one is not', async (cls) => {
    expect(await errorsFor(cls, { clientSpocEmail: '' })).not.toContain('clientSpocEmail');
    expect(await errorsFor(cls, { clientSpocEmail: 'not-an-email' })).toContain('clientSpocEmail');
  });

  it('rejects over-long values', async () => {
    expect(await errorsFor(CreateProjectDto, { clientSpocName: 'x'.repeat(300) })).toContain('clientSpocName');
  });
});
