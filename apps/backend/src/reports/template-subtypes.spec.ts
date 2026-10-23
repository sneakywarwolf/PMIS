import { TemplateCategory as C, TemplateSubType as S } from '@prisma/client';
import { eligibleForProject, parseExtraSubTypes } from './template-subtypes';

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
});
