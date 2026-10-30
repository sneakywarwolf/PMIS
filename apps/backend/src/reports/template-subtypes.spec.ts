import { TemplateCategory as C, TemplateSubType as S } from '@prisma/client';
import { eligibleForProject, isEligibleTemplate, parseExtraSubTypes } from './template-subtypes';

describe('template activity types', () => {
  const t = (over: object = {}) => ({ isActive: true, category: C.CERT_IN, subType: S.APPLICATION, extraSubTypes: [] as S[], reportFormat: 'WORD', ...over });
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

  it('SCR: PCI / VAPT need an SCR template; Cert-In needs its own SCR template, never the Application one', () => {
    expect(isEligibleTemplate(t({ category: C.VAPT, subType: S.SCR }), C.VAPT, S.SCR, 'WORD')).toBe(true);
    expect(isEligibleTemplate(t({ category: C.PCI, subType: S.WEB, extraSubTypes: [S.SCR] }), C.PCI, S.SCR, 'WORD')).toBe(true);
    expect(isEligibleTemplate(t({ category: C.VAPT, subType: S.WEB }), C.VAPT, S.SCR, 'WORD')).toBe(false);
    expect(isEligibleTemplate(t({ category: C.CERT_IN, subType: S.SCR }), C.CERT_IN, S.SCR, 'WORD')).toBe(true);
    expect(isEligibleTemplate(t({ category: C.CERT_IN, subType: S.SCR }), C.CERT_IN, S.SCR, 'EXCEL')).toBe(false); // the format still has to match
    expect(isEligibleTemplate(t({ category: C.CERT_IN, subType: S.APPLICATION }), C.CERT_IN, S.SCR, 'WORD')).toBe(false); // no silent fallback
    expect(isEligibleTemplate(t({ category: C.CERT_IN, subType: S.NETWORK }), C.CERT_IN, S.SCR, 'WORD')).toBe(false);
  });

  it('Cert-In Application and Network projects select as before; an SCR template is not an Application one', () => {
    expect(eligibleForProject(C.CERT_IN, S.SCR)).toEqual({ OR: [{ subType: S.SCR }, { extraSubTypes: { has: S.SCR } }] });
    expect(eligibleForProject(C.CERT_IN, S.NETWORK)).toEqual({ OR: [{ subType: S.NETWORK }, { extraSubTypes: { has: S.NETWORK } }] });
    expect(JSON.stringify(eligibleForProject(C.CERT_IN, S.WEB))).toContain('APPLICATION');
    expect(isEligibleTemplate(t({ category: C.CERT_IN, subType: S.APPLICATION }), C.CERT_IN, S.WEB, 'WORD')).toBe(true);
    expect(isEligibleTemplate(t({ category: C.CERT_IN, subType: S.SCR }), C.CERT_IN, S.WEB, 'WORD')).toBe(false);
    expect(isEligibleTemplate(t({ category: C.CERT_IN, subType: S.NETWORK }), C.CERT_IN, S.NETWORK, 'WORD')).toBe(true);
  });

  it('Cert-In uploads accept Network, Application and SCR; PCI / VAPT still refuse Application', () => {
    expect(parseExtraSubTypes(['SCR'], S.APPLICATION, C.CERT_IN)).toEqual([S.SCR]);
    expect(parseExtraSubTypes([], S.SCR, C.CERT_IN)).toEqual([]);
    expect(() => parseExtraSubTypes(['WEB'], S.SCR, C.CERT_IN)).toThrow();
    expect(parseExtraSubTypes(['SCR'], S.WEB, C.VAPT)).toEqual([S.SCR]);
    expect(() => parseExtraSubTypes(['APPLICATION'], S.SCR, C.PCI)).toThrow();
  });
});
