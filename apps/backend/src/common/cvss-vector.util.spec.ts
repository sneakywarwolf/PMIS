import { computeCvss2, computeCvss31, resolveCvssVector, stripCvssPrefix } from './cvss-vector.util';
import { DocxManipulatorService } from '../reports/docx-manipulator.service';

const parse = (v: string) => Object.fromEntries(v.replace(/^CVSS:3\.1\//, '').split('/').map((p) => p.split(':')));

describe('CVSS scoring (known reference values)', () => {
  it('v3.1', () => {
    expect(computeCvss31(parse('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H'))).toBe(9.8);
    expect(computeCvss31(parse('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N'))).toBe(7.5);
    expect(computeCvss31(parse('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H'))).toBe(10);
    expect(computeCvss31(parse('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:N'))).toBe(0);
  });
  it('v2', () => {
    expect(computeCvss2(parse('AV:N/AC:L/Au:N/C:P/I:P/A:P'))).toBe(7.5);
    expect(computeCvss2(parse('AV:N/AC:L/Au:N/C:C/I:C/A:C'))).toBe(10);
    expect(computeCvss2(parse('AV:N/AC:L/Au:N/C:N/I:N/A:N'))).toBe(0);
  });
});

describe('stripCvssPrefix / printed vectors', () => {
  it('removes any version prefix and leaves the vector itself', () => {
    const v = 'AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H';
    for (const p of ['CVSS:3.1/', 'CVSS:3.0/', 'CVSS:2.0/']) expect(stripCvssPrefix(p + v)).toBe(v);
    expect(stripCvssPrefix(v)).toBe(v);
    expect(stripCvssPrefix(null)).toBe('');
  });

  it('reports and the Issue Log print the vector without the prefix, storage is untouched', () => {
    const finding: any = { no: 1, title: 't', severity: 'High', cvssScore: 9.8, cvssVector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H' };
    const docx = new DocxManipulatorService();
    expect(docx.resolveFindingParameter('cvss_vector', finding)).toBe('AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H');
    expect(docx.resolveFindingParameter('cvss', finding)).toBe('9.8 | AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H');
    expect(finding.cvssVector).toMatch(/^CVSS:3\.1\//);
    expect(docx.resolveFindingParameter('cvss_vector', { ...finding, cvssVector: null })).toBe('N/A');
  });
});

describe('resolveCvssVector', () => {
  const base = { existingVector: null, exposure: 'External' };

  it('keeps a vector that came with the scan, even if exposure is unset', () => {
    expect(resolveCvssVector({ score: 5, version: '3', existingVector: 'CVSS:3.0/AV:L/x', exposure: null }))
      .toEqual({ vector: 'CVSS:3.0/AV:L/x', source: 'nessus' });
  });

  it.each([9.8, 7.5, 5.3, 6.5, 4.3, 3.7, 10, 0])('calculated v3 vector reproduces score %s and is Network for External', (score) => {
    const r = resolveCvssVector({ ...base, score, version: '3' });
    expect(r.source).toBe('calculated');
    expect(r.vector).toContain('/AV:N/');
    expect(computeCvss31(parse(r.vector!))).toBe(score);
  });

  it('picks the conventional vector for the common cases', () => {
    expect(resolveCvssVector({ ...base, score: 9.8, version: '3' }).vector).toBe('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H');
    expect(resolveCvssVector({ ...base, score: 7.5, version: '3' }).vector).toBe('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N');
  });

  it('uses the v2 form and reproduces v2 scores', () => {
    const r = resolveCvssVector({ ...base, score: 7.5, version: '2' });
    expect(r.vector).toMatch(/^AV:N\/AC:.\/Au:.\/C:.\/I:.\/A:.$/);
    expect(computeCvss2(parse(r.vector!))).toBe(7.5);
  });

  it('Internal prefers Adjacent, falls back to Network when no Adjacent combination matches', () => {
    const adj = resolveCvssVector({ ...base, exposure: 'Internal', score: 8.8, version: '3' });
    expect(adj.vector).toContain('/AV:A/');
    expect(computeCvss31(parse(adj.vector!))).toBe(8.8);
    const net = resolveCvssVector({ ...base, exposure: 'Internal', score: 9.8, version: '3' });
    expect(net.vector).toContain('/AV:N/');
  });

  it('leaves the vector unresolved instead of guessing', () => {
    const unresolved = { vector: null, source: 'unresolved' };
    expect(resolveCvssVector({ ...base, exposure: null, score: 7.5, version: '3' })).toEqual(unresolved);
    expect(resolveCvssVector({ ...base, exposure: 'Other', score: 7.5, version: '3' })).toEqual(unresolved);
    expect(resolveCvssVector({ ...base, score: null, version: null })).toEqual(unresolved);
    // 7.8 only occurs with a non-Network attack vector (e.g. local privilege escalation), which an
    // External project's exposure rules out; 0.5 is not a CVSS v3.1 score at all.
    expect(resolveCvssVector({ ...base, score: 7.8, version: '3' })).toEqual(unresolved);
    expect(resolveCvssVector({ ...base, score: 0.5, version: '3' })).toEqual(unresolved);
  });
});
