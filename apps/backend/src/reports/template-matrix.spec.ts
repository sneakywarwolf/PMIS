import { TemplateCategory as C, TemplateSubType as S } from '@prisma/client';
import { isEligibleTemplate } from './template-subtypes';

// Compliance Type x Platform -> expected template. A missing template is an error, never a silent fallback.
const tpl = (category: C, subType: S) => ({ isActive: true, category, subType, extraSubTypes: [] as S[], reportFormat: 'WORD' as const });
const picks = (category: C, project: S) =>
  Object.values(S).filter((s) => isEligibleTemplate(tpl(category, s), category, project, 'WORD'));
const APP_COMPATIBLE = [S.WEB, S.API, S.MOBILE, S.THICK_CLIENT, S.APPLICATION];

describe('compliance / platform -> template matrix', () => {
  it.each([C.CERT_IN, C.PCI, C.VAPT])('%s Network uses the Network template', (c) => {
    expect(picks(c, S.NETWORK)).toEqual([S.NETWORK]);
  });
  it.each([C.CERT_IN, C.PCI, C.VAPT])('%s SCR uses the SCR template only', (c) => {
    expect(picks(c, S.SCR)).toEqual([S.SCR]);
  });
  it.each(APP_COMPATIBLE)('CERT-IN %s uses the Application template', (p) => {
    expect(picks(C.CERT_IN, p)).toContain(S.APPLICATION);
    expect(picks(C.CERT_IN, p)).not.toContain(S.NETWORK);
    expect(picks(C.CERT_IN, p)).not.toContain(S.SCR);
  });
  it.each([C.PCI, C.VAPT])('%s never uses the Application template', (c) => {
    for (const p of APP_COMPATIBLE.filter((s) => s !== S.APPLICATION)) expect(picks(c, p)).not.toContain(S.APPLICATION);
  });
});
