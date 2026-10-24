import { TemplateCategory as C, TemplateSubType as S } from '@prisma/client';
import { eligibleForProject, isEligibleTemplate, parseExtraSubTypes } from './template-subtypes';

describe('template activity types', () => {
  it('Cert-In Application template is the umbrella for non-Network projects only', () => {
    expect(eligibleForProject(C.CERT_IN, S.WEB)).toEqual({
      OR: [{ subType: S.WEB }, { extraSubTypes: { has: S.WEB } }, { subType: S.APPLICATION }, { extraSubTypes: { has: S.APPLICATION } }],
    });
    expect(eligibleForProject(C.CERT_IN, S.NETWORK)).toEqual({ OR: [{ subType: S.NETWORK }, { extraSubTypes: { has: S.NETWORK } }] });
  });
  it('Application is not a wildcard outside Cert-In', () => {
    expect(JSON.stringify(eligibleForProject(C.PCI, S.WEB))).not.toContain('APPLICATION');
  });
  it('rejects Application for PCI/VAPT (primary or extra) and non-Cert-In types for Cert-In', () => {
    for (const c of [C.PCI, C.VAPT]) {
      expect(() => parseExtraSubTypes([], S.APPLICATION, c)).toThrow();
      expect(() => parseExtraSubTypes([S.APPLICATION], S.WEB, c)).toThrow();
      expect(parseExtraSubTypes([S.API, S.NETWORK], S.WEB, c)).toEqual([S.API, S.NETWORK]);
    }
    expect(() => parseExtraSubTypes([], S.WEB, C.CERT_IN)).toThrow();
    expect(parseExtraSubTypes([S.NETWORK], S.APPLICATION, C.CERT_IN)).toEqual([S.NETWORK]);
  });

  describe('isEligibleTemplate (backend re-check of a pinned template)', () => {
    const t = (over: object = {}) => ({ isActive: true, category: C.CERT_IN, subType: S.APPLICATION, extraSubTypes: [] as S[], reportFormat: 'WORD', ...over });
    it('Cert-In: Application template fits non-Network projects, Network projects need a Network template', () => {
      expect(isEligibleTemplate(t(), C.CERT_IN, S.WEB, 'WORD')).toBe(true);
      expect(isEligibleTemplate(t(), C.CERT_IN, S.NETWORK, 'WORD')).toBe(false);
      expect(isEligibleTemplate(t({ subType: S.NETWORK }), C.CERT_IN, S.NETWORK, 'WORD')).toBe(true);
      expect(isEligibleTemplate(t({ subType: S.NETWORK }), C.CERT_IN, S.WEB, 'WORD')).toBe(false);
    });
    it('PCI / VAPT: only a template covering the Testing Type itself (primary or extra)', () => {
      expect(isEligibleTemplate(t({ category: C.PCI, subType: S.WEB }), C.PCI, S.WEB, 'WORD')).toBe(true);
      expect(isEligibleTemplate(t({ category: C.PCI, subType: S.API, extraSubTypes: [S.WEB] }), C.PCI, S.WEB, 'WORD')).toBe(true);
      expect(isEligibleTemplate(t({ category: C.PCI, subType: S.APPLICATION }), C.PCI, S.WEB, 'WORD')).toBe(false);
    });
    it('rejects an inactive template, another category and another report format', () => {
      expect(isEligibleTemplate(t({ isActive: false }), C.CERT_IN, S.WEB, 'WORD')).toBe(false);
      expect(isEligibleTemplate(t({ category: C.PCI, subType: S.WEB }), C.VAPT, S.WEB, 'WORD')).toBe(false);
      expect(isEligibleTemplate(t(), C.CERT_IN, S.WEB, 'EXCEL')).toBe(false);
    });
  });
});
