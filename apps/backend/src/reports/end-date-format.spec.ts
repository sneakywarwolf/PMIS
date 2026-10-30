import { resolveTemplateParameter } from './template-parameters';

describe('{End Date} format', () => {
  const project = { startDate: new Date(2026, 9, 1), endDate: new Date(2026, 9, 29) };
  const long = (d: Date) => d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: '2-digit' });
  const dmy = (d: Date) => `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;

  it('uses the end-date formatter only for project.endDate', () => {
    expect(resolveTemplateParameter('project.endDate', project, long, undefined, undefined, undefined, dmy)).toBe('29-10-2026');
    expect(resolveTemplateParameter('project.startDate', project, long, undefined, undefined, undefined, dmy)).toBe('October 01, 2026');
  });
  it('is unchanged when no end-date formatter is given', () => {
    expect(resolveTemplateParameter('project.endDate', project, long)).toBe('October 29, 2026');
  });
});
